from __future__ import annotations

import unittest

from mirrorlight_backend.rag_core import (
    MAX_CHUNK_CHARS,
    IndexingContractError,
    IndexingLimits,
    index_document,
    normalize_source_path,
)


class RagIndexingContractTests(unittest.TestCase):
    def test_markdown_normalization_heading_metadata_and_links(self) -> None:
        document = index_document(
            "\ufeff---\r\ntitle: ignored\r\n---\r\n# Alpha\r\nFirst [[Beta|label]].\r\n## Beta\r\nSecond.",
            format="markdown",
            path="Docs\\Guide.md",
            pocket="global",
            scopes=("global",),
            authority="global_record",
            limits=IndexingLimits(max_chars=64, max_tokens=16),
        )

        self.assertEqual(document.path, "Docs/Guide.md")
        self.assertTrue(document.bom_removed)
        self.assertTrue(document.line_endings_changed)
        self.assertTrue(document.frontmatter_removed)
        self.assertEqual([record.metadata["heading"] for record in document.records], ["Alpha", "Beta"])
        self.assertEqual([record.metadata["heading_level"] for record in document.records], [1, 2])
        self.assertEqual(document.records[0].metadata["reference_targets"], ["Beta"])
        self.assertTrue(all(record.references == () for record in document.records))
        for record in document.records:
            start = record.metadata["text_start"]
            end = record.metadata["text_end"]
            self.assertEqual(record.text, document.canonical_text[start:end])

    def test_scalar_hard_boundary_does_not_split_supplementary_characters(self) -> None:
        text = "🧭界𐀀abcdef"
        document = index_document(
            text,
            format="text",
            path="unicode.txt",
            pocket="workspace",
            scopes=("workspace:demo",),
            authority="workspace_record",
            limits=IndexingLimits(max_chars=4, max_tokens=10),
        )

        self.assertEqual([record.text for record in document.records], ["🧭界𐀀a", "bcde", "f"])
        self.assertEqual(
            [(record.metadata["text_start"], record.metadata["text_end"]) for record in document.records],
            [(0, 4), (4, 8), (8, 9)],
        )

    def test_token_ceiling_and_explicit_unicode_whitespace(self) -> None:
        document = index_document(
            "one\u00a0two\u2003three four five",
            format="text",
            path="tokens.txt",
            pocket="global",
            scopes=("global",),
            authority="global_record",
            limits=IndexingLimits(max_chars=100, max_tokens=3),
        )

        self.assertEqual([record.text for record in document.records], ["one\u00a0two\u2003three", "four five"])

    def test_default_limit_splits_a_long_unbroken_line(self) -> None:
        document = index_document(
            "a" * (MAX_CHUNK_CHARS + 1),
            format="text",
            path="long.txt",
            pocket="global",
            scopes=("global",),
            authority="global_record",
        )

        self.assertEqual([len(record.text) for record in document.records], [MAX_CHUNK_CHARS, 1])
        self.assertEqual(document.records[1].metadata["text_start"], MAX_CHUNK_CHARS)

    def test_unclosed_frontmatter_is_preserved(self) -> None:
        document = index_document(
            "---\ntitle: retained\n# Body",
            format="markdown",
            path="open.md",
            pocket="global",
            scopes=("global",),
            authority="global_record",
        )

        self.assertFalse(document.frontmatter_removed)
        self.assertTrue(document.canonical_text.startswith("---"))

    def test_heading_without_body_is_not_a_retrieval_record(self) -> None:
        document = index_document(
            "## Empty\n\n## Filled\nUseful retrieval context.\n## Also empty",
            format="markdown",
            path="sections.md",
            pocket="global",
            scopes=("global",),
            authority="global_record",
        )

        self.assertEqual(
            [record.text for record in document.records],
            ["## Filled\nUseful retrieval context."],
        )

    def test_empty_canonical_document_emits_no_records(self) -> None:
        document = index_document(
            "\ufeff---\nname: metadata\n---\n\u3000\n",
            format="markdown",
            path="empty.md",
            pocket="global",
            scopes=("global",),
            authority="global_record",
        )

        self.assertEqual(document.canonical_text, "")
        self.assertEqual(document.records, ())

    def test_paths_and_inputs_fail_closed(self) -> None:
        self.assertEqual(normalize_source_path(" ./A//B\\Note.MD "), "A/B/Note.MD")
        for path in ("../escape.md", "/root.md", "C:\\root.md", "\x00.md"):
            with self.subTest(path=path), self.assertRaisesRegex(
                IndexingContractError,
                "path",
            ):
                normalize_source_path(path)

        base = {
            "content": "text",
            "format": "text",
            "path": "safe.txt",
            "pocket": "global",
            "scopes": ("global",),
            "authority": "global_record",
        }
        failures = (
            ({"format": "html"}, "unsupported_format"),
            ({"scopes": ("global", "global")}, "invalid_scopes"),
            ({"authority": "trusted"}, "invalid_authority"),
            ({"priority": 101}, "invalid_priority"),
            ({"content": "bad\x00text"}, "invalid_text"),
            ({"content": "\ud800"}, "invalid_unicode"),
        )
        for changed, code in failures:
            values = dict(base)
            values.update(changed)
            with self.subTest(code=code), self.assertRaises(IndexingContractError) as raised:
                index_document(**values)
            self.assertEqual(raised.exception.code, code)

    def test_identity_and_observation_are_deterministic(self) -> None:
        kwargs = {
            "format": "markdown",
            "path": "Folder/Note.md",
            "pocket": "vault-astra",
            "scopes": ("persona:astra", "workspace:demo"),
            "authority": "persona_vault",
            "priority": 7,
        }
        first = index_document("# Café\nSignal", **kwargs)
        second = index_document("# Café\nSignal", **kwargs)

        self.assertEqual(first.to_observation(), second.to_observation())
        record = first.records[0].to_mapping()
        self.assertEqual(record["source_id"], first.source_id)
        self.assertEqual(record["metadata"]["indexing_contract"], "rag-indexing-v1")
        self.assertEqual(record["provenance"], {"file_source": True, "chunk_source": True})

    def test_checkpoint_can_cancel_a_long_split(self) -> None:
        checkpoints = 0

        def stop() -> None:
            nonlocal checkpoints
            checkpoints += 1
            if checkpoints == 3:
                raise RuntimeError("cancelled")

        with self.assertRaisesRegex(RuntimeError, "cancelled"):
            index_document(
                "word " * 2_000,
                format="text",
                path="cancel.txt",
                pocket="global",
                scopes=("global",),
                authority="global_record",
                checkpoint=stop,
            )
        self.assertEqual(checkpoints, 3)


if __name__ == "__main__":
    unittest.main()
