from __future__ import annotations

import json
import logging
import re
import shutil
import stat
import uuid
import zipfile
from pathlib import Path
from typing import Optional, Tuple

from .config import Settings
from .paths import UnsafePathError, is_under, resolve_under, safe_upload_key, safe_upload_path, slugify
from .pockets import PocketManager, bounded_memory_payload


_LOGGER = logging.getLogger(__name__)


class ImportErrorBase(RuntimeError):
    """Base error for bounded companion imports."""


_NAME_RE = re.compile(r"^\s*Name\s*:\s*(.+)$", flags=re.IGNORECASE | re.MULTILINE)


def _extract_persona(text: str) -> Tuple[str, str]:
    name_match = _NAME_RE.search(text)
    name = name_match.group(1).strip() if name_match else ""
    if not name:
        heading = re.search(r"^\s*#\s+(.+)$", text, flags=re.MULTILINE)
        name = heading.group(1).strip() if heading else ""
    return name, text.strip()


def _find_mind_md(root: Path) -> Optional[Path]:
    candidates = sorted(
        path
        for path in root.rglob("*")
        if path.is_file() and not path.is_symlink() and path.name.casefold() == "mind.md"
    )
    return min(candidates, key=lambda path: len(path.relative_to(root).parts)) if candidates else None


def _read_persona(path: Path, max_bytes: int) -> Tuple[str, str]:
    try:
        if path.stat().st_size > max_bytes:
            return "", ""
        return _extract_persona(path.read_text(encoding="utf-8"))
    except UnicodeDecodeError as exc:
        raise ImportErrorBase("persona source is not valid UTF-8") from exc
    except OSError as exc:
        raise ImportErrorBase(f"persona source could not be read: {path.name}") from exc


def _is_symlink(info: zipfile.ZipInfo) -> bool:
    mode = (info.external_attr >> 16) & 0xFFFF
    return stat.S_ISLNK(mode)


