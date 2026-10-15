# RAG Method

An inspectable retrieval method and two working applications for exploring source-backed knowledge. RAG Method makes indexing, ranking, provenance, and the context selected for a model visible and reproducible.

The repository owns the language-neutral `rag-indexing-v1` and `rag-behavior-v2` contracts, a Python reference implementation, and a browser-native TypeScript implementation. Graph layout and rendering come from the separately reusable `@ours/forcegraph-tsl` library; a graph view never changes retrieval scores.

![Complete Knowledge Atlas evidence graph with the query controls fully visible](docs/media/rag-method-evidence-graph.png)

A real browser capture of the documentation vault's evidence graph, with the inspector closed so the whole workspace is visible. The [source-reader view](docs/media/rag-method-source-reader.png), [vault overview](docs/media/rag-method-evidence-workbench.png), and [mobile layout](docs/media/rag-method-evidence-mobile.png) are captured separately. Renderer, source revision, viewport checks, and image hashes are recorded in the [capture receipt](docs/media/atlas-presentation.json).

## Explore Knowledge Atlas

The browser application includes a pinned 921-document Three.js and TSL documentation vault. Load the example, ask a suggested question, follow ranked evidence through the graph, read the complete source, and inspect the exact context a model would receive. You can also select your own bounded Markdown/text files or an Obsidian folder. Selected files stay in the browser Worker session: there is no upload, database, or model call.

Use Node.js 22.12 or newer with npm. Dependency setup is an explicit action:

```text
node run.mjs setup-browser
node run.mjs run-browser
```

Open the loopback URL printed by Vite, then choose **Open Atlas**. The root menu is also available through `run.cmd` on Windows or `node run.mjs` in a terminal. Use `node run.mjs --list` to inspect tasks and `--dry-run` to inspect their commands.

**Motion Studio → Replay build** replays the accepted graph with bounded node growth and camera motion. Quiet mode and reduced-motion preferences take priority. Animation presents actual ranked matches and source relationships; it does not measure retrieval speed. Open **Evidence** to inspect a complete source or copy the ordered context packet.

## How the browser pipeline works

![RAG Method infographic: selected files, local Worker indexing, scoped ranking, and ordered context; graph presentation is a separate consumer](docs/media/retrieval-flow.svg)

The diagram describes the default browser application, not model inference. The graph presents indexed relationships and accepted result IDs. It does not determine retrieval scores or hold back the context packet. [Text explanation and boundaries](docs/METHOD.md).

## Graphs and the search-scan companion

Atlas packs real path families into distinct neighborhoods, highlights accepted relationships with smooth curves, and docks evidence beside the desktop graph instead of covering Search. On narrow screens, the graph, query, and evidence stack in normal page flow. The landing preview retains its original image ratio.

The separate [TSL Search scan example](https://github.com/Shoozes/tsl-smooth-graph-alpha/tree/caa8b5033fcca94dd2d0292628c49851ec4f38b3/examples/showcase/examples/search-scan) demonstrates the spider-like scanner, planted contacts, seekable replay, and camera handoffs. It is a **synthetic presentation example**, not a screenshot of RAG Method and not part of the pinned package's public exports.

RAG still owns search, ranked order, source IDs, and context. A future scanner integration must consume already accepted IDs, preserve repeated group visits and cancellation guards, and never delay results behind animation. The current Atlas improvements do not claim that the scanner prefab is integrated.

## Explore the local Lab

RAG Method Lab pairs a bounded FastAPI backend with a React frontend. Load its built-in synthetic collection, compare retrieval modes, inspect backend-owned scores and source provenance, select evidence in the graph, and export a validated query report. Advanced tools disclose detailed controls while the initial view stays focused on the query and evidence.

The locked backend setup is tested with **Python 3.12**. NumPy `2.5.1` in `requirements.lock` requires Python 3.12 or newer; the range-based development manifest has a separate `>=3.10` runtime declaration. Start with the [setup guide](docs/user/SETUP.md).

## Read and verify

- [Method and ownership](docs/METHOD.md): frozen contracts, reference behavior, and application boundaries.
- [Setup and user journeys](docs/user/SETUP.md): browser explorer and local Lab.
- [Development commands](docs/DEVELOPMENT.md): tests, builds, conformance, and corpus maintenance.
- [Release and redistribution](docs/RELEASE.md): source fingerprints, public-surface policy, and licenses.
- [Backend integration contract](docs/dev/RAG_CONTRACT.md): routes, limits, authentication, and storage.

`node run.mjs test-browser-unit` checks the browser implementation; `node run.mjs test-method` runs the frozen Python conformance cases. The focused Atlas capture journey uses the built static application and an installed Chromium browser:

```text
node run.mjs build-browser
node scripts/atlas_presentation.mjs
```

Use `--update-media` only to replace public screenshots after that journey passes, then review the actual images. The command rejects stale builds and edited payloads; rebuild after source or media changes. The script does not install dependencies or download a browser. See [presentation verification](docs/DEVELOPMENT.md#atlas-presentation-and-public-media) for capture provenance, replay checks, and the full three-runtime browser journey.

Browser journeys are explicit tasks and use an installed local Chromium browser when available. Run/test/build tasks do not install packages, fetch documentation, or download models.

The default demonstrations are model-free. They show real retrieval and context assembly rather than generated answers. Semantic model setup, authenticated remote browser access, persistence in the browser explorer, and large-corpus performance are outside this release's demonstrated scope.

The separate [browser model chat preview](examples/browser-model-chat/README.md) offers an optional loading-to-chat composition for a pinned LFM2.5-230M Q4_K_M model. It has its own explicit runtime setup and loopback entry point; it is not part of the Atlas release artifact and does not change retrieval or graph behavior.

MIT licensed. The pinned graph archive, Three.js runtime, and redistributed Three.js documentation retain their own MIT notices. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
