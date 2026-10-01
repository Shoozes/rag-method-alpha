from __future__ import annotations

from collections.abc import Iterable, Mapping

from .types import RagRecord


RECORDED_AUTHORITIES = frozenset(
    {"global_record", "workspace_record", "persona_vault"}
)


def allowed_by_scope(
    record: RagRecord,
    include_scopes: Iterable[str] = (),
    exclude_scopes: Iterable[str] = (),
) -> bool:
    """Apply exclusions before inclusions across every record scope."""

    include = {str(scope).strip() for scope in include_scopes if str(scope).strip()}
    exclude = {str(scope).strip() for scope in exclude_scopes if str(scope).strip()}
    record_scopes = set(record.scopes)
    if "all" in exclude or record_scopes.intersection(exclude):
        return False
    return not include or "all" in include or bool(record_scopes.intersection(include))


def allowed_by_authority(record: RagRecord, authority_policy: str) -> bool:
    if authority_policy == "all":
        return True
    if authority_policy == "recorded_only":
        return record.authority in RECORDED_AUTHORITIES
    return False


def matching_scope_priority(
    record: RagRecord,
    priorities: Mapping[str, int],
) -> int:
    values = [priorities[scope] for scope in record.scopes if scope in priorities]
    return max(values, default=0)
