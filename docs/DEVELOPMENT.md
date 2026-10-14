# Development and verification

Use `node run.mjs --list` to inspect the app-focused task declarations in `project.tasks.json`. `--dry-run` prints exact command arguments without executing them. The menu dispatches the existing Python scripts and package commands from one portable catalog. Setup is explicit; missing dependencies are reported.

| Task | Purpose | Prerequisites |
| --- | --- | --- |
| `test-method` | Frozen Python indexing and retrieval reference cases. | Python; standard library only. |
| `test-lab` | Active backend unit/failure/API/launcher tests and frontend type/build checks. | Prepared Python 3.12 environment and frontend npm dependencies. |
| `test-browser-unit` | Contract synchronization, core boundaries, Unicode-table admission, typecheck, and browser unit tests. | Browser module npm dependencies. |
| `build-browser` | Compile the core, build Vite assets, stage notice-complete static output, and verify payload/HTML/MIME boundaries. | Prepared browser dependencies. |
| `test-browser` | 44-check Atlas application journey and exact Python/Node/Worker comparisons. | Python, browser dependencies, and an installed compatible Chromium browser. |
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

## Atlas presentation and public media

Build first, then run the current Atlas journey:

```text
node run.mjs build-browser
node scripts/atlas_presentation.mjs
node scripts/atlas_presentation.mjs --update-media
```

The default run writes candidates and a fail-closed receipt under `.artifacts/proof/atlas-presentation/`. The optional last command copies public media only after all checks pass. Review the overview, docked source reader, evidence graph, and mobile image before committing them. Do not reuse a selected-source screenshot as the overview hero.

The script first validates the built payload and compares its source fingerprint with the current checkout. Stale builds and edited payloads fail before browser startup; the source is checked again before any public-media update. Rebuild after changing source or public media. The receipt binds the actual artifact identity and source fingerprint, not just a Git HEAD label.

The script owns a loopback-only static server, uses the prepared browser selected by `BROWSER_RAG_CHROMIUM_PATH` or Playwright, and closes both afterward. It verifies the real 921-document import, accepted IDs, verbatim context, pinned source reader, separate panes, responsive sizes, text zoom, reduced motion, SVG fallback, and uncropped landing preview. Public media provenance includes the implementation commit, browser/backend, viewport, and image hashes. `LOCAL_BROWSER_SOFTWARE_WEBGL=1` explicitly records software WebGL; this is not native-GPU or performance proof.

The full `browser_rag_smoke.mjs` journey uses current Atlas controls and real Worker outputs. Replay admission checks both Worker and rendered identities, accepting a chunk's actual source node in the vault view rather than inventing chunk nodes. Its original 44 named checks include renderer selection, WebGL device-loss recovery, exact/keyword/scoped/fixture-semantic queries, actual canvas picking, mobile and rotation behavior, query-report failure isolation, local import cancellation, and teardown. The `svg_mobile_view_switch` name remains for receipt compatibility; it now checks opening and closing the docked/stacked inspector while the graph stays visible. Hidden status text is read as state, while canvas visibility and actual interaction are checked separately.

`browser_rag_smoke.py` validates the raw reports, runs the Python/Node/Worker comparison, verifies process/port cleanup, and fails closed. The focused Atlas presentation journey adds source-bound captures, replay cancellation, transient-growth cleanup, projection-overlay visibility, hidden-tab signals, and unchanged accepted context. Neither journey is native-GPU performance or release qualification. Browser automation emulates viewports and hidden-tab signals; it is not a physical-device test. The retired `BROWSER_RAG_UPDATE_PUBLIC_MEDIA` route fails with instructions to use the source-validated capture command.

A failed browser journey keeps its failing status while recording independently verified server shutdown and port release. Cleanup success never converts failed functional evidence into acceptance.

The portable lifecycle tests also open real loopback sockets. An active listener remains unavailable. POSIX cleanup checks actual rebinding after TCP `TIME_WAIT`; Windows uses exclusive address ownership instead of reuse. Windows and Linux CI lanes run the launcher contracts separately from browser rendering.

## Dependency checks

Both JavaScript applications keep committed npm lockfiles. Setup uses `npm ci --ignore-scripts`; maintenance updates are explicit and separate from run/build/test tasks. Check both trees after an intentional dependency change:

```text
npm --prefix modules/browser-rag-ts audit
npm --prefix source/frontend audit
npm --prefix source/frontend run typecheck
npm --prefix source/frontend run build
```

The CI workflow uses read-only repository permissions and retains audit output with test receipts. Audit results are timestamped observations of the advisory service, not a guarantee that every vulnerability is known. Keep the Vite development server loopback-only; its explicit filesystem deny rules block Git metadata, common key/environment-file patterns, `.secrets` directories, and local npm/yarn configuration within an allowed development root. These declared patterns are not a general secret detector.

## Build and distribute the browser application

`build-browser` emits `modules/browser-rag-ts/.artifacts/release/browser-rag-ts/`. Its landing page is `index.html`; its explorer is `browser/index.html`. Mount that directory at `/rag-method/` on a static HTTP server with correct JavaScript/CSS MIME types and 404s for missing files. No Python, Node runtime, source checkout, credentials, or mutable data is required by the emitted runtime.

The artifact's own manifest binds every payload file, redistributed notice, graph archive identity, and the complete current source fingerprint. Ordinary builds work without a release receipt: missing review, edited source, and new source files produce `working-source` with `review_status: unreviewed`. A complete, passing `PUBLIC_MANIFEST.json` qualifies a `source-snapshot` only when its exact file table still matches. Building never rewrites that review receipt. Explicit full browser acceptance and release review remain separate from the lightweight build.

The build resolver hashes every ordinary source file, excluding the manifest itself, exact declared generated directories, and local Git/credential/runtime state. Without a manifest it uses the project's fixed dependency/build/cache directories. Invalid manifest metadata fails explicitly. This is a build identity helper, not a credential or disclosure scan; the independent public allowlist review remains required for publication.

## Corpus and contracts

`corpora/threejs-docs/` contains normalized public documentation, the exact upstream identity, per-document hashes, independent relevance evaluation, and the complete MIT license. To regenerate, provide an existing local checkout of the pinned Three.js revision:

```text
node scripts/prepare_threejs_docs.mjs --upstream <local-three-checkout>
node scripts/prepare_threejs_docs.mjs --upstream <local-three-checkout> --check
node --test modules/browser-rag-ts/tests/artifact/threejs-doc-links.test.mjs
```

This command does not clone or download content. Regeneration changes corpus identity and requires new review. Do not edit generated vault files to change test expectations.

Browser contract snapshots and Python-compatible Unicode tables are checked in so a public checkout can build. `contracts:sync` regenerates contract snapshots from the frozen source files. Behavioral expectations, schemas, and profiles stay versioned and independent of the live demo corpus.

The public checks cover the current method, application behavior, API boundaries, reports, and browser cleanup. Release identity and redistribution requirements are described in [RELEASE.md](RELEASE.md).
