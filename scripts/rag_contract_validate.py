#!/usr/bin/env python3
"""Validate and execute the frozen rag-behavior-v2 contract."""

from __future__ import annotations

import argparse
import json
import math
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "source" / "backend"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(BACKEND))

from scripts.proof_repository import repository_state  # noqa: E402

from mirrorlight_backend.rag_core import (  # noqa: E402
    CONTRACT_ID,
    PROFILE_ID,
    RagEngine,
    RagLimits,
    RagProfile,
    RagRecord,
)
from mirrorlight_backend.rag_core.engine import MODES  # noqa: E402
from mirrorlight_backend.rag_core.identity import (  # noqa: E402
    canonical_hash,
    content_id,
    embedding_id,
    source_chunk_id,
    source_id,
)
from mirrorlight_backend.rag_core.types import MICRO_UNITS  # noqa: E402


REPORT_CONTRACT = "rag-behavior-v2-report"
_COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
_TIE_BREAK = [
    "score_micro_desc",
    "scope_priority_desc",
    "source_name_asc",
    "text_asc",
    "source_id_asc",
    "id_asc",
]
_DIVERSITY_TIE_BREAK = [
    "rank_score_micro_desc",
    "base_score_micro_desc",
    "source_id_asc",
    "id_asc",
]


def _read(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"contract file must contain an object: {path}")
    return value


def _required_int(payload: dict[str, Any], key: str, owner: str) -> int:
    value = payload.get(key)
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError(f"{owner}.{key} must be an integer")
    return value


