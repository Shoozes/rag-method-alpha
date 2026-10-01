from __future__ import annotations

import json
import logging
import os
import re
import shutil
import unicodedata
import uuid
from pathlib import Path
from typing import Dict, List, Optional

from .config import Settings
from .paths import resolve_under, validate_companion_id


_LOGGER = logging.getLogger(__name__)


class PersonaLimitError(ValueError):
    """Raised when persona metadata would exceed the index-file budget."""


class VaultIdentityCollisionError(ValueError):
    """Raised when canonical vault IDs would overwrite different paths."""


_VAULT_SUFFIX = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


def validate_vault_id(value: str) -> str:
    """Return one canonical, filesystem-independent global vault ID."""

    raw = (value or "").strip()
    if ":" not in raw or raw.split(":", 1)[0].casefold() != "global":
        raise ValueError("vault id must start with 'global:'")
    suffix = unicodedata.normalize("NFKC", raw.split(":", 1)[1]).casefold()
    suffix = re.sub(r"[^a-z0-9_-]+", "_", suffix).strip("_-")
    if not _VAULT_SUFFIX.fullmatch(suffix or ""):
        raise ValueError("vault id must contain 1-64 letters, numbers, hyphens, or underscores")
    return f"global:{suffix}"


def bounded_memory_payload(settings: Settings, persona: str) -> str:
    payload = json.dumps({"persona": persona, "memories": []}, indent=2, ensure_ascii=False) + "\n"
    if len(payload.encode("utf-8")) > settings.max_index_file_bytes:
        raise PersonaLimitError(
            f"persona metadata exceeds the index file limit ({settings.max_index_file_bytes} bytes)"
        )
    return payload


def _write_json_atomic(path: Path, payload: dict, serialized: str | None = None) -> None:
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        content = serialized if serialized is not None else json.dumps(payload, indent=2) + "\n"
        temporary.write_text(content, encoding="utf-8")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