class VaultImporter:
    def __init__(self, settings: Settings, pocket_manager: PocketManager):
        self.settings = settings
        self.pockets = pocket_manager

    def _unique_id(self, raw_id: str) -> str:
        base = slugify(raw_id)
        candidate = base[:64]
        number = 2
        while (
            (self.settings.companions_root / candidate).exists()
            or self.pockets.companion_id_in_use(candidate)
        ):
            suffix = f"-{number}"
            candidate = f"{base[:64 - len(suffix)]}{suffix}"
            number += 1
        return candidate

    def _safe_extract_zip(self, zip_path: Path) -> Path:
        zip_path = resolve_under(self.settings.uploads_root, zip_path)
        if not zip_path.is_file():
            raise ImportErrorBase("uploaded archive not found")
        extraction_root = self.settings.uploads_root / f"unz_{uuid.uuid4().hex}"
        extraction_root.mkdir(parents=True, exist_ok=True)
        try:
            declared_total = 0
            extracted_total = 0
            with zipfile.ZipFile(zip_path, "r") as archive:
                infos = archive.infolist()
                if len(infos) > self.settings.max_upload_files:
                    raise ImportErrorBase("too many files in archive")
                seen_files: set[str] = set()
                seen_directories: set[str] = set()
                for info in infos:
                    if _is_symlink(info):
                        raise UnsafePathError("symbolic links are not allowed in archives")
                    destination = safe_upload_path(extraction_root, info.filename)
                    upload_key = safe_upload_key(info.filename)
                    if upload_key in seen_files or upload_key in seen_directories:
                        raise ImportErrorBase("archive contains duplicate paths")
                    if any(upload_key.startswith(existing + "/") for existing in seen_files):
                        raise ImportErrorBase("archive contains conflicting paths")
                    if info.is_dir():
                        if any(upload_key.startswith(existing + "/") for existing in seen_files):
                            raise ImportErrorBase("archive contains conflicting paths")
                        seen_directories.add(upload_key)
                    else:
                        if any(existing.startswith(upload_key + "/") for existing in seen_directories):
                            raise ImportErrorBase("archive contains conflicting paths")
                        seen_files.add(upload_key)
                    declared_total += info.file_size
                    if declared_total > self.settings.max_upload_bytes:
                        raise ImportErrorBase("archive is too large")
                    if info.is_dir():
                        destination.mkdir(parents=True, exist_ok=True)
                        continue
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(info, "r") as source, destination.open("wb") as target:
                        while True:
                            chunk = source.read(1024 * 1024)
                            if not chunk:
                                break
                            extracted_total += len(chunk)
                            if extracted_total > self.settings.max_upload_bytes:
                                raise ImportErrorBase("archive expands beyond the upload limit")
                            target.write(chunk)
            return extraction_root
        except zipfile.BadZipFile as exc:
            shutil.rmtree(extraction_root, ignore_errors=True)
            raise ImportErrorBase("invalid ZIP archive") from exc
        except Exception:
            shutil.rmtree(extraction_root, ignore_errors=True)
            raise

    @staticmethod
    def _archive_root(extracted: Path) -> Path:
        entries = sorted(path for path in extracted.iterdir() if path.name != "__MACOSX")
        return entries[0] if len(entries) == 1 and entries[0].is_dir() else extracted

    def _finish_import(self, root: Path, raw_id: str, persona: str) -> dict:
        memory_payload = bounded_memory_payload(self.settings, persona)
        companion_id = self._unique_id(raw_id)
        companion_root = self.settings.companions_root / companion_id
        temporary_root = self.settings.companions_root / f".staging-{uuid.uuid4().hex}"
        vault = temporary_root / "vault"
        lore = temporary_root / "lore"
        memory = temporary_root / f"{companion_id.lower().replace(' ', '_')}.memory.json"
        moved = False
        promoted = False
        try:
            temporary_root.mkdir(parents=True, exist_ok=True)
            shutil.move(str(root), str(vault))
            moved = True
            internal_lore = vault / "lore"
            if internal_lore.is_dir():
                shutil.move(str(internal_lore), str(lore))
            memory.write_text(memory_payload, encoding="utf-8")
            if companion_root.exists():
                raise FileExistsError(f"companion already exists: {companion_id}")
            temporary_root.replace(companion_root)
            promoted = True
            self.pockets.refresh()
        except Exception:
            promoted_vault = companion_root / "vault" if promoted else vault
            promoted_lore = companion_root / "lore" if promoted else lore
            if promoted_lore.is_dir() and promoted_vault.is_dir() and not (promoted_vault / "lore").exists():
                try:
                    shutil.move(str(promoted_lore), str(promoted_vault / "lore"))
                except OSError as cleanup_error:
                    _LOGGER.warning(
                        "Could not restore staged lore after import failure at %s: %s",
                        root,
                        cleanup_error,
                    )
            if moved and not root.exists() and promoted_vault.exists():
                try:
                    root.parent.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(promoted_vault), str(root))
                except OSError as cleanup_error:
                    _LOGGER.warning(
                        "Could not restore imported source after import failure at %s: %s",
                        root,
                        cleanup_error,
                    )
            if promoted and companion_root.exists():
                shutil.rmtree(companion_root, ignore_errors=True)
            shutil.rmtree(temporary_root, ignore_errors=True)
            raise
        return {
            "id": companion_id,
            "persona": persona,
            "vault_path": (companion_root / "vault").relative_to(self.settings.data_root).as_posix(),
            "lore_path": (companion_root / "lore").relative_to(self.settings.data_root).as_posix()
            if (companion_root / "lore").exists()
            else None,
            "memory_file": (companion_root / memory.name).relative_to(self.settings.data_root).as_posix(),
        }

    def import_zip(self, zip_path: Path, preferred_id: str | None = None) -> dict:
        extracted: Path | None = None
        try:
            extracted = self._safe_extract_zip(zip_path)
            root = self._archive_root(extracted)
            persona = ""
            name = ""
            mind = _find_mind_md(root)
            if mind:
                name, persona = _read_persona(mind, self.settings.max_index_file_bytes)
            raw_id = preferred_id or name or root.name
            return self._finish_import(root, raw_id, persona)
        finally:
            if extracted is not None and extracted.exists():
                shutil.rmtree(extracted, ignore_errors=True)

    def import_folder(self, folder_path: Path, preferred_id: str | None = None) -> dict:
        folder_path = resolve_under(self.settings.uploads_root, folder_path)
        if folder_path == self.settings.uploads_root or not folder_path.is_dir():
            raise ImportErrorBase("folder not found")
        try:
            persona = ""
            mind = _find_mind_md(folder_path)
            if mind:
                name, persona = _read_persona(mind, self.settings.max_index_file_bytes)
            else:
                name = ""
            return self._finish_import(folder_path, preferred_id or name or folder_path.name, persona)
        finally:
            if folder_path.exists() and is_under(self.settings.uploads_root, folder_path):
                shutil.rmtree(folder_path, ignore_errors=True)
