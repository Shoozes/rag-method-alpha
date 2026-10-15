# Browser model chat preview

An optional, separate browser entry point for one pinned local model and a bounded chat. The existing Atlas entry point remains model-free. This example is served separately and is not included in the standard Vite/Atlas build artifact.

## Run locally

Use Node.js 22.12 or later. From the repository root, prepare the pinned runtime with one of these explicit commands:

```sh
node examples/browser-model-chat/prepare-runtime.mjs --fetch
```

Or reuse the exact `@wllama/wllama` 3.5.1 npm archive:

```sh
node examples/browser-model-chat/prepare-runtime.mjs --archive "path/to/wllama-3.5.1.tgz"
```

Setup checks the archive's pinned SHA-512 and each selected file's SHA-256. It accepts an archive up to 8 MiB and extracts only `index.js`, `wllama.wasm`, and `LICENSE` into the ignored `.artifacts/model-chat/runtime/` directory. It runs no npm/package scripts or native build and downloads no model.

```sh
node examples/browser-model-chat/serve.mjs
```

Open the printed `http://127.0.0.1:5187/` URL. Stop the server with Ctrl+C. Choose another port explicitly if needed:

```sh
node examples/browser-model-chat/serve.mjs --port 5188
```

Keep the same origin, including the port, to reuse that origin's browser model cache. `--port 0` selects an ephemeral port; the exported `startServer()` API also defaults to port 0 for tests. The preview binds only IPv4 loopback. It exposes this example, the existing Aurel Gold stylesheet, and three allowlisted runtime files; it does not expose a model directory or arbitrary host files.

In the page, explicitly download the model or choose the exact GGUF file from your device. Both paths verify byte length and SHA-256 before initialization. This pinned 3.5.1 build requires a secure context, Memory64, SIMD, exception handling, nested module Workers, Web Crypto and the OPFS API for **both** inputs. A local File avoids downloading weights and creating a new model-cache entry; it does not bypass missing Memory64 or OPFS API support. A new remote cache miss additionally requires writable OPFS sync access. A valid existing cache or File does not require that write probe. Supported loopback origins qualify as secure contexts locally.

Before requesting weights, the Worker tests those features, verifies and compiles the exact pinned WASM, and starts a tiny module child Worker to check site policy. Refusal appears on the loading screen. Fully absent JSPI uses the bundled synchronous fallback, with additional memory pressure; incomplete JSPI entry points are rejected. These checks cannot guarantee enough memory for model initialization.

## Stage a static candidate

After runtime preparation, create the bounded, subpath-safe delivery directory:

```sh
node examples/browser-model-chat/stage-static.mjs
```

The default output is `.artifacts/model-chat/site/`. `--output` selects another safe descendant of the checkout, and `--runtime-root` selects already prepared, exact-hash runtime inputs. The stager copies only an explicit browser asset allowlist plus licenses, notice and setup text. Its `site-manifest.json` records file sizes/hashes and source identity. It excludes models, caches, proof, tests, servers and preparer scripts. It refuses foreign directories, changed managed output, symlink escapes and hard-linked managed output before refreshing. This creates an **unreviewed local candidate**, not a release or deployment.

Asset URLs are relative, including the stylesheet, bootstrap, runtime import and WASM. The exported directory can sit beneath a host prefix without a router rewrite. Serve actual missing files as 404, modules as JavaScript and WASM as `application/wasm`; an HTML fallback for missing assets is invalid. A future public host still needs HTTPS, its own policy/CORS checks and a license/release review. Hosting is not configured by this command.

## Pinned identities and licenses

The executable contract is [model-contract.mjs](./model-contract.mjs).

| Item | Identity |
| --- | --- |
| Model repository | `LiquidAI/LFM2.5-230M-GGUF` |
| File | `LFM2.5-230M-Q4_K_M.gguf` |
| Repository revision | `fa224d4cb60cffe61eb58726712ef255bb64d0b7` |
| File size | `153406304` bytes (153.4 MB decimal) |
| SHA-256 | `7bbd90384d3deffe4c646ec9643b212802d32d4ce417c90a1ec9282100650062` |
| Browser runtime | `@wllama/wllama` 3.5.1, single-thread CPU/WASM |

