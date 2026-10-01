# Method and ownership

RAG Method separates reproducible retrieval behavior from application storage, UI, models, and rendering.

| Boundary | Owner | Observable contract |
| --- | --- | --- |
| Raw Markdown/text indexing | `contracts/rag-indexing-v1/` | Strict decode, normalized text, scalar offsets, bounded chunks, portable identities, references, and stable errors. |
| Retrieval | `contracts/rag-behavior-v2/` | Eligibility, candidates, fixed-point scores, deterministic ordering, source diversity, selected context, semantic state, and stable errors. |
| Python reference | `source/backend/mirrorlight_backend/rag_core/` | The same method functions serve the oracle and production backend. |
| Browser implementation | `modules/browser-rag-ts/src/core/` | Independent TypeScript behavior with frozen fixtures and Python-compatible Unicode tables. |
| Local Lab | `source/backend/` and `source/frontend/` | Bounded imports, durable generations, HTTP v1, typed display, optional vectors, and query reports. |
| Browser explorer | `modules/browser-rag-ts/src/application/` and `demo/` | Transactional Worker indexing, cancellation, source reading, context inspection, graph projection, and responsive presentation. |
| Force graph | Vendored `@ours/forcegraph-tsl` | Reusable math, layout, camera, Worker, and injected Three/TSL rendering. |

The frozen contracts are language-neutral: adapters compare actual observations with pinned expectations. An implementation must not rewrite expected results to make itself conform. A behavioral change requires a new contract version. The manifests retain historical adapter ancestry; the other projects named there are not required to run this repository.

Indexing accepts strict UTF-8 Markdown/text, rejects traversal and invalid scalar input, normalizes a defined profile, and emits bounded non-overlapping chunks. Offsets count Unicode scalars rather than UTF-8 bytes or UTF-16 code units. Retrieval exposes exact, keyword, semantic, hybrid, and scoped-hybrid modes, uses integer micro-unit score components, applies deny-first scope filtering, and assembles bounded source-diverse context.

The demonstrations use lexical evidence by default. Disabled semantic retrieval is reported explicitly. The Lab's optional hash-vector provider is deterministic integration scaffolding, not an embedding model. No model, credential, or answer-generation service is bundled.

Graph neighborhoods help inspect the accepted corpus and selected evidence. Projection, coloring, camera state, and rendering are application concerns outside the frozen method; they cannot alter ranking or context selection. The browser application retains SVG/list recovery when managed rendering is unavailable.

Run `node run.mjs test-method` for the 12 raw-indexing and 15 retrieval reference cases. Browser unit tests cover the independent TypeScript implementation; `test-browser` compares Python, Node, and actual Worker observations through the application journey.
