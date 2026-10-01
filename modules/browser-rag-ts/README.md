# Knowledge Atlas · browser RAG

A browser-native TypeScript implementation of the frozen RAG indexing/retrieval method, with a graph-first documentation explorer. It runs in a Worker without Python, uploads, persistence, or a model call.

The bundled example contains 921 pinned Three.js/TSL API and guide documents. Local Markdown/text and Obsidian-folder imports use bounded source selection. Replacing the accepted corpus is transactional: invalid input and acknowledged cancellation preserve the previous corpus. Rendering has explicit source/chunk mappings, shared evidence selection, responsive camera ownership, and SVG/list recovery.

From the repository root:

```text
node run.mjs setup-browser
node run.mjs browser-rag-run
```

The setup task explicitly installs this module's locked dependencies. From this directory, `npm run dev` also starts Vite directly. Run `npm run typecheck`, `npm test`, or `npm run build` with prepared dependencies; no run/test/build command installs them.

`src/core/` owns the independent method implementation. `src/worker/` owns its typed lifecycle and operation boundary. `src/application/` owns local file loading, source/context access, graph projection, renderer, and trace presentation. `src/presentation/` owns bounded replay of accepted graph state, without changing indexing or scoring. `demo/` owns the landing page and explorer. The separately reusable graph dependency is pinned under `vendor/`; its API never affects retrieval order.

Motion Studio offers **Replay build** and **Quiet** mode; operating-system reduced motion takes priority. The first-party node-scale helper is an MIT snapshot of [`tsl-smooth-graph-alpha`](https://github.com/Shoozes/tsl-smooth-graph-alpha/blob/2421a5938f73be86a774d1fd870d20c20cf1d5c0/examples/showcase/examples/runtime/node-spawn-motion.js). Native TSL rendering and the accessible SVG/list route use the same accepted graph and actual ranked evidence.

Generated contract snapshots and Python-compatible Unicode tables are shipped and checked against the frozen sources. Expected fixture data stays out of the production Worker bundle. Public artifact staging binds the actual source SHA-256 manifest and runtime notices; [release documentation](../../docs/RELEASE.md) explains ancestry-only fields in older report envelopes.

See [development commands](../../docs/DEVELOPMENT.md) for the explicit Python/Node/Worker browser journey and static output. Browser viewport emulation is not physical-device qualification; persistence, model-backed semantics, and unrestricted corpus sizes are outside the demonstrated release.