class PocketManager:
    """Owns active runtime paths and companion/global registrations."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.settings.ensure_runtime_dirs()
        self.pockets: Dict[str, Dict[str, Optional[Path]]] = {}
        self.vault_registry: Dict[str, Path] = {}
        self.assignments: Dict[str, List[str]] = {}
        self.memory_enabled = True
        self.refresh()

    @property
    def global_pocket(self) -> Path:
        return self.settings.global_root

    @staticmethod
    def _companion_identity(companion_id: str) -> str:
        return unicodedata.normalize("NFKC", companion_id).casefold()

    def companion_id_in_use(self, companion_id: str) -> bool:
        """Use one identifier-collision rule on every supported filesystem."""

        identity = self._companion_identity(validate_companion_id(companion_id))
        return any(
            self._companion_identity(existing_id) == identity
            for existing_id in self.pockets
        )

    def refresh(self) -> None:
        self.pockets.clear()
        self.vault_registry.clear()
        self.assignments.clear()
        self._scan_companions()
        self._scan_global_subdirs()
        self._load_state()

    @property
    def state_path(self) -> Path:
        return self.settings.data_root / "state.json"

    def _load_state(self) -> None:
        if not self.state_path.is_file():
            self.memory_enabled = True
            return
        try:
            payload = json.loads(self.state_path.read_text(encoding="utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("state must be an object")
            version = payload.get("version", 1)
            if version != 1:
                raise ValueError("unsupported state version")
            raw_memory_enabled = payload.get("memory_enabled", True)
            if not isinstance(raw_memory_enabled, bool):
                raise ValueError("memory_enabled must be a boolean")
            self.memory_enabled = raw_memory_enabled
            raw_assignments = payload.get("assignments", {})
            if not isinstance(raw_assignments, dict):
                raise ValueError("assignments must be an object")
            for raw_companion, raw_vaults in raw_assignments.items():
                companion_id = str(raw_companion)
                try:
                    validate_companion_id(companion_id)
                except ValueError:
                    continue
                if companion_id not in self.pockets or not isinstance(raw_vaults, list):
                    continue
                restored: list[str] = []
                for value in raw_vaults:
                    try:
                        vault_id = validate_vault_id(str(value))
                    except ValueError:
                        continue
                    if vault_id in self.vault_registry and vault_id not in restored:
                        restored.append(vault_id)
                self.assignments[companion_id] = restored
        except (OSError, TypeError, ValueError, json.JSONDecodeError) as exc:
            self.memory_enabled = False
            self.assignments.clear()
            _LOGGER.warning("Ignoring malformed runtime state at %s: %s", self.state_path, exc)

    def _save_state(self) -> None:
        assignments = {
            companion_id: [vault_id for vault_id in vault_ids if vault_id in self.vault_registry]
            for companion_id, vault_ids in self.assignments.items()
            if companion_id in self.pockets
        }
        _write_json_atomic(
            self.state_path,
            {
                "version": 1,
                "memory_enabled": bool(self.memory_enabled),
                "assignments": assignments,
            },
        )

    def set_memory_enabled(self, enabled: bool) -> bool:
        self.memory_enabled = bool(enabled)
        self._save_state()
        return self.memory_enabled

    def _scan_companions(self) -> None:
        try:
            directories = sorted(self.settings.companions_root.iterdir())
        except OSError:
            return
        for directory in directories:
            if (
                not directory.is_dir()
                or directory.is_symlink()
                or directory.name.startswith(".")
            ):
                continue
            try:
                validate_companion_id(directory.name)
                self.add_companion_pocket(directory.name, create=False)
            except (ValueError, OSError):
                continue

    def _scan_global_subdirs(self) -> None:
        try:
            directories = sorted(self.global_pocket.iterdir())
        except OSError:
            return
        for directory in directories:
            try:
                if (
                    directory.is_dir()
                    and not directory.is_symlink()
                    and not directory.name.startswith(".")
                ):
                    self.register_vault(f"global:{directory.name}", directory)
            except VaultIdentityCollisionError:
                raise
            except (OSError, ValueError):
                continue

    def companion_root(self, companion_id: str) -> Path:
        validate_companion_id(companion_id)
        return resolve_under(self.settings.companions_root, self.settings.companions_root / companion_id)

    def memory_file(self, companion_id: str) -> Path:
        root = self.companion_root(companion_id)
        candidates = (
            root / f"{companion_id}.memory.json",
            root / f"{companion_id.lower().replace(' ', '_')}.memory.json",
            root / "memory.json",
        )
        return next((candidate for candidate in candidates if candidate.is_file()), candidates[1])

    def add_companion_pocket(
        self,
        companion_id: str,
        vault_dir: Path | None = None,
        memories_file: Path | None = None,
        create: bool = True,
    ) -> None:
        if companion_id not in self.pockets and self.companion_id_in_use(companion_id):
            raise FileExistsError(
                f"companion ID collides with an existing companion: {companion_id}"
            )
        root = self.companion_root(companion_id)
        vault = vault_dir or root / "vault"
        lore = root / "lore"
        memories = memories_file or self.memory_file(companion_id)
        for path in (vault, lore, memories):
            resolve_under(root, path)
        if create:
            vault.mkdir(parents=True, exist_ok=True)
            lore.mkdir(parents=True, exist_ok=True)
            memories.parent.mkdir(parents=True, exist_ok=True)
        self.pockets[companion_id] = {
            "vault": vault,
            "lore": lore if lore.is_dir() else None,
            "memories": memories,
        }

    def create_companion(self, companion_id: str, persona: str = "") -> None:
        validate_companion_id(companion_id)
        memory_payload = bounded_memory_payload(self.settings, persona)
        root = self.companion_root(companion_id)
        if root.exists() or self.companion_id_in_use(companion_id):
            raise FileExistsError(f"companion already exists: {companion_id}")
        temporary_root = self.settings.companions_root / f".staging-{uuid.uuid4().hex}"
        promoted = False
        try:
            (temporary_root / "vault").mkdir(parents=True, exist_ok=True)
            (temporary_root / "lore").mkdir(parents=True, exist_ok=True)
            _write_json_atomic(
                temporary_root / f"{companion_id.lower().replace(' ', '_')}.memory.json",
                {"persona": persona, "memories": []},
                serialized=memory_payload,
            )
            temporary_root.replace(root)
            promoted = True
            self.refresh()
        except Exception:
            if promoted and root.exists():
                shutil.rmtree(root, ignore_errors=True)
            shutil.rmtree(temporary_root, ignore_errors=True)
            raise

    def remove_companion(self, companion_id: str) -> bool:
        """Remove a companion created by a failed transactional workflow."""

        root = self.companion_root(companion_id)
        if root.is_symlink() or not root.is_dir():
            return False
        shutil.rmtree(root)
        self.refresh()
        self._save_state()
        return True

    def register_vault(self, vault_id: str, path: Path) -> str:
        canonical_id = validate_vault_id(vault_id)
        candidate = Path(path)
        if candidate.is_symlink():
            raise ValueError("vault path must not be a symbolic link")
        safe_path = resolve_under(self.global_pocket, candidate)
        global_root = self.global_pocket.resolve(strict=False)
        if safe_path == global_root or safe_path.parent != global_root:
            raise ValueError("vault path must be a direct child of the global pocket")
        path_id = validate_vault_id(f"global:{safe_path.name}")
        if canonical_id != path_id:
            raise ValueError(f"vault id must match its directory name: {path_id}")
        existing = self.vault_registry.get(canonical_id)
        if existing is not None and existing != safe_path:
            raise VaultIdentityCollisionError(
                f"vault id {canonical_id!r} is already registered for {existing}"
            )
        if safe_path.exists() and not safe_path.is_dir():
            raise ValueError("vault path must be a directory")
        safe_path.mkdir(parents=True, exist_ok=True)
        self.vault_registry[canonical_id] = safe_path
        return canonical_id

    def assign_vaults(self, companion_id: str, vault_ids: List[str]) -> None:
        validate_companion_id(companion_id)
        if companion_id not in self.pockets:
            raise ValueError(f"unknown companion id: {companion_id}")
        canonical_ids = [validate_vault_id(vault_id) for vault_id in vault_ids]
        unknown = [vault_id for vault_id in canonical_ids if vault_id not in self.vault_registry]
        if unknown:
            raise ValueError(f"unknown vault ids: {unknown}")
        self.assignments[companion_id] = list(dict.fromkeys(canonical_ids or []))
        self._save_state()

    def resolve_named_pocket(self, companion_id: str | None, name: str) -> Path | None:
        normalized = (name or "").strip().lower()
        if normalized == "global":
            return self.global_pocket
        if not companion_id or companion_id not in self.pockets:
            return None
        return self.pockets[companion_id].get(normalized)

    def companion_ids(self) -> List[str]:
        return sorted(self.pockets)
