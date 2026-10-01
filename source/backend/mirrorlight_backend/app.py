from __future__ import annotations

import asyncio
import hmac
import logging
import shutil
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response

from . import __version__
from .config import Settings, normalize_host_header, normalize_trusted_origin
from .core import DEFAULT_POCKETS, RagService
from .importer import ImportErrorBase, VaultImporter
from .index_store import IndexStoreLimitError
from .indexer import IndexLimitError, SourceChangedError
from .models import (
    API_CONTRACT_VERSION,
    AssignmentRegistryResponse,
    AssignmentRequest,
    AssignmentResponse,
    CompanionListResponse,
    CompanionResponse,
    CreateCompanionRequest,
    GraphResponse,
    HealthResponse,
    ImportResponse,
    MemoryRequest,
    MemoryResponse,
    RagBehaviorMode,
    SearchResponse,
    VaultRegistryResponse,
    VaultRequest,
    VaultResponse,
)
from .rag_core.types import (
    ContractError,
    MAX_CONTEXT_TOKENS,
    MAX_QUERY_UTF8_BYTES,
    validate_query,
)
from .operations import CancellationToken, OperationCancelled
from .paths import (
    UnsafePathError,
    resolve_under,
    safe_upload_key,
    safe_upload_path,
    upload_keys_conflict,
    validate_companion_id,
)
from .pockets import PersonaLimitError, VaultIdentityCollisionError, validate_vault_id


_CHUNK_SIZE = 1024 * 1024
_LOGGER = logging.getLogger(__name__)
_MUTATION_REQUEST_HEADER = "X-RAG-Method-Request"
_MUTATION_REQUEST_VALUE = "1"
_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def _relative_to_data(settings: Settings, path: Path) -> str:
    return resolve_under(settings.data_root, path).relative_to(settings.data_root).as_posix()


async def _save_upload(upload: UploadFile, destination: Path, max_bytes: int) -> int:
    total = 0
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("wb") as target:
        while True:
            chunk = await upload.read(_CHUNK_SIZE)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise HTTPException(status_code=413, detail="upload is too large")
            target.write(chunk)
    return total


def _import_response(service: RagService, result: dict[str, Any]) -> dict[str, Any]:
    try:
        service.refresh()
        service.clear_cache()
        warmed = service.build_index(result["id"], DEFAULT_POCKETS)
        return {"status": "ok", **result, "fingerprint": warmed["fingerprint"]}
    except Exception:
        try:
            service.remove_companion(result["id"])
        except Exception as cleanup_error:
            _LOGGER.error(
                "Failed to roll back imported companion %s after index warm-up failure: %s",
                result.get("id"),
                cleanup_error,
            )
        raise


def _import_and_warm(
    service: RagService,
    import_function: Any,
    source: Path,
    companion_id: str | None,
) -> dict[str, Any]:
    with service.operation_lock:
        service.refresh()
        result = import_function(source, preferred_id=companion_id or None)
        return _import_response(service, result)


def _vault_registry(service: RagService, settings: Settings) -> dict[str, dict[str, str]]:
    with service.operation_lock:
        service.refresh()
        return {
            vault_id: _relative_to_data(settings, path)
            for vault_id, path in sorted(service.pockets.vault_registry.items())
        }


def _assignment_registry(service: RagService) -> dict[str, list[str]]:
    with service.operation_lock:
        service.refresh()
        return {
            companion_id: list(vault_ids)
            for companion_id, vault_ids in sorted(service.pockets.assignments.items())
        }


def _register_vault(
    service: RagService,
    settings: Settings,
    vault_id: str,
    raw_path: str,
) -> dict[str, str]:
    candidate = Path(raw_path)
    if not candidate.is_absolute():
        candidate = settings.global_root / candidate
    with service.operation_lock:
        canonical_id = service.pockets.register_vault(vault_id, candidate)
        safe_path = service.pockets.vault_registry[canonical_id]
        service.clear_cache()
    return {
        "status": "ok",
        "id": canonical_id,
        "path": _relative_to_data(settings, safe_path),
    }


def _set_assignments(
    service: RagService,
    companion_id: str,
    vault_ids: list[str],
) -> dict[str, Any]:
    with service.operation_lock:
        service.refresh()
        service.pockets.assign_vaults(companion_id, vault_ids)
        service.clear_cache()
        return {
            "status": "ok",
            "companion_id": companion_id,
            "vault_ids": service.pockets.assignments.get(companion_id, []),
        }


def _server_error(code: str, exc: Exception, debug: bool) -> JSONResponse:
    _LOGGER.exception("%s failed", code)
    content: dict[str, str] = {"error": code}
    if debug:
        content["detail"] = str(exc)
    else:
        content["detail"] = "The request could not be completed. Check the backend log for details."
    return JSONResponse(status_code=500, content=content)


