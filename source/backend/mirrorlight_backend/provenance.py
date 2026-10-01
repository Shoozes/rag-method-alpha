"""Deterministic local scope and source provenance for indexed material."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SourceProvenance:
    """Describe origin and its source class without asserting factual truth."""

    scope: str
    authority: str
    source_id: str

    def as_fields(self) -> dict[str, object]:
        return {
            "scope": self.scope,
            "authority": self.authority,
            "source_id": self.source_id,
            "provenance": {
                "scope": self.scope,
                "authority": self.authority,
                "source_id": self.source_id,
            },
        }


def build_provenance(
    pocket: str,
    companion_id: str | None,
    source: str,
    relative_path: str,
) -> SourceProvenance:
    """Build one stable scope/source identity for a document and its chunks."""

    if pocket == "global" or not companion_id:
        scope = "global" if pocket == "global" else f"pocket:{pocket}"
    else:
        scope = f"persona:{companion_id}"
    if pocket == "memories":
        authority = "conversation_memory"
    elif pocket == "global":
        authority = "global_record"
    elif companion_id:
        authority = "persona_vault"
    else:
        authority = "workspace_record"
    source_id = "::".join((scope, pocket, source, relative_path))
    return SourceProvenance(scope=scope, authority=authority, source_id=source_id)
