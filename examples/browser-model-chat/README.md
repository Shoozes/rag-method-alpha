# Browser model chat preview

An optional, separate browser entry point for one pinned local model and a bounded chat. The existing Atlas entry point remains model-free. This example is served separately and is not included in the standard Vite/Atlas build artifact.

Live static preview: **https://shoozes.github.io/rag-method-alpha/model-chat/**.
The approved experimental [memory preview](https://shoozes.github.io/rag-method-alpha/model-chat/?memory=1)
adds automatic conversation indexing, scoped keyword retrieval, an orbitable 3D
TSL graph, expanded view and bounded Context inspection. Source is curated on
`workspace/model-loading-onboarding`; private development history, the private
launch wrapper and machine paths are excluded. The source-bound delivery receipt
identifies the revision actually verified on Pages. Context selection is lossy,
and the 230M model can omit or invent details. See [memory setup and limits](./memory/README.md).
The runtime automatically selects a pinned Memory32 compatibility build when
Memory64 or JSPI is unavailable. OPFS remains required. The user reported a
successful iPhone conversation after the resource-binding fix; exact device/iOS
and broader acceptance remain unrecorded. Use the [mobile checklist](./MOBILE.md).

## Current memory experiment

Open `?memory=1` to index accepted user and assistant messages as Conversation
nodes. Generated assistant text is available for inspection and search, but
cannot become quoted user evidence. No memory parameter or `?memory=0` keeps
basic chat; the session-only history and no-RAG descriptions below apply to
that basic mode. `&graph=0` retains the memory controls as HTML.

One filter selects All memories, Global, Persona or Conversation. All combines
shared public starter knowledge with only the current persona's explicit user
excerpts and the current actor/persona/chat transcript. The filter changes
retrieval, while workspace identities enforce access. There is no persona picker
or thread manager. Three labeled NASA Space facts are Global starter knowledge,
not user facts. Search and actual request dispatch highlight matching or used
nodes; a prepared or cancelled request does not claim model use.

The view shows at most twelve nodes. Requests admit up to three retrieved
user/public-source excerpts of 360 codepoints each, subject to the native prompt
meter; indexing refuses beyond 512 turns or 512 KiB. Persona excerpts retain
their original user-source proof. Forget preserves the transcript while
excluding the selected source from recall; independent repeats can still be
retrieved. Browser persistence can fail, and stale shared state requires reload.
The [memory guide](./memory/README.md) records the full bounds, correction and
tombstone rules, setup and evidence limits. Current routing checks use labeled
provider/meter fixtures. The separate [native Space journey](../../docs/dev/SPACE_JOURNEY_ACCEPTANCE.md)
uses the pinned model and real prompt meter, and reports model-quality failures
separately from application checks. Physical iOS support remains unqualified.
No model training or autonomous orchestration is included.

## Run locally

Use Node.js 22.12 or later. From the repository root, prepare the pinned runtime with one of these explicit commands:

```sh
node examples/browser-model-chat/prepare-runtime.mjs --fetch
```

Or reuse the exact main and compatibility npm archives:

```sh
node examples/browser-model-chat/prepare-runtime.mjs --archive "path/to/wllama-3.5.1.tgz" --compat-archive "path/to/wllama-compat-3.5.1.tgz"
```

Setup verifies pinned SHA-512 archives and selected SHA-256 files. The five runtime files are the main API, Memory64 WASM, MIT license, and Memory32 compatibility worker/WASM. Already verified profiles are retained; only missing profiles are fetched. Main and compatibility archives are bounded at 8 MiB and 16 MiB respectively and extraction is allowlisted. Setup runs no package scripts, installs or native builds, and downloads no model.

```sh
node examples/browser-model-chat/serve.mjs
```

Open the printed `http://127.0.0.1:5187/` URL. Stop the server with Ctrl+C. Choose another port explicitly if needed:

```sh
node examples/browser-model-chat/serve.mjs --port 5188
```

Keep the same origin, including the port, to reuse that origin's browser model cache. `--port 0` selects an ephemeral port; the exported `startServer()` API also defaults to port 0 for tests. The preview binds only IPv4 loopback. It exposes this example, the existing Aurel Gold stylesheet, and five allowlisted runtime files; it does not expose a model directory or arbitrary host files.

In the page, explicitly download the model or choose the exact GGUF File. Both paths verify byte length and SHA-256 before initialization. The API remains wllama 3.5.1 with the same model. Browsers lacking Memory64 or JSPI automatically use the pinned, self-hosted wllama-compat 3.5.1 Memory32/Asyncify build; other browsers use Memory64. The chosen profile is available under Model details before loading and Chat options in chat. Both paths require a secure context, SIMD, exception handling, nested module Workers, Web Crypto and the OPFS API. A local File avoids downloading weights and creating a new model-cache entry, but cannot bypass a missing required browser feature. Only a new remote cache miss requires writable OPFS sync access. Valid cached bytes and Files skip that write probe.

Before requesting weights, the Worker tests browser capabilities, verifies and compiles the exact selected WASM, verifies compatibility worker glue when selected, and starts a tiny module child Worker to check policy. Full JSPI absence selects Asyncify; a partially broken JSPI interface is rejected. Permanent capability failures focus an explanation and remove futile Retry/File controls. Transient download/cache failures retain recovery. Memory32 compatibility may be slower, and neither profile guarantees enough device memory.

The selected binary's imported and defined memory declarations are checked too:
compat must be Memory32, and the primary build requires Memory64. The app binds
the selected WASM URL, verified worker code and compatibility flag to the owned
runtime instance. `setCompat()` alone only provides a candidate; wllama 3.5.1
can otherwise reselect with a weaker constructor probe and load the primary
Memory64 binary despite the app's compatibility label.

## Stage a static candidate

After runtime preparation, create the bounded, subpath-safe delivery directory:

```sh
node examples/browser-model-chat/stage-static.mjs
```

The default output is `.artifacts/model-chat/site/`. `--output` selects another safe descendant of the checkout, and `--runtime-root` selects already prepared, exact-hash runtime inputs. The stager copies only an explicit browser asset allowlist plus licenses, notice and setup text. Its `site-manifest.json` records file sizes/hashes and source identity. It excludes models, caches, proof, tests, servers and preparer scripts. It refuses foreign directories, changed managed output, symlink escapes and hard-linked managed output before refreshing. This creates an **unreviewed local candidate**, not a release or deployment.

### Prepare the optional TSL graph offline

The graph reuses the existing `createTslRagGraphRenderer` and `layoutRagGraph`
implementations from `modules/browser-rag-ts/src/application/`. The admitted
`@ours/forcegraph-tsl` 0.3.0-alpha.1 archive is already under that module's
`vendor/`; its exact SHA-256 and source snapshot are in `vendor/graph-package.json`.
Three.js 0.185.0 is fixed by the existing lockfile. No CDN or dependency fetch
occurs in the graph builder.

Supply one prepared dependency root, normally `.artifacts/memory/dependencies/`:

- `@ours/forcegraph-tsl/`: the exact vendored package, including its MIT license.
- `three/`: the locked package's `package.json`, `LICENSE`, `build/three.core.js`,
  `build/three.webgpu.js` and `build/three.tsl.js` at their original relative paths.

These inputs can be extracted from already-retained, integrity-verified archives.
An explicit `BROWSER_MEMORY_GRAPH_DEPENDENCY_ROOT` may also name a shared prepared
directory outside this checkout; the same package/file integrity checks apply.
Do not substitute another Three version or copy an unrelated dependency tree.
With an already prepared esbuild module, run from the repository root:

```powershell
$env:BROWSER_MEMORY_ESBUILD_MODULE = (Resolve-Path 'path/to/prepared/esbuild/lib/main.js').Path
$env:BROWSER_MEMORY_GRAPH_DEPENDENCY_ROOT = (Resolve-Path '.artifacts/memory/dependencies').Path
node examples/browser-model-chat/memory/build-core.mjs
node examples/browser-model-chat/memory/build-graph.mjs
node examples/browser-model-chat/stage-static.mjs --memory-preview --output .artifacts/model-chat/site
```

The builder verifies prepared package bytes and emits one self-contained
`.artifacts/memory/graph-renderer.mjs`, plus complete graph/Three MIT texts.
The explicit memory export contains **47 payload files plus its manifest**.
Automatic memory adds `memory/automatic-memory.mjs`, `memory/conversation-index.mjs`,
`memory/scoped-pockets.mjs` and `memory/starter-facts.mjs`. The existing graph
bundle and `LICENSES/forcegraph-tsl.txt` / `LICENSES/three.txt` remain included. Preserve those full notices
alongside the first-party/runtime MIT texts and separate LFM model license.
`memory/navigation.mjs` adapts contained pan/pinch input to that same renderer;
it does not introduce another graph runtime.
`memory/compaction-cue.mjs` displays committed source-linked compaction activity;
`memory/retained-compaction.mjs` projects its retained summary, and
`memory/summary-effects.mjs` temporarily moves represented source meshes toward
that summary with bounded trails. Canonical originals remain searchable.
These presentation modules do not change memory ownership.
`memory/context-panel.mjs` distinguishes actual returned candidates, admitted
sources, prepared requests and the last submitted request. Exact bounded text
is session-only; hidden reasoning, native template expansion and KV state are
unavailable. See the memory guide for the inspection bounds.
Prepared dependencies and build scripts are source/setup inputs, not browser files.
These commands reuse prepared inputs; they do not constitute a fresh-host install proof.

The renderer tries WebGPU and can use Three's WebGL2 backend. When graphics
initialization fails or graphics are disabled, accessible saved-memory controls
and search remain available as HTML. Graph layout is local and bounded; no graph
Worker is required. Device loss is handled as a failure, not a promise of seamless
backend migration. Desktop browser evidence does not qualify physical iOS graphics.

The restrained graph/search interaction references the existing
[TSL search-scan example](https://shoozes.github.io/tsl-smooth-graph-alpha/showcase/examples/search-scan/index.html).
It reuses the renderer's selection/highlight path. The full showcase remains
separate; no private donor code, data or shaders are included in this chat preview.

Asset URLs are relative, including the stylesheet, bootstrap, runtime import and WASM. The exported directory can sit beneath a host prefix without a router rewrite. Serve actual missing files as 404, modules as JavaScript and WASM as `application/wasm`; an HTML fallback for missing assets is invalid. A future public host still needs HTTPS, its own policy/CORS checks and a license/release review. Hosting is not configured by this command.

The public preview uses GitHub's native **Deploy from a branch** flow, with
`gh-pages` at `/` and a root `.nojekyll`. Only the staged files are published
under `model-chat/`; `main` and the Atlas owner branches are preserved. Updates
must verify the manifest, replace only that subpath with its exact file table,
preserve other publishing-tree content, and use an ordinary fast-forward push.
The source lives on `workspace/model-loading-onboarding`. Deployment does not
upgrade `publicReleaseQualified:false` into broader product release acceptance.

## Pinned identities and licenses

The executable contract is [model-contract.mjs](./model-contract.mjs).

| Item | Identity |
| --- | --- |
| Model repository | `LiquidAI/LFM2.5-230M-GGUF` |
| File | `LFM2.5-230M-Q4_K_M.gguf` |
| Repository revision | `fa224d4cb60cffe61eb58726712ef255bb64d0b7` |
| File size | `153406304` bytes (153.4 MB decimal) |
| SHA-256 | `7bbd90384d3deffe4c646ec9643b212802d32d4ce417c90a1ec9282100650062` |
| Browser API / primary runtime | `@wllama/wllama` 3.5.1, single-thread CPU/WASM |
| Compatibility build | `@wllama/wllama-compat` 3.5.1, Memory32 / Asyncify |

The model has the [LFM Open License v1.0 at the pinned revision](https://huggingface.co/LiquidAI/LFM2.5-230M-GGUF/blob/fa224d4cb60cffe61eb58726712ef255bb64d0b7/LICENSE); it is not covered by the runtime's MIT license. Both wllama packages are MIT licensed; `/runtime/LICENSE` contains the full shared upstream text. The compatibility package declares MIT but omits a license file, so its upstream text was verified at commit `912c18b75d4358c1405a64646b8dbe43a205943b`. Review both licenses before redistribution or deployment. Model weights remain outside Git and Pages. Prepared runtimes are ignored on the source branch; only verified allowlisted runtime bytes enter the Pages branch.

## Desktop entry

The collapsed landing uses the left column for the introduction and draft,
with model controls alongside it. Decorative height follows the available
viewport. Common desktop heights fit without an empty page scroll; expanded
information, errors, smaller windows and zoomed layouts retain natural scrolling.
The primary Load model button has a static under-glow only while idle and
ambient light is enabled. The cue stops when loading starts and does not flash
or pulse; forced-colors mode removes it. Keyboard focus remains explicit.

## Mobile conversation surface

Chat uses one compact header, a contained transcript and an inline composer.
Chat options holds model details, Clear conversation and Unload model; Escape
closes it and returns focus. The loader keeps its primary controls visible,
while Model details and Loading report disclose secondary information. UI
symbols are local SVG, not emoji or an icon font.

The chat document is bounded as well as its transcript, including entry from a
scrolled loading screen. Focus does not pan the document. Keyboard fitting
coalesces viewport changes and applies vertical offsets only during a focused
keyboard-sized edit; ordinary viewport pan is not followed. Native pinch zoom
remains available. The composer grows within a bound, safe-area padding remains,
and unloading restores the setup reading position and unsent draft. Responsive
checks include actual Chrome page zoom plus separately labeled synthetic Safari
viewport offsets; they do not establish physical Safari keyboard behavior.

## Behavior and limits

- Download progress uses measured bytes. Integrity checking is a separate phase. Initialization shows elapsed time and the last confirmed runtime stage, without a percentage estimate. Time since a stage update measures silence, not Worker health. After 30 seconds the page explains recovery; after 180 seconds the main thread stops its owned Worker with `INIT_WAIT_LIMIT`. This waiting limit is not a model validation result.
- Runtime stage messages come from an allowlist of actual pinned-runtime callbacks. Child Worker errors and outer Worker/message errors retain a bounded error code and stage. The on-page Copy report includes model/runtime identity, timing, sanitized error detail and browser identification; it excludes conversation text, raw logs and model contents. Cancel, a waiting limit and runtime failure preserve complete cached model bytes for a fresh cache-first attempt.
- Unknown error values are normalized from recognized fields before string operations. Arrays and unreadable objects get a type summary; stacks and unrelated fields are excluded. A native `signal.abort` becomes `ENGINE_NATIVE_ABORT` and rejects the owned queues immediately, preserving complete cached bytes. It is distinct from an initialization waiting limit.
- Cancel, stop, unload, and page teardown terminate the owned model worker. Loading can be retried with a fresh worker; cancelling a reply unloads the model too.
- Chat is session-only. Reloading clears the transcript and draft; cached model bytes may persist in the browser. Clearing the conversation does not erase the model cache.
- The send gate bounds accepted history to six completed turns and checks a 6,000-character history/input budget. Individual input is limited to 4,000 characters, generated replies to 160 tokens, and model context to 2,048 tokens. An interrupted attempt remains visible but is excluded from subsequent accepted history.
- Messages render as plain text. There is no RAG context, attachment injection, saved conversation, tool execution, agent team, or autonomous orchestration in this example. Existing retrieval and graph behavior retain their own owners and entry points.
- The loading screen has a static usable state, optional visual effects, and reduced-motion styling. Visual effects pause when the tab is hidden; model work is not paused by visibility. Effects do not drive readiness or progress.

The full-file integrity buffer and model initialization add memory pressure beyond the 153.4 MB file. A passing desktop run does not establish another browser's memory, cache, recovery, or device support.

## Provenance and platform proof

The implementation uses the repository's existing Aurel Gold CSS and the pinned [MIT wllama 3.5.1 release](https://github.com/ngxson/wllama/tree/766d28e03eeac044fe055327d06b83d3f9b84544). Its URL resolver expects `document.baseURI`; the owned Worker supplies only that base-URL property, keeping vendor bytes unchanged. Single-thread CPU execution needs no WebGPU presentation or cross-origin isolation headers in the tested Chrome configuration.

The [Bonsai Space](https://huggingface.co/spaces/webml-community/ternary-bonsai-2-webgpu-kernels/tree/94320c9da2b7aeac5b5807c9e61d696a3c09edb5) informed the loading-to-chat interaction pattern only. Its application source license was unspecified, so this example was independently implemented and no Bonsai code or model was copied. [Local_Browser_LLM at 5873eb0](https://github.com/Shoozes/Local_Browser_LLM/tree/5873eb04555819c13d9ea2f406974e88fbddf215) and the read-only `LocalLLMTemplate-Basic-03_13_2026` archive supplied historical URL/File lifecycle references. The retained historical inputs embedded `release-2.3.7`; current archive JavaScript has since changed, so those earlier byte identities do not qualify its present contents. No private donor application code was imported.

A separate comparison loaded the exact pinned 230M bytes with that retained Memory32 single-thread runtime and generated a reply in ordinary desktop Chrome. A second File API run passed with the OPFS directory API hidden before runtime construction. This is a labeled capability injection, not a native Files picker or iOS test. It establishes that the older donor can execute this model on the tested desktop; it does not change the product runtime or qualify the older build for distribution.

The maintained [wllama-compat 3.5.1 package](https://registry.npmjs.org/@wllama%2fwllama-compat/3.5.1) and [its configuration](https://github.com/ngxson/wllama/blob/766d28e03eeac044fe055327d06b83d3f9b84544/compat/README.md) provide Memory32/Asyncify. Earlier desktop Chrome tests forced JavaScript constructor/JSPI probes to fail and generated replies with the selected compatibility build. Those tests exercise selection and transport; they do not disable V8's Memory64 parser or establish genuine feature absence. The genuine-engine test below is separate.

The first real iPhone test of the earlier Memory64-only preview refused loading before weights: "Memory64 WebAssembly is unavailable." A subsequent Safari screenshot showed the maintained Memory32/Asyncify profile selected and initialization still waiting after the user reported several minutes. It showed no runtime error or internal substage. Device/iOS version and the cause remain unknown; this is not successful iPhone support. The added diagnostics and waiting limit make the next attempt bounded and inspectable. Desktop tests exercise fresh download into OPFS, cache reopening, SHA verification and real Memory32 initialization/chat; they do not reproduce that device stall. Earlier user-reported HTTPS success and HTTP failures around 50 MB remain historical observations, not universal limits. A fresh device retest must record device/browser, exact model/license, memory, loading/cache, cancellation and recovery without changing browser security settings.

A later screenshot of a cached retry showed an immediate `message.replace is not a function` failure at the first WASM stage, with zero displayed elapsed seconds. Its browser chrome appears to be an in-app sheet; it must not be assumed to be the earlier full Safari tab. The exact masking mechanism was reproduced: the pinned compatibility loader can call `abort(reason)` with an Error object before coercion, while the parent vendor receiver calls `message.replace` and `rawStack.replace` as though both fields were strings. The first-party [runtime-errors.mjs](./runtime-errors.mjs) guards the exact pinned instance's configurable `proxy` assignment before the child receiver is bound. It bypasses that abort formatter and stack decoder, preserves only safe name/message/type, and rejects the vendor queues through their existing safe-string `abort` method. Ordinary messages keep their receiver and behavior. A changed pinned interface fails with `ENGINE_BOUNDARY_ERROR`; vendor bytes are unchanged. An injected real WASM-instantiation LinkError proves the masking bug and its repair, not the underlying iPhone cause. Device/iOS, browser container and a fresh report of the original failure remain required.

The next device report exposed `WebAssembly.Module doesn't parse at byte 4294:
Memory64 is not enabled`. The primary pinned binary imports shared Memory64 at
byte 4293 (flags 7), matching that parse location. The official compatibility
binary imports shared Memory32 at byte 3357 (flags 3). In genuine desktop
WebKit/JSC, the constructor probe and JSPI both succeed while the actual parser
rejects Memory64: an unbound vendor instance therefore selects the primary
binary. Explicit resource binding fixes that reproduced selection defect. The
same engine rejects the exact primary binary at 4294, accepts the exact compat
binary, then initializes the unchanged model and generates a reply with the
bound pair, without any WebAssembly overrides. Windows WebKit lacks OPFS, so
that File-only engine test injects public read-only storage managers; their
methods are never called. It qualifies the runtime path, not iPhone storage or
physical-device support. The production OPFS/cache path is tested separately.

## Local verification

Run the focused built-in Node tests from the repository root:

```sh
node --test examples/browser-model-chat/tests/wasm-memory.test.mjs examples/browser-model-chat/tests/runtime-profile.test.mjs examples/browser-model-chat/tests/runtime-errors.test.mjs examples/browser-model-chat/tests/loader-controller.test.mjs examples/browser-model-chat/tests/runtime-adapter.test.mjs examples/browser-model-chat/tests/capabilities.test.mjs tests/server.test.mjs tests/model-chat-static.test.mjs tests/model-chat-prepare.test.mjs
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

This journey streams that file once over owned loopback into a browser-held File, blocks external origins, checks injected SIMD/OPFS refusal before weights and Memory32 selection through JavaScript probe fixtures, cancellation/retry, two real initializations/replies and narrow reduced-motion layout. The V8 engine remains Memory64-capable. It does not copy or download a model. The separate donor comparison requires existing exact vendor inputs in `BROWSER_MODEL_MEMORY32_JS_FILE`, `BROWSER_MODEL_MEMORY32_WASM_FILE` and `BROWSER_MODEL_MEMORY32_LICENSE_FILE`:

```sh
node tests/model-chat-memory32.mjs --existing-cache
```

The maintained compatibility probe uses the already prepared pinned assets and the same `BROWSER_MODEL_GGUF_FILE`:

```sh
node tests/model-chat-compat.mjs --existing-cache
```

The focused initialization probe uses that same retained GGUF and Playwright
setup, redirects only model transport to owned loopback, and tests fresh OPFS
loading, cache-only loading, a labeled child startup fault, typed abort values,
the real compatibility WASM-instantiation failure producer, and fresh-Worker
recovery without requesting external weights. Its historical baseline proves
the masking TypeError separately from the safe structured failure:

```sh
node tests/model-chat-init.mjs
```

With an already installed Playwright WebKit executable, set
`BROWSER_MODEL_WEBKIT_PATH` along with the same retained model and Playwright
module. The genuine-engine journey requires a real Memory64 rejection control,
checks both complete pinned binaries, reproduces the unbound selector mismatch,
and runs the bound Memory32 model. It installs nothing and makes no WebAssembly
API overrides:

```sh
node tests/model-chat-memory32-engine.mjs
```

The original cold-remote journey is retained for a separately authorized new download:

```sh
node tests/model-chat-live.mjs --remote
```

The journeys use an installed browser, do not install dependencies, and clean up their owned server/browser/profile. Actual model journeys launch ordinary headless Chrome and attach through CDP, without security-bypass flags. `BROWSER_RAG_CHROMIUM_PATH` selects its installed Chrome executable.

The source-bound receipt records exact acceptance counts and identities. The focused suite covers capability selection, permanent refusal versus transient recovery, transport/lifecycle cancellation, bounded preparation, and static hashes/MIME/404s. UI fixtures cover mobile layout and unsupported states. The Chrome retained-file and Pages journeys execute both profiles using JavaScript selection fixtures, while genuine WebKit separately rejects Memory64 and executes the bound Memory32 pair. The published WASM memory declarations and hashes are checked. None of these desktop journeys qualifies physical iPhone support.

Historical cold-remote/cache acceptance at commit `12478fb34c9c749fdc218f870d1d366f186af547` passed 7 real-model checks, including official remote transfer, integrity verification, generated replies and cache-only reuse with external requests blocked. That evidence is retained under its original commit identity; it is not represented as a rerun of the current source. A physical iOS device remains unqualified.

The retained runtime/lifecycle receipt is `.artifacts/proof/model-chat/receipt.json`, under its original source identities. It includes the desktop landing and `live-mobile-chat.png` (historical actual HTTPS model response). The later mobile-navigation publication appends bounded live results to its existing local mobile receipt; `tests/model-chat-memory-mobile.mjs --live` requires explicit reviewed source/manifest/graph pins and that proof owner. Its provider/token-meter fixture is visibly labeled and makes no model calls. Runtime and delivery assets are ignored; temporary browser profiles are removed. The earlier vendor URL-base failure and its narrow fix remain in the historical record. Browser verification runs locally against the published HTTPS site. GitHub runs its native Pages deployment only; no hosted verification suite, paid inference, API credentials or browser security bypass is used.

## Next bounded steps

1. Qualify a named iOS device/browser over its actual HTTPS host and native Files picker, recording memory, cold/cache loads, interrupted transfer, bad-cache recovery and inference. Preserve failures as failures.
2. Coordinate the reusable conversation-state port with the `agent-workspace` owner. This preview uses a small session transcript; it does not import the prototype's full participant/catalog snapshot or invent a second durable storage schema.
3. Add accepted RAG context only through the existing Worker contract, with visible record IDs and provenance. Keep retrieval scoring, graph presentation, model execution, and permission policy separately owned.
4. Admit this composition to a distributable starter kit only after a clean setup proof, license/notice review, and a second consumer demonstrates the same loader/runtime interface. Optional graph, memory visualization, teams, and shaders follow those functional gates.
