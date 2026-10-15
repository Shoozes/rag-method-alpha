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

In the page, explicitly download the model or choose the exact GGUF file from your device. A local file avoids the model download. Both paths verify the model's byte length and SHA-256 before initialization. The download path requires browser persistent storage; a local file is the alternative when that cache is unavailable. This implementation requires a secure context for either path; supported loopback origins qualify locally.

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

The [Bonsai Space](https://huggingface.co/spaces/webml-community/ternary-bonsai-2-webgpu-kernels/tree/94320c9da2b7aeac5b5807c9e61d696a3c09edb5) informed the loading-to-chat interaction pattern only. Its application source license was unspecified, so this example was independently implemented and no Bonsai code or model was copied. [Local_Browser_LLM at 5873eb0](https://github.com/Shoozes/Local_Browser_LLM/tree/5873eb04555819c13d9ea2f406974e88fbddf215) and the read-only `LocalLLMTemplate-Basic-03_13_2026` archive supplied historical URL/File lifecycle references. Their vendor bytes match each other and embed `release-2.3.7`; their 350M default and historical tests do not qualify this 230M combination. No private donor application code was imported.

The user previously reported iOS success over HTTPS and with device Files, and HTTP loading failures around 50 MB. Those are historical observations, not a universal limit or fresh device proof. This slice does not claim iOS support. A later device qualification must record the exact device/browser, model/license, loading and peak memory, cache reuse, cancellation, and recovery results without changing browser security settings.

## Local verification

Run the focused built-in Node tests from the repository root:

```sh
node --test examples/browser-model-chat/tests/loader-controller.test.mjs examples/browser-model-chat/tests/runtime-adapter.test.mjs tests/server.test.mjs
```

The server tests use real HTTP requests for executable module/WASM MIME types, missing routes, unknown extensions, traversal/dotfile rejection, symlink escape rejection, loopback binding, and CLI port parsing. Controller/adapter tests use injected fixtures; they do not establish real-model inference or device support.

With an already prepared Playwright package and installed Chrome, run the fixture UI journey:

```sh
node tests/model-chat-browser.mjs
```

`BROWSER_MODEL_PLAYWRIGHT_MODULE` can point to an existing Playwright module when it is not prepared in this checkout. The fixture journey replaces only the runtime adapter, labels its screenshot, and makes no model/runtime/external requests. The live journey explicitly permits one model download into a disposable browser profile:

```sh
node tests/model-chat-live.mjs --remote
```

Both browser journeys use an installed browser, do not install dependencies, and clean up their owned server/browser/profile. The live journey launches ordinary headless Chrome and attaches through CDP, without security-bypass flags. `BROWSER_RAG_CHROMIUM_PATH` selects its installed Chrome executable.

Local acceptance on 2026-10-15: **32 Node/HTTP checks, 7 fixture browser checks, and 7 real-model browser checks passed** in Chrome 155.0.8059.79 on Windows, Node 26.5.0. Real acceptance covered official remote fetch, exact-byte SHA-256 validation, initialization, generated replies, initialization cancellation/retry through the File API, and cache-only initialization/inference while external requests were blocked. The File API test reused verified browser-cache bytes with no new download; a physical/native file picker was not qualified. Mobile proof is a 390 × 844 emulated viewport, not an iOS device.

The compact source-bound receipt is `.artifacts/proof/model-chat/receipt.json`. Essential images are `desktop-loading-fixture.png` (visibly labeled mock UI) and `live-mobile-chat.png` (actual model response). Runtime assets are ignored; temporary browser model caches were removed. A first real run exposed the vendor URL-base assumption and failed before readiness; the final run above passed after the narrow adapter fix. No hosted CI, paid inference, API credentials, publication, or browser security changes were used.

## Next bounded steps

1. Qualify a named iOS device/browser over its actual HTTPS host and native Files picker, recording memory, cold/cache loads, interrupted transfer, bad-cache recovery and inference. Preserve failures as failures.
2. Coordinate the reusable conversation-state port with the `agent-workspace` owner. This preview uses a small session transcript; it does not import the prototype's full participant/catalog snapshot or invent a second durable storage schema.
3. Add accepted RAG context only through the existing Worker contract, with visible record IDs and provenance. Keep retrieval scoring, graph presentation, model execution, and permission policy separately owned.
4. Admit this composition to a distributable starter kit only after a clean setup proof, license/notice review, and a second consumer demonstrates the same loader/runtime interface. Optional graph, memory visualization, teams, and shaders follow those functional gates.