def _required_string(payload: dict[str, Any], key: str, owner: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{owner}.{key} must be a non-empty string")
    return value.strip()


def _string_list(value: object, field_name: str) -> list[str]:
    if not isinstance(value, list):
        raise ValueError(f"{field_name} must be an array of strings")
    result: list[str] = []
    for item in value:
        if not isinstance(item, str) or not item.strip() or item != item.strip():
            raise ValueError(f"{field_name} must contain trimmed non-empty strings")
        if item in result:
            raise ValueError(f"{field_name} must not contain duplicates")
        result.append(item)
    return result


def _child_path(contract_root: Path, name: object, owner: str) -> Path:
    if not isinstance(name, str) or not name.strip():
        raise ValueError(f"{owner} must be a non-empty relative path")
    path = (contract_root / name).resolve()
    try:
        path.relative_to(contract_root)
    except ValueError as exc:
        raise ValueError(f"{owner} must remain under the contract root") from exc
    if not path.is_file():
        raise ValueError(f"contract file is missing: {path}")
    return path


def _validate_manifest(manifest: dict[str, Any], contract_root: Path) -> dict[str, Any]:
    if set(manifest) != {
        "$schema",
        "contract",
        "version",
        "status",
        "owner",
        "baseline_commits",
        "fixture_counts",
        "files",
        "change_policy",
    }:
        raise ValueError("manifest fields drifted from frozen v2")
    if (
        manifest.get("$schema") != "https://json-schema.org/draft/2020-12/schema"
        or manifest.get("contract") != CONTRACT_ID
        or manifest.get("version") != 2
        or manifest.get("status") != "frozen"
        or manifest.get("owner") != "RAG-Method-PY"
        or manifest.get("change_policy")
        != "Any behavioral change requires a new contract version; adapters must not rewrite expectations."
    ):
        raise ValueError("unsupported or unfrozen RAG behavior manifest")
    commits = manifest.get("baseline_commits")
    if not isinstance(commits, dict) or set(commits) != {
        "rag_method_py",
        "edgesymbio",
        "tulpaweaver",
    }:
        raise ValueError("manifest baseline_commits must name all three repositories")
    if any(not isinstance(value, str) or not _COMMIT_RE.fullmatch(value) for value in commits.values()):
        raise ValueError("manifest baseline commits must be lowercase 40-character SHAs")
    if manifest.get("fixture_counts") != {
        "records": 19,
        "cases": 15,
        "expected_modes": 5,
        "identity_vectors": 5,
    }:
        raise ValueError("manifest fixture counts drifted from frozen v2")
    files = manifest.get("files")
    if not isinstance(files, dict):
        raise ValueError("manifest files must be an object")
    file_keys = {
        "profile",
        "record_schema",
        "query_schema",
        "response_schema",
        "report_schema",
        "cases",
        "records",
        "vectors",
        "expected",
        "adapters",
    }
    if set(files) != file_keys:
        raise ValueError("manifest files must contain the frozen v2 file set")
    paths: dict[str, Any] = {}
    for key in (
        "profile",
        "record_schema",
        "query_schema",
        "response_schema",
        "report_schema",
        "cases",
        "records",
        "vectors",
    ):
        paths[key] = _child_path(contract_root, files.get(key), f"manifest.files.{key}")
    for group in ("expected", "adapters"):
        entries = files.get(group)
        if not isinstance(entries, dict) or not entries:
            raise ValueError(f"manifest.files.{group} must be a non-empty object")
        paths[group] = {
            key: _child_path(contract_root, value, f"manifest.files.{group}.{key}")
            for key, value in entries.items()
        }
    if set(paths["expected"]) != MODES:
        raise ValueError("manifest expected files must cover every retrieval mode")
    if set(paths["adapters"]) != {"python", "rust", "javascript"}:
        raise ValueError("manifest adapters must cover Python, Rust, and JavaScript")
    return paths


def _profile_from_mapping(profile: dict[str, Any]) -> tuple[RagProfile, RagLimits]:
    if set(profile) != {
        "$schema",
        "contract",
        "version",
        "profile_id",
        "status",
        "identity",
        "normalization",
        "embedding",
        "scoring",
        "authority",
        "scope",
        "references",
        "selection",
        "context",
        "limits",
        "semantic_states",
        "fallback_reasons",
        "modes",
        "cancellation_checkpoints",
    }:
        raise ValueError("profile fields drifted from frozen v2")
    if (
        profile.get("$schema") != "https://json-schema.org/draft/2020-12/schema"
        or profile.get("contract") != CONTRACT_ID
        or profile.get("version") != 2
        or profile.get("profile_id") != PROFILE_ID
        or profile.get("status") != "frozen"
    ):
        raise ValueError("unsupported or unfrozen RAG behavior profile")
    identity = profile.get("identity")
    normalization = profile.get("normalization")
    scoring = profile.get("scoring")
    embedding = profile.get("embedding")
    authority = profile.get("authority")
    scope = profile.get("scope")
    references = profile.get("references")
    selection = profile.get("selection")
    context = profile.get("context")
    limits = profile.get("limits")
    if any(
        not isinstance(value, dict)
        for value in (
            identity,
            normalization,
            scoring,
            embedding,
            authority,
            scope,
            references,
            selection,
            context,
            limits,
        )
    ):
        raise ValueError("profile policy sections must be objects")
    if set(_string_list(profile.get("modes"), "profile.modes")) != MODES:
        raise ValueError("profile modes do not match the implemented retrieval modes")
    if _string_list(scoring.get("tie_break"), "scoring.tie_break") != _TIE_BREAK:
        raise ValueError("profile primary tie-break does not match the implementation")
    if (
        _string_list(scoring.get("diversity_tie_break"), "scoring.diversity_tie_break")
        != _DIVERSITY_TIE_BREAK
    ):
        raise ValueError("profile diversity tie-break does not match the implementation")
    if scoring.get("units") != MICRO_UNITS:
        raise ValueError("profile fixed-point units must equal 1000000")
    if scope.get("deny_first") is not True or scope.get("all_token") != "all":
        raise ValueError("profile scope policy does not match deny-first semantics")
    if references.get("behavior") != "one_hop_candidate_only_reranking":
        raise ValueError("profile reference behavior does not match the implementation")
    authority_scores = authority.get("component_micro")
    if not isinstance(authority_scores, dict):
        raise ValueError("authority.component_micro must be an object")
    rag_profile = RagProfile(
        name=PROFILE_ID,
        version=2,
        exact_weight=_required_int(scoring, "exact_weight_micro", "scoring"),
        semantic_weight=_required_int(scoring, "semantic_weight_micro", "scoring"),
        keyword_weight=_required_int(scoring, "keyword_weight_micro", "scoring"),
        scope_weight=_required_int(scoring, "scope_weight_micro", "scoring"),
        provenance_weight=_required_int(scoring, "provenance_weight_micro", "scoring"),
        authority_weight=_required_int(scoring, "authority_weight_micro", "scoring"),
        priority_weight=_required_int(scoring, "priority_weight_micro", "scoring"),
        aspect_coverage_weight=_required_int(
            scoring,
            "aspect_coverage_weight_micro",
            "scoring",
        ),
        reference_weight=_required_int(
            scoring,
            "cross_reference_weight_micro",
            "scoring",
        ),
        semantic_min_score=_required_int(
            embedding,
            "semantic_min_score_micro",
            "embedding",
        ),
        authority_scores=authority_scores,
    )
    if sum(
        (
            rag_profile.exact_weight,
            rag_profile.semantic_weight,
            rag_profile.keyword_weight,
            rag_profile.scope_weight,
            rag_profile.provenance_weight,
            rag_profile.authority_weight,
            rag_profile.priority_weight,
            rag_profile.aspect_coverage_weight,
            rag_profile.reference_weight,
        )
    ) != scoring.get("positive_weight_budget_micro"):
        raise ValueError("profile positive weight budget does not match its components")
    rag_limits = RagLimits(
        max_query_chars=_required_int(limits, "max_query_chars", "limits"),
        max_query_utf8_bytes=_required_int(limits, "max_query_utf8_bytes", "limits"),
        max_records=_required_int(limits, "max_records", "limits"),
        max_top_k=_required_int(limits, "max_top_k", "limits"),
        max_context_tokens=_required_int(context, "max_rag_context_tokens", "context"),
        max_reference_expansion=_required_int(references, "max_expansions", "references"),
        max_per_source=_required_int(selection, "max_chunks_per_source", "selection"),
        durable_candidate_limit=_required_int(
            selection,
            "durable_candidate_limit",
            "selection",
        ),
        memory_candidate_limit=_required_int(
            selection,
            "memory_candidate_limit",
            "selection",
        ),
    )
    expected_profile = RagProfile()
    profile_fields = (
        "exact_weight",
        "semantic_weight",
        "keyword_weight",
        "scope_weight",
        "provenance_weight",
        "authority_weight",
        "priority_weight",
        "aspect_coverage_weight",
        "reference_weight",
        "semantic_min_score",
        "authority_scores",
    )
    if any(
        getattr(rag_profile, field_name) != getattr(expected_profile, field_name)
        for field_name in profile_fields
    ):
        raise ValueError("profile scoring or authority values drifted from frozen v2")
    if rag_limits != RagLimits():
        raise ValueError("profile limits drifted from frozen v2")

    expected_identity_policy = {
        "version": 2,
        "digest": "sha256",
        "part_encoding": "utf8_length_prefixed_u64_little_endian",
        "domains": {
            "source": "rag-source",
            "source_chunk": "rag-source-chunk",
            "embedding": "rag-embedding",
        },
        "normalization": {
            "source_kind": "trim_unicode_lowercase",
            "pocket": "unicode_nfkc_casefold_collapse_whitespace",
            "source_key": "trim_unicode_whitespace_replace_backslash_with_forward_slash_unicode_lowercase",
            "content": "raw_utf8",
            "numeric_parts": "base10_ascii_no_padding",
            "missing_offsets": "empty_string",
        },
    }
    identity_policy = {
        key: value for key, value in identity.items() if key != "test_vectors"
    }
    if identity_policy != expected_identity_policy:
        raise ValueError("profile identity policy drifted from frozen v2")
    identity_vectors = identity.get("test_vectors")
    if not isinstance(identity_vectors, dict) or set(identity_vectors) != {
        "canonical_hash",
        "content_id",
        "source_id",
        "source_chunk_id",
        "embedding_id",
    }:
        raise ValueError("profile identity test vectors are incomplete")
    if any(not isinstance(case, dict) for case in identity_vectors.values()):
        raise ValueError("profile identity test vectors must be objects")
    expected_identity_fields = {
        "canonical_hash": {"parts", "expected"},
        "content_id": {"text", "expected"},
        "source_id": {"source_kind", "pocket", "source_key", "expected"},
        "source_chunk_id": {
            "source_id",
            "chunk_index",
            "text_start",
            "text_end",
            "content_id",
            "expected",
        },
        "embedding_id": {"chunk_id", "profile_id", "expected"},
    }
    if any(
        set(identity_vectors[name]) != fields
        for name, fields in expected_identity_fields.items()
    ):
        raise ValueError("profile identity test vector fields drifted from frozen v2")
    try:
        hash_case = identity_vectors["canonical_hash"]
        content_case = identity_vectors["content_id"]
        source_case = identity_vectors["source_id"]
        chunk_case = identity_vectors["source_chunk_id"]
        embedding_case = identity_vectors["embedding_id"]
        actual_identity = {
            "canonical_hash": canonical_hash(hash_case["parts"]),
            "content_id": content_id(content_case["text"]),
            "source_id": source_id(
                source_case["source_kind"],
                source_case["pocket"],
                source_case["source_key"],
            ),
            "source_chunk_id": source_chunk_id(
                chunk_case["source_id"],
                chunk_case["chunk_index"],
                chunk_case["text_start"],
                chunk_case["text_end"],
                chunk_case["content_id"],
            ),
            "embedding_id": embedding_id(
                embedding_case["chunk_id"],
                embedding_case["profile_id"],
            ),
        }
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("profile identity test vectors are invalid") from exc
    if any(
        actual_identity[name] != identity_vectors[name].get("expected")
        for name in actual_identity
    ):
        raise ValueError("profile identity test vectors do not match the implementation")

    expected_sections = {
        "normalization": {
            "record_strings": "trim_unicode_whitespace_require_valid_unicode_scalars",
            "exact": "unicode_nfkc_lowercase_collapse_whitespace",
            "keywords": "unicode_nfkc_lowercase_unique_alphanumeric_terms",
            "stop_words": [],
            "query_expansions": [],
        },
        "embedding": {
            "fixture_profile_id": "rag-behavior-v2-fixture-v1",
            "fixture_dimension": 4,
            "compatibility": "exact_profile_id_and_dimension",
            "semantic_min_score_micro": 200_000,
            "threshold_inclusive": True,
            "cosine_policy": "raw_cosine_clamped_0_to_1",
            "rounding": "floor(value_times_1000000_plus_0_5)",
        },
        "authority": {
            "policy_values": ["all", "recorded_only"],
            "recorded_kinds": [
                "global_record",
                "workspace_record",
                "persona_vault",
            ],
            "component_micro": dict(expected_profile.authority_scores),
            "intent_detection": "none_explicit_query_policy_only",
        },
        "scope": {
            "deny_first": True,
            "all_token": "all",
            "label_normalization": "trim_unicode_whitespace_preserve_case",
            "comparison": "exact_unicode_scalar_sequence",
            "multi_scope_match": "any",
            "priority": "explicit_numeric_max_matching_scope",
            "priority_range": [-100, 100],
        },
        "references": {
            "representation": "ordered_target_record_ids",
            "behavior": "one_hop_candidate_only_reranking",
            "max_expansions": 4,
            "self_source_links": "ignored",
            "duplicate_targets": "first_anchor_wins",
        },
        "selection": {
            "durable_candidate_limit": 48,
            "memory_candidate_limit": 16,
            "memory_authority": "conversation_memory",
            "max_chunks_per_source": 2,
            "prefer_unseen_sources": True,
            "aspect_coverage": "new_query_terms_not_yet_covered",
        },
        "context": {
            "max_prompt_tokens": 4096,
            "reserved_generation_tokens": 1024,
            "max_rag_context_tokens": 1800,
            "token_estimator": "floor((text_scalar_count+source_name_scalar_count+pocket_scalar_count+sum_scope_scalar_counts+99)/4)",
        },
        "limits": {
            "max_query_chars": 4000,
            "query_character_unit": "unicode_scalar_values",
            "max_query_utf8_bytes": 16384,
            "query_byte_encoding": "utf8_strict",
            "max_records": 50000,
            "max_top_k": 100,
        },
    }
    for section_name, expected in expected_sections.items():
        if profile.get(section_name) != expected:
            raise ValueError(f"profile {section_name} policy drifted from frozen v2")

    scoring_expected = {
        "units": MICRO_UNITS,
        "exact_weight_micro": expected_profile.exact_weight,
        "semantic_weight_micro": expected_profile.semantic_weight,
        "keyword_weight_micro": expected_profile.keyword_weight,
        "scope_weight_micro": expected_profile.scope_weight,
        "provenance_weight_micro": expected_profile.provenance_weight,
        "authority_weight_micro": expected_profile.authority_weight,
        "priority_weight_micro": expected_profile.priority_weight,
        "aspect_coverage_weight_micro": expected_profile.aspect_coverage_weight,
        "cross_reference_weight_micro": expected_profile.reference_weight,
        "positive_weight_budget_micro": 950_000,
        "aggregate_rounding": "sum_weighted_components_then_truncate_toward_zero",
        "final_clamp_micro": [0, MICRO_UNITS],
        "string_order": "unicode_scalar_value_lexicographic_ascending",
        "tie_break": _TIE_BREAK,
        "diversity_tie_break": _DIVERSITY_TIE_BREAK,
    }
    if scoring != scoring_expected:
        raise ValueError("profile scoring policy drifted from frozen v2")
    if profile.get("semantic_states") != [
        "not_requested",
        "ready",
        "disabled_by_settings",
        "lexical_fallback",
    ]:
        raise ValueError("profile semantic states drifted from frozen v2")
    if profile.get("fallback_reasons") != [
        "disabled_by_settings",
        "no_compatible_vectors",
        "embedding_failed",
    ]:
        raise ValueError("profile fallback reasons drifted from frozen v2")
    if profile.get("modes") != [
        "exact_only",
        "semantic_only",
        "keyword_only",
        "hybrid",
        "scoped_hybrid",
    ]:
        raise ValueError("profile mode order drifted from frozen v2")
    if profile.get("cancellation_checkpoints") != [
        "filter.start",
        "filter.scan",
        "rank.start",
        "rank.scan",
        "cross_reference.before",
        "cross_reference.after",
        "selection.start",
        "return",
    ]:
        raise ValueError("profile cancellation checkpoints drifted from frozen v2")
    return rag_profile, rag_limits


def _load_records(payload: dict[str, Any]) -> list[RagRecord]:
    if (
        set(payload) != {"contract", "version", "records"}
        or payload.get("contract") != "rag-behavior-v2-fixture-records"
        or payload.get("version") != 2
    ):
        raise ValueError("unsupported fixture record contract")
    raw_records = payload.get("records")
    if not isinstance(raw_records, list):
        raise ValueError("fixture records must be an array")
    required_fields = {
        "id",
        "text",
        "source_id",
        "source_name",
        "path",
        "pocket",
        "scopes",
        "authority",
        "priority",
        "provenance",
        "references",
        "embedding_profile_id",
    }
    allowed_fields = required_fields | {"scope", "metadata"}
    for index, record in enumerate(raw_records):
        if not isinstance(record, dict):
            raise ValueError(f"fixture record {index} must be an object")
        if not required_fields.issubset(record) or not set(record).issubset(allowed_fields):
            raise ValueError(f"fixture record {index} does not match the record schema")
        provenance = record.get("provenance")
        if not isinstance(provenance, dict) or set(provenance) != {
            "file_source",
            "chunk_source",
        }:
            raise ValueError(f"fixture record {index}.provenance is invalid")
    records = [RagRecord.from_mapping(record) for record in raw_records]
    if len({record.id for record in records}) != len(records):
        raise ValueError("fixture record IDs must be unique")
    return records


def _finite_vector(value: object, dimension: int, owner: str) -> list[float]:
    if not isinstance(value, list) or len(value) != dimension:
        raise ValueError(f"{owner} must contain exactly {dimension} numbers")
    if any(
        not isinstance(item, (int, float))
        or isinstance(item, bool)
        or not math.isfinite(float(item))
        for item in value
    ):
        raise ValueError(f"{owner} must contain only finite numbers")
    if math.fsum(float(item) * float(item) for item in value) <= 1e-24:
        raise ValueError(f"{owner} must have a non-zero norm")
    return [float(item) for item in value]


def _load_vectors(
    payload: dict[str, Any],
    records: list[RagRecord],
) -> tuple[str, int, dict[str, list[float]], dict[str, list[float]]]:
    if (
        set(payload)
        != {
            "contract",
            "version",
            "profile_id",
            "dimension",
            "record_vectors",
            "query_vectors",
        }
        or payload.get("contract") != "rag-behavior-v2-fixture-vectors"
        or payload.get("version") != 2
    ):
        raise ValueError("unsupported fixture vector contract")
    profile_id = _required_string(payload, "profile_id", "vectors")
    dimension = _required_int(payload, "dimension", "vectors")
    if dimension < 1:
        raise ValueError("fixture vector dimension must be positive")
    raw_records = payload.get("record_vectors")
    raw_queries = payload.get("query_vectors")
    if not isinstance(raw_records, dict) or not isinstance(raw_queries, dict):
        raise ValueError("fixture record and query vectors must be objects")
    if any(
        not isinstance(vector_id, str)
        or not vector_id.strip()
        or vector_id != vector_id.strip()
        for vector_id in (*raw_records.keys(), *raw_queries.keys())
    ):
        raise ValueError("fixture vector IDs must be trimmed non-empty strings")
    record_ids = {record.id for record in records}
    if set(raw_records) != record_ids:
        raise ValueError("fixture record vector IDs must exactly match fixture records")
    record_vectors = {
        key: _finite_vector(value, dimension, f"record vector {key}")
        for key, value in raw_records.items()
    }
    query_vectors = {
        key: _finite_vector(value, dimension, f"query vector {key}")
        for key, value in raw_queries.items()
    }
    return profile_id, dimension, record_vectors, query_vectors


def _load_cases(payload: dict[str, Any], query_vector_ids: set[str]) -> list[dict[str, Any]]:
    if (
        set(payload) != {"contract", "version", "cases"}
        or payload.get("contract") != "rag-behavior-v2-cases"
        or payload.get("version") != 2
    ):
        raise ValueError("unsupported fixture cases contract")
    cases = payload.get("cases")
    if not isinstance(cases, list):
        raise ValueError("fixture cases must be an array")
    seen: set[str] = set()
    normalized: list[dict[str, Any]] = []
    for raw_case in cases:
        if not isinstance(raw_case, dict):
            raise ValueError("each fixture case must be an object")
        case = dict(raw_case)
        allowed_fields = {
            "id",
            "query",
            "mode",
            "top_k",
            "include_scopes",
            "exclude_scopes",
            "scope_priorities",
            "authority_policy",
            "query_vector_id",
            "semantic_enabled",
            "semantic_fallback_reason",
            "max_context_tokens",
            "expand",
        }
        unknown_fields = set(case) - allowed_fields
        if unknown_fields:
            raise ValueError(
                "fixture case contains unknown fields: "
                + ", ".join(sorted(str(field) for field in unknown_fields))
            )
        case_id = _required_string(case, "id", "case")
        if case_id in seen:
            raise ValueError(f"duplicate fixture case ID: {case_id}")
        seen.add(case_id)
        query = case.get("query")
        if not isinstance(query, str):
            raise ValueError(f"case {case_id}.query must be a string")
        try:
            encoded_query = query.encode("utf-8")
        except UnicodeEncodeError as exc:
            raise ValueError(f"case {case_id}.query must contain valid Unicode") from exc
        if len(query) > 4000 or len(encoded_query) > 16384:
            raise ValueError(f"case {case_id}.query exceeds the frozen limits")
        mode = _required_string(case, "mode", f"case {case_id}")
        if mode not in MODES:
            raise ValueError(f"case {case_id} uses an unsupported mode")
        top_k = _required_int(case, "top_k", f"case {case_id}")
        if not 1 <= top_k <= 100:
            raise ValueError(f"case {case_id}.top_k must be between 1 and 100")
        for field in ("include_scopes", "exclude_scopes"):
            if field in case:
                _string_list(case[field], f"case {case_id}.{field}")
        vector_id = case.get("query_vector_id")
        if vector_id is not None:
            if not isinstance(vector_id, str) or not vector_id.strip():
                raise ValueError(f"case {case_id}.query_vector_id must be a string")
            if vector_id not in query_vector_ids:
                raise ValueError(f"case {case_id} references an unknown query vector")
        priorities = case.get("scope_priorities")
        if priorities is not None:
            if not isinstance(priorities, dict) or any(
                not isinstance(scope_name, str)
                or not scope_name.strip()
                or scope_name != scope_name.strip()
                or not isinstance(priority, int)
                or isinstance(priority, bool)
                or not -100 <= priority <= 100
                for scope_name, priority in priorities.items()
            ):
                raise ValueError(f"case {case_id}.scope_priorities is invalid")
        authority_policy = case.get("authority_policy", "all")
        if authority_policy not in {"all", "recorded_only"}:
            raise ValueError(f"case {case_id}.authority_policy is invalid")
        if "semantic_enabled" in case and not isinstance(case["semantic_enabled"], bool):
            raise ValueError(f"case {case_id}.semantic_enabled must be a boolean")
        fallback_reason = case.get("semantic_fallback_reason")
        if fallback_reason is not None and fallback_reason not in {
            "disabled_by_settings",
            "no_compatible_vectors",
            "embedding_failed",
        }:
            raise ValueError(f"case {case_id}.semantic_fallback_reason is invalid")
        context_limit = case.get("max_context_tokens")
        if context_limit is not None and (
            not isinstance(context_limit, int)
            or isinstance(context_limit, bool)
            or not 1 <= context_limit <= 1800
        ):
            raise ValueError(f"case {case_id}.max_context_tokens is invalid")
        if "expand" in case and not isinstance(case["expand"], bool):
            raise ValueError(f"case {case_id}.expand must be a boolean")
        normalized.append(case)
    return normalized


def _load_expected(paths: dict[str, Path], cases: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    expected: dict[str, dict[str, Any]] = {}
    required_by_mode: dict[str, set[str]] = {mode: set() for mode in MODES}
    for case in cases:
        required_by_mode[case["mode"]].add(case["id"])
    for mode, path in paths.items():
        payload = _read(path)
        if (
            set(payload) != {"contract", "version", "mode", "cases"}
            or payload.get("contract") != "rag-behavior-v2-expected"
            or payload.get("version") != 2
            or payload.get("mode") != mode
        ):
            raise ValueError(f"unsupported expected-output contract: {path}")
        values = payload.get("cases")
        if not isinstance(values, dict):
            raise ValueError(f"expected cases must be an object: {path}")
        if set(values) != required_by_mode[mode]:
            raise ValueError(f"expected case IDs do not match {mode} cases")
        for case_id, observation in values.items():
            if not isinstance(observation, dict):
                raise ValueError(f"expected observation must be an object: {case_id}")
            expected[case_id] = observation
    return expected


def load_contract(contract_root: Path | None = None, *, require_expected: bool = True) -> dict[str, Any]:
    contract_root = (contract_root or ROOT / "contracts" / CONTRACT_ID).resolve()
    manifest = _read(contract_root / "manifest.json")
    paths = _validate_manifest(manifest, contract_root)
    schema_ids = {
        "record_schema": "rag-behavior-v2/record.schema.json",
        "query_schema": "rag-behavior-v2/query.schema.json",
        "response_schema": "rag-behavior-v2/response.schema.json",
        "report_schema": "rag-behavior-v2/report.schema.json",
    }
    for schema_key, schema_id in schema_ids.items():
        schema = _read(paths[schema_key])
        if (
            schema.get("$schema")
            != "https://json-schema.org/draft/2020-12/schema"
            or schema.get("$id") != schema_id
            or schema.get("type") != "object"
            or schema.get("additionalProperties") is not False
        ):
            raise ValueError(f"schema does not declare JSON Schema 2020-12: {paths[schema_key]}")
    profile_payload = _read(paths["profile"])
    profile, limits = _profile_from_mapping(profile_payload)
    records = _load_records(_read(paths["records"]))
    vector_profile_id, vector_dimension, record_vectors, query_vectors = _load_vectors(
        _read(paths["vectors"]),
        records,
    )
    embedding_policy = profile_payload["embedding"]
    if (
        vector_profile_id != embedding_policy["fixture_profile_id"]
        or vector_dimension != embedding_policy["fixture_dimension"]
    ):
        raise ValueError("fixture vectors do not match the frozen embedding profile")
    cases = _load_cases(_read(paths["cases"]), set(query_vectors))
    counts = manifest["fixture_counts"]
    if len(records) != counts["records"] or len(cases) != counts["cases"]:
        raise ValueError("loaded fixture counts do not match the frozen manifest")
    expected = _load_expected(paths["expected"], cases) if require_expected else {}
    return {
        "root": contract_root,
        "manifest": manifest,
        "profile": profile,
        "limits": limits,
        "records": records,
        "vector_profile_id": vector_profile_id,
        "vector_dimension": vector_dimension,
        "record_vectors": record_vectors,
        "query_vectors": query_vectors,
        "cases": cases,
        "expected": expected,
    }


def execute_case(bundle: dict[str, Any], case: dict[str, Any]) -> dict[str, Any]:
    engine = RagEngine(
        bundle["records"],
        profile=bundle["profile"],
        limits=bundle["limits"],
    )
    vector_id = case.get("query_vector_id")
    response = engine.search(
        case["query"],
        mode=case["mode"],
        top_k=case["top_k"],
        include_scopes=case.get("include_scopes", ()),
        exclude_scopes=case.get("exclude_scopes", ()),
        scope_priorities=case.get("scope_priorities"),
        authority_policy=case.get("authority_policy", "all"),
        vectors=bundle["record_vectors"] if vector_id is not None else None,
        query_vector=bundle["query_vectors"].get(vector_id) if vector_id is not None else None,
        query_embedding_profile_id=bundle["vector_profile_id"] if vector_id is not None else None,
        semantic_enabled=case.get("semantic_enabled", True),
        semantic_fallback_reason=case.get("semantic_fallback_reason"),
        expand=case.get("expand", True),
        max_context_tokens=case.get("max_context_tokens"),
    )
    return response_observation(response)


def response_observation(response: Any) -> dict[str, Any]:
    ordered_ids = [result.record.id for result in response.results]
    return {
        "eligible_ids": list(response.eligible_ids),
        "candidate_ids": list(response.candidate_ids),
        "ordered_ids": ordered_ids,
        "scores": [
            {
                "id": result.record.id,
                "score_micro": result.score_micro,
                "components": result.component_mapping(),
                "cross_reference_from_id": result.cross_reference_from_id,
            }
            for result in response.results
        ],
        "context_selected_ids": ordered_ids,
        "context_tokens": response.context_tokens,
        "truncated": response.truncated,
        "semantic_state": response.semantic_state,
        "semantic_fallback_reason": response.semantic_fallback_reason,
        "errors": list(response.errors),
    }


def actual_observations(contract_root: Path | None = None) -> dict[str, dict[str, Any]]:
    bundle = load_contract(contract_root, require_expected=False)
    return {case["id"]: execute_case(bundle, case) for case in bundle["cases"]}


def _repository_state() -> dict[str, Any]:
    return repository_state(ROOT)


def run_contract(contract_root: Path | None = None) -> dict[str, Any]:
    bundle = load_contract(contract_root)
    results: list[dict[str, Any]] = []
    for case in bundle["cases"]:
        actual = execute_case(bundle, case)
        expected = bundle["expected"][case["id"]]
        results.append(
            {
                "id": case["id"],
                "mode": case["mode"],
                "passed": actual == expected,
                "expected": expected,
                "actual": actual,
            }
        )
    passed = sum(result["passed"] for result in results)
    report = {
        "contract": REPORT_CONTRACT,
        "profile_id": PROFILE_ID,
        "runner": {
            "implementation": "rag-method-py",
            "language": "python",
            "version": 1,
        },
        "repository": _repository_state(),
        "summary": {
            "cases": len(results),
            "passed": passed,
            "failed": len(results) - passed,
        },
        "results": results,
    }
    from scripts.rag_three_way_diff import validate_report

    validate_report(report, "Python adapter report")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--contract-root",
        type=Path,
        default=ROOT / "contracts" / CONTRACT_ID,
    )
    parser.add_argument("--json", action="store_true", help="emit the full report")
    parser.add_argument(
        "--actual",
        action="store_true",
        help="emit actual observations without loading frozen expectations",
    )
    args = parser.parse_args()
    try:
        if args.actual:
            print(json.dumps(actual_observations(args.contract_root), indent=2, sort_keys=True))
            return 0
        report = run_contract(args.contract_root)
    except (OSError, TypeError, ValueError, json.JSONDecodeError, subprocess.SubprocessError) as exc:
        print(f"RAG behavior contract validation failed: {exc}", file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        summary = report["summary"]
        print(
            f"RAG behavior v2: {summary['passed']}/{summary['cases']} cases passed"
        )
    return 0 if report["summary"]["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