The model has the [LFM Open License v1.0 at the pinned revision](https://huggingface.co/LiquidAI/LFM2.5-230M-GGUF/blob/fa224d4cb60cffe61eb58726712ef255bb64d0b7/LICENSE); it is not covered by the runtime's MIT license. The wllama runtime is MIT licensed; setup retains its license as `/runtime/LICENSE`. Review both licenses before redistribution or deployment. Model and runtime files remain outside Git.

## Behavior and limits

- Download progress uses measured bytes. Integrity checking is a separate phase. Native initialization has no percentage estimate; the page does not invent one.
- Cancel, stop, unload, and page teardown terminate the owned model worker. Loading can be retried with a fresh worker; cancelling a reply unloads the model too.
- Chat is session-only. Reloading clears the transcript and draft; cached model bytes may persist in the browser. Clearing the conversation does not erase the model cache.
- The send gate bounds accepted history to six completed turns and checks a 6,000-character history/input budget. Individual input is limited to 4,000 characters, generated replies to 160 tokens, and model context to 2,048 tokens. An interrupted attempt remains visible but is excluded from subsequent accepted history.
- Messages render as plain text. There is no RAG context, attachment injection, saved conversation, tool execution, agent team, or autonomous orchestration in this example. Existing retrieval and graph behavior retain their own owners and entry points.
- The loading screen has a static usable state, optional visual effects, and reduced-motion styling. Visual effects pause when the tab is hidden; model work is not paused by visibility. Effects do not drive readiness or progress.

The full-file integrity buffer and model initialization add memory pressure beyond the 153.4 MB file. A passing desktop run does not establish another browser's memory, cache, recovery, or device support.

## Provenance and platform proof

The implementation uses the repository's existing Aurel Gold CSS and the pinned [MIT wllama 3.5.1 release](https://github.com/ngxson/wllama/tree/766d28e03eeac044fe055327d06b83d3f9b84544). Its URL resolver expects `document.baseURI`; the owned Worker supplies only that base-URL property, keeping vendor bytes unchanged. Single-thread CPU execution needs no WebGPU presentation or cross-origin isolation headers in the tested Chrome configuration.

The [Bonsai Space](https://huggingface.co/spaces/webml-community/ternary-bonsai-2-webgpu-kernels/tree/94320c9da2b7aeac5b5807c9e61d696a3c09edb5) informed the loading-to-chat interaction pattern only. Its application source license was unspecified, so this example was independently implemented and no Bonsai code or model was copied. [Local_Browser_LLM at 5873eb0](https://github.com/Shoozes/Local_Browser_LLM/tree/5873eb04555819c13d9ea2f406974e88fbddf215) and the read-only `LocalLLMTemplate-Basic-03_13_2026` archive supplied historical URL/File lifecycle references. Their vendor bytes match each other and embed `release-2.3.7`. No private donor application code was imported.

A separate comparison loaded the exact pinned 230M bytes with that retained Memory32 single-thread runtime and generated a reply in ordinary desktop Chrome. A second File API run passed with the OPFS directory API hidden before runtime construction. This is a labeled capability injection, not a native Files picker or iOS test. It establishes that the older donor can execute this model on the tested desktop; it does not change the product runtime or qualify the older build for distribution.

Upstream also publishes [wllama-compat 3.5.1](https://registry.npmjs.org/@wllama%2fwllama-compat/3.5.1), whose [compat configuration](https://github.com/ngxson/wllama/blob/766d28e03eeac044fe055327d06b83d3f9b84544/compat/README.md) uses Memory32/Asyncify. That package has not been downloaded or executed here. Selecting it requires an exact-byte adapter and lifecycle qualification; the canonical example remains visibly gated on 3.5.1's current requirements.

The user previously reported iOS success over HTTPS and with device Files, and HTTP loading failures around 50 MB. Those are historical observations, not a universal limit or fresh device proof. This slice does not claim iOS support. A later device qualification must record the exact device/browser, model/license, loading and peak memory, cache reuse, cancellation, and recovery results without changing browser security settings.

## Local verification

Run the focused built-in Node tests from the repository root:

```sh
node --test examples/browser-model-chat/tests/loader-controller.test.mjs examples/browser-model-chat/tests/runtime-adapter.test.mjs examples/browser-model-chat/tests/capabilities.test.mjs tests/server.test.mjs tests/model-chat-static.test.mjs
```

The server/static tests use real HTTP requests for nested-prefix GET/HEAD routes, executable module/WASM MIME types, missing routes, excluded files, traversal/dotfile rejection, link escape/refresher rejection, loopback binding and CLI port parsing. Capability tests cover missing features and tiny writable-cache cleanup. Controller/adapter tests use injected fixtures; they do not establish real-model inference or device support.

With an already prepared Playwright package and installed Chrome, run the fixture UI journey:

```sh
node tests/model-chat-browser.mjs
```

`BROWSER_MODEL_PLAYWRIGHT_MODULE` can point to an existing Playwright module when it is not prepared in this checkout. The fixture journey replaces only the runtime adapter, labels its screenshot, and makes no model/runtime/external requests. To test the staged package with an **existing** exact GGUF file, set `BROWSER_MODEL_GGUF_FILE` and `BROWSER_MODEL_STATIC_ROOT` to their absolute paths, then run:

```sh
node tests/model-chat-retained.mjs
```

This journey streams that file once over owned loopback into a browser-held File, blocks external origins, checks injected Memory64/OPFS refusal before weights, cancellation/retry, two real initializations/replies and narrow reduced-motion layout. It does not copy or download a model. The separate donor comparison requires existing exact vendor inputs in `BROWSER_MODEL_MEMORY32_JS_FILE`, `BROWSER_MODEL_MEMORY32_WASM_FILE` and `BROWSER_MODEL_MEMORY32_LICENSE_FILE`:

```sh
node tests/model-chat-memory32.mjs --existing-cache
```

The original cold-remote journey is retained for a separately authorized new download:

```sh
node tests/model-chat-live.mjs --remote
```

The journeys use an installed browser, do not install dependencies, and clean up their owned server/browser/profile. Actual model journeys launch ordinary headless Chrome and attach through CDP, without security-bypass flags. `BROWSER_RAG_CHROMIUM_PATH` selects its installed Chrome executable.

Current local acceptance on 2026-10-15 covers the focused Node/HTTP suite, 7 fixture UI checks, 9 retained-model staged-package checks and 2 explicit Memory32 comparison cases in Chrome 155.0.8059.79 on Windows, Node 26.5.0. The source-bound receipt records exact counts and hashes. The current browser checks made no external model download. Mobile proof is a 390 x 844 emulated viewport; the File API input is constructed from exact existing bytes, not a native picker selection.

Historical cold-remote/cache acceptance at commit `12478fb34c9c749fdc218f870d1d366f186af547` passed 7 real-model checks, including official remote transfer, integrity verification, generated replies and cache-only reuse with external requests blocked. That evidence is retained under its original commit identity; it is not represented as a rerun of the current source. A physical iOS device remains unqualified.

The compact source-bound receipt is `.artifacts/proof/model-chat/receipt.json`. Essential images are `desktop-loading-fixture.png` (visibly labeled mock UI) and `live-mobile-chat.png` (actual model response). Runtime and delivery assets are ignored; temporary browser profiles were removed. The earlier vendor URL-base failure and its narrow fix remain in the historical record. No hosted CI, paid inference, API credentials, publication, or browser security changes were used.

## Next bounded steps

1. Qualify a named iOS device/browser over its actual HTTPS host and native Files picker, recording memory, cold/cache loads, interrupted transfer, bad-cache recovery and inference. Preserve failures as failures.
2. Coordinate the reusable conversation-state port with the `agent-workspace` owner. This preview uses a small session transcript; it does not import the prototype's full participant/catalog snapshot or invent a second durable storage schema.
3. Add accepted RAG context only through the existing Worker contract, with visible record IDs and provenance. Keep retrieval scoring, graph presentation, model execution, and permission policy separately owned.
4. Admit this composition to a distributable starter kit only after a clean setup proof, license/notice review, and a second consumer demonstrates the same loader/runtime interface. Optional graph, memory visualization, teams, and shaders follow those functional gates.
