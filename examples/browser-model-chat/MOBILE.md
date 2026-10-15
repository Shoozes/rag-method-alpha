# Mobile acceptance

The live preview is <https://shoozes.github.io/rag-method-alpha/model-chat/>.
The exact model and runtime identities are in [model-contract.mjs](./model-contract.mjs).
This is a browser application; installing it as a native app is outside this slice.

## Short iPhone check

1. Record the iPhone model, iOS version and browser/version. Open the HTTPS URL.
   Check portrait, landscape, larger text and pinch zoom; controls should stay usable.
2. Reload the page after the compatibility update, read the license, then start
   loading once. Missing Memory64 or JSPI should select “Memory32 compatibility /
   Asyncify” before weights. If another requirement is refused, retain the exact
   error; Retry/File controls should not imply a workaround. Record device/iOS
   details. Refusal is not successful model support.
3. If supported, check measured download bytes, cancel, retry and initialization.
   Initialization has no percentage estimate. Read the last confirmed stage and
   elapsed time. At 30 seconds, guidance appears; at 180 seconds the owned Worker
   stops with `INIT_WAIT_LIMIT`, preserving complete cached bytes. This is a wait
   limit, not proof of an invalid model. Use Copy report if initialization stalls
   or fails; it excludes prompts and raw logs. Cancel is available while waiting.
   A retry checks the existing complete cache before any model transfer. Do not
   clear browser storage or redownload to diagnose an unexplained stall.
   If the exact GGUF already exists in
   Files, try selecting it separately. Record tab reloads, storage failures and
   unexpected network transfers rather than treating them as platform limits.
4. Send a short question. Open the keyboard, type a long draft and rotate. The
   composer should remain reachable; the draft should survive. Scroll upward
   during a reply, then use Latest messages to return. Try Stop and a fresh load.
5. Reload and check cache reuse, then interrupted-transfer/bad-cache recovery and
   background/foreground behavior. Conversation text is session-only. Record
   crashes, browser eviction and recovery; do not infer memory safety from file size.

## Reported device failure

The earlier Memory64-only preview refused on the user's iPhone before downloading
weights: "Memory64 WebAssembly is unavailable." The next Safari screenshot showed
Memory32 compatibility / Asyncify selected and Initialize still pending after the
user reported a few minutes. There was no visible error or internal stage. Device
and iOS version remain pending. The cause has not been established. Fresh and warm
OPFS-cache paths pass real Memory32 initialization/chat on desktop Chrome; a fresh
physical-device test with the new bounded stage report is still required.

## Evidence boundary

Run `node tests/model-chat-mobile.mjs` with the existing Playwright/Chrome setup
from [README.md](./README.md). Its labeled adapter fixture checks actual DOM
interaction at 320x568, 390x844, 390x480 and 844x390, including touch targets,
contained scrolling, streamed growth, reading position, manual Latest messages,
visible conversation limits, draft retention and teardown. A narrow chat reserves
the available visual viewport for its log and composer; short layouts compact
secondary text. Local-file selection has a 44px target. Input text remains 16px.

`node tests/model-chat-pages.mjs` separately verifies the published HTTPS assets,
hashes/MIME/404s, refusal before weights, and real initialization/chat using an
existing exact native File. Configure `BROWSER_MODEL_GGUF_FILE` as documented;
this test downloads no model and does not alter browser security settings.

`node tests/model-chat-init.mjs` uses the same retained-model environment to test
the production cold OPFS and cache-only Memory32 paths in a disposable profile.
Only the canonical model URL's transport is redirected to an owned loopback
stream of existing exact bytes. It also injects a labeled child startup fault to
verify a structured error and cache-preserving recovery. No external model bytes
are downloaded, no existing browser cache is inspected, and vendor files remain
unchanged. This desktop probe does not identify the physical Safari failure.

Desktop Chrome checks use real browser interaction, resized viewports, long text,
scroll/focus checks and reduced motion. A resized desktop viewport can approximate
available keyboard space but does not open an iOS keyboard, emulate Safari's URL
bar, create a notch, measure native peak memory or prove a physical Files picker.
CSS safe-area handling still needs a notched-device check. No browser security
setting should be changed to make a test pass.

The compact local evidence is `.artifacts/proof/model-chat/receipt.json`.
Deployment and physical-device acceptance are separate from whole-product release
qualification. Keep unsupported-browser refusal visible before requesting weights.