def _http_error_code(status_code: int) -> str:
    return {
        400: "invalid_request",
        401: "authentication_required",
        403: "forbidden",
        404: "not_found",
        409: "conflict",
        413: "limit_exceeded",
        408: "request_timeout",
        499: "request_cancelled",
    }.get(status_code, "request_failed")


async def _run_with_disconnect(
    request: Request,
    function: Any,
    *args: Any,
    **kwargs: Any,
) -> Any:
    """Run blocking RAG work while giving a disconnected client a stop signal."""

    token = CancellationToken()
    operation = asyncio.create_task(
        run_in_threadpool(function, *args, cancel_token=token, **kwargs)
    )
    try:
        while not operation.done():
            await asyncio.wait({operation}, timeout=0.05)
            if operation.done():
                break
            if await request.is_disconnected():
                token.cancel()
        return await operation
    finally:
        # Coroutine cancellation (for example during server shutdown) does not
        # stop a worker thread. Always signal the cooperative token and cancel
        # the asyncio wrapper so no detached task is left behind.
        token.cancel()
        if not operation.done():
            operation.cancel()


def create_app(settings: Settings | None = None) -> FastAPI:
    """Create the active Mirrorlight API without reading the archived project."""

    active_settings = settings or Settings.from_env()
    active_settings.validate_network_boundary()
    active_settings.ensure_runtime_dirs()
    service = RagService(active_settings)
    importer = VaultImporter(active_settings, service.pockets)

    app = FastAPI(title="Mirrorlight RAG API", version=__version__)
    app.state.settings = active_settings
    app.state.rag = service
    app.state.importer = importer
    app.state.api_contract_version = API_CONTRACT_VERSION

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        detail = [
            {
                "location": [str(value) for value in error.get("loc", ())],
                "message": str(error.get("msg", "invalid request")),
                "type": str(error.get("type", "validation_error")),
            }
            for error in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content={"error": "validation_error", "detail": detail},
            headers={"X-Mirrorlight-API-Version": API_CONTRACT_VERSION},
        )

    @app.exception_handler(HTTPException)
    async def http_error(_request: Request, exc: HTTPException) -> JSONResponse:
        detail = exc.detail
        error = _http_error_code(exc.status_code)
        if isinstance(detail, dict) and isinstance(detail.get("error"), str):
            error = detail["error"]
            detail = detail.get("detail", detail)
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": error, "detail": detail},
            headers={"X-Mirrorlight-API-Version": API_CONTRACT_VERSION},
        )

    @app.middleware("http")
    async def request_boundary(request: Request, call_next: Any) -> Response:
        boundary_headers = {"X-Mirrorlight-API-Version": API_CONTRACT_VERSION}
        try:
            request_host = normalize_host_header(request.headers.get("host", ""))
        except ValueError:
            return JSONResponse(
                status_code=400,
                headers=boundary_headers,
                content={"error": "untrusted_host", "detail": "Request Host is invalid or missing"},
            )
        if request_host not in active_settings.trusted_hosts:
            return JSONResponse(
                status_code=400,
                headers=boundary_headers,
                content={"error": "untrusted_host", "detail": "Request Host is not trusted"},
            )

        if request.method.upper() not in _SAFE_METHODS:
            if request.headers.get(_MUTATION_REQUEST_HEADER) != _MUTATION_REQUEST_VALUE:
                return JSONResponse(
                    status_code=403,
                    headers=boundary_headers,
                    content={
                        "error": "mutation_header_required",
                        "detail": f"{_MUTATION_REQUEST_HEADER}: {_MUTATION_REQUEST_VALUE} is required for state-changing requests",
                    },
                )
            supplied_origin = request.headers.get("origin")
            if supplied_origin is not None:
                try:
                    request_origin = normalize_trusted_origin(supplied_origin)
                except ValueError:
                    request_origin = ""
                if request_origin not in active_settings.trusted_origins:
                    return JSONResponse(
                        status_code=403,
                        headers=boundary_headers,
                        content={"error": "untrusted_origin", "detail": "Request Origin is not trusted"},
                    )

        if active_settings.remote_mode and request.url.path != "/health":
            authorization = request.headers.get("authorization", "")
            scheme, _, supplied = authorization.partition(" ")
            if (
                scheme.lower() != "bearer"
                or not supplied
                or not hmac.compare_digest(supplied, active_settings.auth_token)
            ):
                return JSONResponse(
                    status_code=401,
                    headers={**boundary_headers, "WWW-Authenticate": "Bearer"},
                    content={
                        "error": "authentication_required",
                        "detail": "Bearer authentication is required in remote mode",
                    },
                )
        response = await call_next(request)
        response.headers["X-Mirrorlight-API-Version"] = API_CONTRACT_VERSION
        return response

    @app.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return {"status": "ok", "version": __version__}

    @app.get("/api/companions", response_model=CompanionListResponse)
    async def list_companions() -> CompanionListResponse:
        return {"companions": await run_in_threadpool(service.list_companions)}

    @app.post("/api/companions", response_model=CompanionResponse)
    async def create_companion(payload: CreateCompanionRequest) -> CompanionResponse:
        companion_id = (payload.id or "").strip()
        raw_persona = payload.persona
        persona = (raw_persona or "").strip()
        if not companion_id:
            raise HTTPException(status_code=400, detail="id is required")
        try:
            return await run_in_threadpool(service.create_companion, companion_id, persona)
        except PersonaLimitError as exc:
            raise HTTPException(status_code=413, detail=str(exc)) from exc
        except FileExistsError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/memory", response_model=MemoryResponse)
    async def set_memory(payload: MemoryRequest) -> MemoryResponse:
        effective = await run_in_threadpool(service.set_memory_enabled, payload.enabled)
        return {"enabled": effective, "persistence": "disk"}

    @app.get("/rag/vaults", response_model=VaultRegistryResponse)
    async def get_vaults() -> VaultRegistryResponse:
        registry = await run_in_threadpool(_vault_registry, service, active_settings)
        return {"registry": registry}

    @app.post("/rag/vaults", response_model=VaultResponse)
    async def register_vault(payload: VaultRequest) -> VaultResponse:
        vault_id = (payload.id or "").strip()
        raw_path = (payload.path or "").strip()
        if not vault_id or not raw_path:
            raise HTTPException(status_code=400, detail="id and path are required")
        try:
            validate_vault_id(vault_id)
            return await run_in_threadpool(
                _register_vault,
                service,
                active_settings,
                vault_id,
                raw_path,
            )
        except VaultIdentityCollisionError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except (UnsafePathError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except OSError as exc:
            raise HTTPException(status_code=500, detail="vault path could not be created") from exc

    @app.get("/rag/assignments", response_model=AssignmentRegistryResponse)
    async def get_assignments() -> AssignmentRegistryResponse:
        assignments = await run_in_threadpool(_assignment_registry, service)
        return {"assignments": assignments}

    @app.post("/rag/assignments", response_model=AssignmentResponse)
    async def set_assignments(payload: AssignmentRequest) -> AssignmentResponse:
        companion_id = (payload.companion_id or "").strip()
        vault_ids = list(payload.vault_ids)
        if not companion_id:
            raise HTTPException(status_code=400, detail="companion_id is required")
        try:
            validate_companion_id(companion_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        try:
            return await run_in_threadpool(_set_assignments, service, companion_id, vault_ids)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/rag/import/vault-zip", response_model=ImportResponse)
    async def import_vault_zip(
        file: UploadFile = File(...),
        companion_id: str | None = Form(None),
    ) -> ImportResponse:
        temporary_zip: Path | None = None
        try:
            filename = file.filename or ""
            if not filename.lower().endswith(".zip"):
                raise HTTPException(status_code=400, detail="please upload a .zip file")
            temporary_zip = active_settings.uploads_root / f"upload_{uuid.uuid4().hex}.zip"
            await _save_upload(file, temporary_zip, active_settings.max_upload_bytes)
            return await run_in_threadpool(
                _import_and_warm,
                service,
                importer.import_zip,
                temporary_zip,
                companion_id,
            )
        except HTTPException:
            raise
        except (IndexLimitError, IndexStoreLimitError) as exc:
            raise HTTPException(status_code=413, detail=str(exc)) from exc
        except SourceChangedError as exc:
            raise HTTPException(
                status_code=409,
                detail={"error": "source_changed", "detail": str(exc)},
            ) from exc
        except (ImportErrorBase, UnsafePathError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            return _server_error("import_failed", exc, active_settings.debug_errors)
        finally:
            if temporary_zip is not None:
                temporary_zip.unlink(missing_ok=True)

    @app.post("/rag/import/folder-upload", response_model=ImportResponse)
    async def import_folder_upload(
        files: list[UploadFile] = File(...),
        companion_id: str | None = Form(None),
    ) -> ImportResponse:
        if not files:
            raise HTTPException(status_code=400, detail="no files received")
        if len(files) > active_settings.max_upload_files:
            raise HTTPException(status_code=413, detail="too many files in folder upload")

        stage = active_settings.uploads_root / f"stage_{uuid.uuid4().hex}"
        try:
            stage.mkdir(parents=True, exist_ok=True)
            saved: list[Path] = []
            seen: set[str] = set()
            total = 0
            for upload in files:
                raw_name = upload.filename or ""
                try:
                    destination = safe_upload_path(stage, raw_name)
                    upload_key = safe_upload_key(raw_name)
                except UnsafePathError as exc:
                    raise HTTPException(status_code=400, detail=str(exc)) from exc
                if upload_keys_conflict(upload_key, seen):
                    raise HTTPException(status_code=400, detail=f"duplicate or conflicting upload path: {raw_name}")
                seen.add(upload_key)
                try:
                    total += await _save_upload(
                        upload,
                        destination,
                        active_settings.max_upload_bytes - total,
                    )
                except (FileExistsError, IsADirectoryError) as exc:
                    raise HTTPException(
                        status_code=400,
                        detail=f"conflicting upload path: {raw_name}",
                    ) from exc
                saved.append(destination)

            first_levels = {
                path.relative_to(stage).parts[0]
                for path in saved
                if path.relative_to(stage).parts
            }
            root = stage
            if len(first_levels) == 1:
                candidate = stage / next(iter(first_levels))
                if candidate.is_dir():
                    root = candidate

            return await run_in_threadpool(
                _import_and_warm,
                service,
                importer.import_folder,
                root,
                companion_id,
            )
        except HTTPException:
            raise
        except (IndexLimitError, IndexStoreLimitError) as exc:
            raise HTTPException(status_code=413, detail=str(exc)) from exc
        except (ImportErrorBase, UnsafePathError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            return _server_error("import_failed", exc, active_settings.debug_errors)
        finally:
            if stage.exists():
                shutil.rmtree(stage, ignore_errors=True)

    @app.get("/rag/graph", response_model=GraphResponse)
    async def rag_graph(
        request: Request,
        companion_id: str | None = None,
        pockets: str | None = None,
        force: int = Query(default=0, ge=0, le=1),
    ) -> GraphResponse:
        try:
            return await _run_with_disconnect(
                request,
                service.graph,
                companion_id,
                pockets,
                bool(force),
                active_settings.max_graph_response_nodes,
                active_settings.max_graph_response_links,
            )
        except (IndexLimitError, IndexStoreLimitError) as exc:
            raise HTTPException(status_code=413, detail=str(exc)) from exc
        except OperationCancelled as exc:
            raise HTTPException(status_code=499, detail=str(exc)) from exc
        except SourceChangedError as exc:
            raise HTTPException(
                status_code=409,
                detail={"error": "source_changed", "detail": str(exc)},
            ) from exc
        except (UnsafePathError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            return _server_error("graph_failed", exc, active_settings.debug_errors)

    @app.get("/rag/search", response_model=SearchResponse)
    async def rag_search(
        request: Request,
        query: str,
        companion_id: str | None = None,
        pockets: str | None = None,
        top_k: int = 5,
        mode: RagBehaviorMode = "scoped_hybrid",
        max_context_tokens: int = MAX_CONTEXT_TOKENS,
        debug: int = Query(default=0, ge=0, le=1),
        force: int = Query(default=0, ge=0, le=1),
    ) -> SearchResponse:
        if top_k < 1 or top_k > active_settings.max_top_k:
            raise HTTPException(
                status_code=400,
                detail=f"top_k must be between 1 and {active_settings.max_top_k}",
            )
        if max_context_tokens < 1 or max_context_tokens > MAX_CONTEXT_TOKENS:
            raise HTTPException(
                status_code=400,
                detail=f"max_context_tokens must be between 1 and {MAX_CONTEXT_TOKENS}",
            )
        try:
            validate_query(
                query,
                max_chars=active_settings.max_query_chars,
                max_utf8_bytes=MAX_QUERY_UTF8_BYTES,
            )
        except ContractError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        try:
            return await _run_with_disconnect(
                request,
                service.search,
                query,
                companion_id,
                pockets,
                top_k=top_k,
                debug=bool(debug),
                force=bool(force),
                mode=mode,
                max_context_tokens=max_context_tokens,
            )
        except (IndexLimitError, IndexStoreLimitError) as exc:
            raise HTTPException(status_code=413, detail=str(exc)) from exc
        except OperationCancelled as exc:
            raise HTTPException(status_code=499, detail=str(exc)) from exc
        except SourceChangedError as exc:
            raise HTTPException(
                status_code=409,
                detail={"error": "source_changed", "detail": str(exc)},
            ) from exc
        except (UnsafePathError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            return _server_error("search_failed", exc, active_settings.debug_errors)

    return app
