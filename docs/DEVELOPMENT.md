# Development and verification

Use `node run.mjs --list` to inspect the app-focused task declarations in `project.tasks.json`. `--dry-run` prints exact command arguments without executing them. The menu dispatches the existing Python scripts and package commands from one portable catalog. Setup is explicit; missing dependencies are reported.

| Task | Purpose | Prerequisites |
| --- | --- | --- |
| `test-method` | Frozen Python indexing and retrieval reference cases. | Python; standard library only. |
| `test-lab` | Active backend unit/failure/API/launcher tests and frontend type/build checks. | Prepared Python 3.12 environment and frontend npm dependencies. |
| `test-browser-unit` | Contract synchronization, core boundaries, Unicode-table admission, typecheck, and browser unit tests. | Browser module npm dependencies. |
| `build-browser` | Compile the core, build Vite assets, stage notice-complete static output, and verify payload/HTML/MIME boundaries. | Prepared browser dependencies. |
| `test-browser` | Explicit 44-check application journey and Python/Node/Worker comparisons. | Python, browser dependencies, and an installed compatible Chromium browser. |
| `test-lab-browser` | Explicit local Lab browser journey, imports, report, cancellation, and cleanup. | Lab dependencies and a compatible Chromium browser. |

Direct commands remain available:

```text
python -B scripts/rag_contract_validate.py --json
python -B scripts/rag_indexing_contract.py --json
cd source/backend
python -B -m unittest discover -s tests -v
cd ../..
npm --prefix source/frontend run typecheck
npm --prefix source/frontend run build
npm --prefix modules/browser-rag-ts run test
python -B scripts/browser_rag_smoke.py
python -B scripts/browser_smoke.py
```

The backend tests run from `source/backend`; the menu supplies that directory, so no editable install is needed.

The browser proof discovers prepared Playwright Chromium or supported local Chrome/Edge. `BROWSER_RAG_CHROMIUM_PATH` (explorer) or `RAG_METHOD_CHROMIUM_PATH` (Lab) can select an explicit executable. It never downloads a browser. Viewport emulation is useful responsive proof; it is not physical-device or all-GPU qualification.

## Build and distribute the browser application

`build-browser` emits `modules/browser-rag-ts/.artifacts/release/browser-rag-ts/`. Its landing page is `index.html`; its explorer is `browser/index.html`. Mount that directory at `/rag-method/` on a static HTTP server with correct JavaScript/CSS MIME types and 404s for missing files. No Python, Node runtime, source checkout, credentials, or mutable data is required by the emitted runtime.

The artifact's own manifest binds every payload file, redistributed notice, graph archive identity, and the complete current source fingerprint. Ordinary builds work without a release receipt: missing review, edited source, and new source files produce `working-source` with `review_status: unreviewed`. A complete, passing `PUBLIC_MANIFEST.json` qualifies a `source-snapshot` only when its exact file table still matches. Building never rewrites that review receipt. Explicit full browser acceptance and release review remain separate from the lightweight build.

The build resolver hashes every ordinary source file, excluding the manifest itself, exact declared generated directories, and local Git/credential/runtime state. Without a manifest it uses the project's fixed dependency/build/cache directories. Invalid manifest metadata fails explicitly. This is a build identity helper, not a credential or disclosure scan; the independent public allowlist review remains required for publication.

## Corpus and contracts

`corpora/threejs-docs/` contains normalized public documentation, the exact upstream identity, per-document hashes, independent relevance evaluation, and the complete MIT license. To regenerate, provide an existing local checkout of the pinned Three.js revision:

```text
node scripts/prepare_threejs_docs.mjs --upstream <local-three-checkout>
node scripts/prepare_threejs_docs.mjs --upstream <local-three-checkout> --check
```

This command does not clone or download content. Regeneration changes corpus identity and requires new review. Do not edit generated vault files to change test expectations.

Browser contract snapshots and Python-compatible Unicode tables are checked in so a public checkout can build. `contracts:sync` regenerates contract snapshots from the frozen source files. Behavioral expectations, schemas, and profiles stay versioned and independent of the live demo corpus.

The public checks cover the current method, application behavior, API boundaries, reports, and browser cleanup. Release identity and redistribution requirements are described in [RELEASE.md](RELEASE.md).
