# RAG Method Lab frontend

The React/Vite Lab presents backend-owned retrieval evidence, scores, provenance, context selection, and a synchronized graph. The initial view focuses on the query and ranked evidence; **Advanced tools** exposes the complete debugger through a persistent preference.

Use the [root setup guide](../../docs/user/SETUP.md) for a prepared Python/React Lab. From this directory, explicit frontend setup and checks are:

```text
npm ci --ignore-scripts --no-audit --no-fund
npm run dev
npm run typecheck
npm run build
```

Development proxies `/api/*` and `/rag/*` to `http://127.0.0.1:8080` by default. `VITE_BACKEND_URL` can select another loopback backend; the managed launcher supplies this value automatically. The client does not inject a remote bearer token.

`App` owns Collection/import/evidence selection. `useRagSearch` owns cancellation and supersession. `KnowledgeGraph` presents 3D and static recovery views. `EvidenceInspector`, `SimpleEvidence`, `ModeComparison`, and the versioned current-query report consume backend results rather than inventing scores. The graph has its own lazy chunk so the shell can paint first.

Run the explicit full Lab journey with `node run.mjs browser-smoke` from the repository root after dependencies and a compatible local Chromium browser are prepared. It covers demo reloads, controls, evidence/graph agreement, comparison, report validation, cancellation/recovery, imports, responsive containment, and cleanup. It does not download a browser.
