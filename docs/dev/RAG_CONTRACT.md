# Backend integration contract

Retrieval behavior is `rag-behavior-v2`, raw Markdown/text indexing is `rag-indexing-v1`, and the HTTP compatibility contract remains v1. [METHOD.md](../METHOD.md) maps method and application ownership; the frozen JSON profiles and fixtures own behavioral detail.

The internal package name `mirrorlight_backend`, compatibility route names, `companion_id`, and `MIRRORLIGHT_*` settings are retained API identifiers. User-facing applications call corpora Collections. These identifiers preserve compatibility with existing API clients.

## Routes

- `/health`: loopback readiness.
- `/api/companions` and `/api/memory`: Collections and effective memory-pocket state.
- `/rag/vaults` and `/rag/assignments`: corpus registrations and scoped assignments.
- `/rag/import/vault-zip` and `/rag/import/folder-upload`: bounded, staged imports.
- `/rag/graph`: bounded graph transport.
- `/rag/search`: exact, keyword, semantic, hybrid, and scoped-hybrid retrieval.

Responses carry `X-Mirrorlight-API-Version: v1`. Malformed typed payloads return the `validation_error` envelope with HTTP 422. Requests for detailed scores use the bounded `debug` option; ordinary responses omit the debug object.

## Local request boundary

The default API binds loopback. State-changing requests require an exact trusted Host, an exact trusted HTTP(S) Origin when present, and `X-RAG-Method-Request: 1` before parsing or staging uploads. Defaults trust loopback hostnames and the standard local Vite origin. The managed launcher supplies the dynamically selected frontend origin.

A non-loopback `MIRRORLIGHT_HOST` requires `MIRRORLIGHT_AUTH_TOKEN`; protected routes also require `Authorization: Bearer <token>`. The React browser client does not inject that credential, so authenticated remote browser use is outside the supported application journey.

## State, limits, and cancellation

`MIRRORLIGHT_PROJECT_ROOT` and `MIRRORLIGHT_DATA_ROOT` select project and mutable data locations. Default state lives below `runtime-data/mirrorlight/`, which is ignored. Configuration is validated in `source/backend/mirrorlight_backend/config.py`; malformed values fail visibly. Do not place tokens, imported notes, or runtime indices in committed source.

Imports validate filenames, containment, upload count/bytes, strict UTF-8 metadata, and indexing limits. They stage and clean temporary uploads; failed index warm-up rolls back newly promoted content. Vault registrations are non-symlink direct children with canonical IDs. Scoped assignments exclude sibling vaults.

Durable index generations validate persisted limits and checksums, retain a bounded revision count, and can be rebuilt. Optional vectors use checked sidecar persistence and a cross-process writer lease. The default mode is lexical/hybrid with semantic vectors disabled. The optional deterministic hash provider is an integration prototype, not a semantic model.

Graph/search work cooperatively checks client cancellation. Exact/keyword-only modes avoid query-embedding work. Source, scope, authority, provenance, ranking, and context fields are backend-owned; graph rendering and browser display never recompute scores.

Run `node run.mjs test-lab` for the active application tests and `test-method` for the independent frozen reference cases. The tests use temporary synthetic data, exercise loopback request boundaries, and clean their owned state.
