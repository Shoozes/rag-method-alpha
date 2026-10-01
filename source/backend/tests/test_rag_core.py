from __future__ import annotations

import unittest

from mirrorlight_backend.rag_core import RagEngine, RagLimits, RagProfile, RagRecord
from mirrorlight_backend.rag_core.chunking import chunk_text
from mirrorlight_backend.rag_core.identity import (
    canonical_hash,
    content_id,
    embedding_id,
    source_chunk_id,
    source_id,
)
from mirrorlight_backend.rag_core.selection import (
    deterministic_order,
    estimated_context_tokens,
)
from mirrorlight_backend.rag_core.types import ContractError, RetrievalResult


class RagCoreTests(unittest.TestCase):
    def setUp(self) -> None:
        common = {
            "provenance_file": True,
            "provenance_chunk": True,
            "embedding_profile_id": "fixture-v1",
        }
        self.records = [
            RagRecord(
                id="global",
                text="Release canary is amber.",
                source_id="handbook",
                path="handbook.md",
                scopes=("global",),
                authority="global_record",
                **common,
            ),
            RagRecord(
                id="private",
                text="Private canary is violet.",
                source_id="private",
                path="private.md",
                scopes=("persona:private",),
                authority="persona_vault",
                **common,
            ),
            RagRecord(
                id="plan",
                text="Project Edge uses amber release readiness.",
                source_id="workspace-plan",
                path="plan.md",
                scopes=("workspace:edge",),
                authority="workspace_record",
                references=("checklist",),
                **common,
            ),
            RagRecord(
                id="checklist",
                text="Verify scope isolation and persistence.",
                source_id="workspace-checklist",
                path="checklist.md",
                scopes=("workspace:edge",),
                authority="workspace_record",
                **common,
            ),
        ]

    def test_modes_and_deny_first_scoping(self) -> None:
        engine = RagEngine(self.records)

        exact = engine.search("release canary is amber", mode="exact_only")
        self.assertEqual([item.record.id for item in exact.results], ["global"])

        scoped = engine.search(
            "canary",
            mode="scoped_hybrid",
            include_scopes=["global", "persona:private"],
            exclude_scopes=["persona:private"],
            semantic_enabled=False,
        )
        self.assertEqual([item.record.id for item in scoped.results], ["global"])
        self.assertEqual(scoped.semantic_state, "disabled_by_settings")

    def test_semantic_mode_requires_compatible_profile_and_vectors(self) -> None:
        engine = RagEngine(self.records)
        vectors = {record.id: [1.0, 0.0] for record in self.records}
        response = engine.search(
            "unrelated wording",
            mode="semantic_only",
            query_vector=[1.0, 0.0],
            vectors=vectors,
            query_embedding_profile_id="fixture-v1",
        )
        self.assertTrue(response.results)
        self.assertEqual(response.results[0].semantic_micro, 1_000_000)
        self.assertEqual(response.semantic_state, "ready")

        mismatch = engine.search(
            "unrelated wording",
            mode="semantic_only",
            query_vector=[1.0, 0.0],
            vectors=vectors,
            query_embedding_profile_id="other-profile",
        )
        self.assertFalse(mismatch.results)
        self.assertEqual(mismatch.semantic_fallback_reason, "no_compatible_vectors")
        self.assertTrue(mismatch.errors)

        invalid_dimension = engine.search(
            "unrelated wording",
            mode="semantic_only",
            query_vector=[1.0, 0.0],
            vectors={record.id: [1.0, 0.0, 0.0] for record in self.records},
            query_embedding_profile_id="fixture-v1",
        )
        self.assertEqual(invalid_dimension.semantic_state, "lexical_fallback")
        self.assertEqual(
            invalid_dimension.semantic_fallback_reason,
            "no_compatible_vectors",
        )

    def test_reference_reranking_is_one_hop_bounded_and_source_safe(self) -> None:
        records = [
            RagRecord(
                id="origin",
                text="reference expansion anchor",
                source_id="origin-source",
                references=("origin", "missing", "target", "second"),
            ),
            RagRecord(id="target", text="unrelated material", source_id="target-source"),
            RagRecord(id="second", text="other material", source_id="second-source"),
        ]
        engine = RagEngine(
            records,
            limits=RagLimits(max_reference_expansion=1, max_context_tokens=100),
        )

        response = engine.search("expansion anchor", mode="exact_only", top_k=3)

        self.assertEqual([item.record.id for item in response.results], ["origin", "target"])
        self.assertEqual(response.results[1].cross_reference_from_id, "origin")
        self.assertEqual(response.results[1].match_type, "cross_reference")

    def test_diversity_prefers_a_new_source_before_a_second_chunk(self) -> None:
        records = [
            RagRecord(id="a1", text="diversity beacon", source_id="a"),
            RagRecord(id="a2", text="diversity beacon", source_id="a"),
            RagRecord(id="b1", text="diversity beacon", source_id="b"),
        ]
        response = RagEngine(records).search(
            "diversity beacon",
            mode="exact_only",
            top_k=3,
        )
        self.assertEqual([item.record.id for item in response.results], ["a1", "b1", "a2"])

    def test_unicode_nfkc_and_explicit_scope_priority_are_deterministic(self) -> None:
        records = [
            RagRecord(
                id="workspace",
                text="Café ATLAS scope priority beacon",
                source_id="workspace",
                scopes=("workspace:edge",),
                authority="workspace_record",
            ),
            RagRecord(
                id="project",
                text="Café ATLAS scope priority beacon",
                source_id="project",
                scopes=("project:edge",),
                authority="workspace_record",
            ),
        ]
        response = RagEngine(records).search(
            "café ＡＴＬＡＳ scope priority beacon",
            mode="exact_only",
            top_k=2,
            include_scopes=["workspace:edge", "project:edge"],
            scope_priorities={"workspace:edge": 50, "project:edge": 0},
        )
        self.assertEqual([item.record.id for item in response.results], ["workspace", "project"])
        self.assertGreater(response.results[0].priority_micro, response.results[1].priority_micro)

    def test_context_budget_reports_omitted_candidates(self) -> None:
        records = [
            RagRecord(id="short", text="budget beacon", source_id="short", source_name="s"),
            RagRecord(
                id="long",
                text="budget beacon " + "x" * 200,
                source_id="long",
                source_name="l",
            ),
        ]
        response = RagEngine(records).search(
            "budget beacon",
            mode="exact_only",
            top_k=2,
            max_context_tokens=35,
        )
        self.assertEqual([item.record.id for item in response.results], ["short"])
        self.assertTrue(response.truncated)

    def test_cancellation_checkpoint_propagates(self) -> None:
        phases: list[str] = []

        def stop(phase: str) -> None:
            phases.append(phase)
            if phase == "rank.start":
                raise RuntimeError("cancelled")

        with self.assertRaisesRegex(RuntimeError, "cancelled"):
            RagEngine(self.records).search("canary", checkpoint=stop)
        self.assertIn("filter.start", phases)
        self.assertIn("rank.start", phases)

    def test_chunking_and_identity_are_deterministic(self) -> None:
        kwargs = {
            "source_id": "source-1",
            "path": "notes.md",
            "max_chars": 20,
            "max_tokens": 3,
        }
        first = chunk_text("one two three four five six", **kwargs)
        second = chunk_text("one two three four five six", **kwargs)
        self.assertEqual([record.id for record in first], [record.id for record in second])
        self.assertTrue(all(len(record.text) <= 20 for record in first))

        digest = content_id("Café 🧭")
        owner = source_id(" FILE ", "  Ｄｏｃｓ \t", " Folder\\A.TXT ")
        chunk = source_chunk_id(owner, 12, None, None, digest)
        self.assertEqual(owner, source_id("file", "docs", "Folder/A.TXT"))
        self.assertEqual(
            canonical_hash(("", "é", "🧭")),
            "328ebac536f33028ea6b8879ecb70450374c408872c2ef2302f7e2e02c199360",
        )
        self.assertEqual(
            digest,
            "64d52a724725f19a89c6e135eda4d57e27cefbb0709a50b42687cfa6dd3a249c",
        )
        self.assertEqual(
            owner,
            "338300efd243f481b5fa7556e26134cd1f0bf9c255e98b133cde799bbddb669d",
        )
        self.assertEqual(
            chunk,
            "7ec598b2f164701ebd406ce881da482b3c5e45149be4db50bf7341552f2eede7",
        )
        self.assertEqual(
            embedding_id(chunk, "profile:v2"),
            "c871a6269b78c977ce85d3e417b2aaaec5d9421499ea7836eb02cde82be1f86e",
        )

    def test_unicode_scalar_ties_and_context_counts_are_explicit(self) -> None:
        supplementary = RagRecord(
            id="supplementary",
            text="same",
            source_id="source-a",
            source_name="𐀀",
            pocket="x",
            scopes=("a", "🧭"),
        )
        private_use = RagRecord(
            id="private-use",
            text="same",
            source_id="source-b",
            source_name="\ue000",
            pocket="x",
            scopes=("a",),
        )
        ordered = deterministic_order(
            [RetrievalResult(supplementary, 0), RetrievalResult(private_use, 0)]
        )

        self.assertEqual(
            [result.record.id for result in ordered],
            ["private-use", "supplementary"],
        )
        self.assertEqual(
            estimated_context_tokens(RetrievalResult(supplementary, 0)),
            26,
        )

    def test_duplicate_ids_and_malformed_values_fail_closed(self) -> None:
        with self.assertRaises(ContractError):
            RagEngine([self.records[0], self.records[0]])
        with self.assertRaises(ContractError):
            RagEngine(self.records).search("query", mode="legacy")
        with self.assertRaisesRegex(ContractError, "metadata"):
            RagRecord(id="bad", text="text", source_id="source", metadata=[])
        with self.assertRaisesRegex(ContractError, "unknown fields"):
            RagEngine(
                [
                    {
                        "id": "bad-record",
                        "text": "text",
                        "source_id": "source",
                        "prioritty": 1,
                    }
                ]
            )
        with self.assertRaisesRegex(ContractError, "Unicode scalar"):
            RagRecord(id="bad-unicode", text="\ud800", source_id="source")
        with self.assertRaisesRegex(ContractError, "authority"):
            RagRecord(
                id="legacy-authority",
                text="text",
                source_id="source",
                authority="local-file",
            )
        with self.assertRaisesRegex(ContractError, "authority"):
            RagRecord(
                id="noncanonical-authority",
                text="text",
                source_id="source",
                authority="Global-Record",
            )
        with self.assertRaisesRegex(ContractError, "authority scores"):
            RagProfile(
                authority_scores={
                    "global_record": -1,
                    "workspace_record": 1,
                    "persona_vault": 1,
                    "conversation_memory": 1,
                    "unclassified": 1,
                }
            )
        with self.assertRaisesRegex(ContractError, "profile version"):
            RagProfile(version=True)
        with self.assertRaisesRegex(ContractError, "max_top_k"):
            RagLimits(max_top_k=101)
        with self.assertRaisesRegex(ContractError, "include_scopes"):
            RagEngine(self.records).search("query", include_scopes="global")
        with self.assertRaisesRegex(ContractError, "expand"):
            RagEngine(self.records).search("query", expand="false")
        with self.assertRaisesRegex(ContractError, "fallback"):
            RagEngine(self.records).search(
                "query",
                semantic_fallback_reason="unknown",
            )
        with self.assertRaisesRegex(ContractError, "Unicode scalar"):
            RagEngine(self.records).search("\ud800")
        with self.assertRaisesRegex(ContractError, "UTF-8 byte"):
            RagEngine(self.records, limits=RagLimits(max_query_utf8_bytes=3)).search("éé")
        with self.assertRaisesRegex(ContractError, "source_id"):
            chunk_text("text", source_id=42, path="notes.md")


if __name__ == "__main__":
    unittest.main()
