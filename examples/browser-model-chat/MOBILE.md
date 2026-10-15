# Mobile acceptance

The live preview is <https://shoozes.github.io/rag-method-alpha/model-chat/>.
The exact model and runtime identities are in [model-contract.mjs](./model-contract.mjs).
This is a browser application; installing it as a native app is outside this slice.

## Current device observation

The user reported success ("Bingo") on their iPhone after source `19eb228`
bound the selected Memory32 resources. Exact device, iOS version and browser
container remain unknown. That success is a user report, rather than an
independently instrumented physical-device run. Actual local browser
before/after captures ground this UI polish. This observation does not close
every device/cache/recovery acceptance below.

The current polish keeps that runtime, model and cache unchanged. Chat options
contains Clear conversation, Unload model and runtime details. Model details and
Loading report hold secondary loading information. No permanent hero or extra
technical copy occupies the ready chat.

## Short iPhone check

1. Record the iPhone model, iOS version and browser/version, including whether
   this is a full Safari tab or an in-app browser sheet. Open the HTTPS URL.
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
   composer should remain reachable; the draft should survive. Try horizontal
   swipes and ordinary page pan at default scale: the chat should stay anchored.
   Keep native pinch zoom available. Scroll upward during a reply, then use
   Latest messages to return. Open Chat options by touch and keyboard, close with
   Escape where available, and check focus return. Try Stop and a fresh load.
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

A later cached retry showed zero elapsed seconds at "Verified model bytes;
opening the WASM module", then `message.replace is not a function`. Its browser
chrome appears to be an in-app sheet, unlike the earlier Safari screenshot.
Keep these observations separate. The pinned vendor abort receiver assumed a
string where compatibility WASM initialization can supply an Error object.
That masking bug is reproduced and guarded without changing vendor bytes;
`ENGINE_NATIVE_ABORT` now preserves bounded original error detail. The original
device WASM failure is not established by that repair. Reload the same origin
without clearing storage and retain a new Copy report, device/iOS and container.

The next report exposed `Memory64 is not enabled` at WASM byte 4294. That location
matches the primary Memory64 binary; the official compatibility binary is
Memory32. Genuine WebKit reproduced a vendor constructor-probe false positive
and primary reselection despite the app label. The app now binds the verified
compatibility WASM and glue together, and a genuine Memory64-rejecting WebKit
engine initializes the exact model with that pair. That desktop File-only test
uses a storage-manager fixture because Windows WebKit lacks OPFS; production
cache and physical iPhone acceptance remain separate. Retest the same URL and
cache after reloading, without clearing storage or changing models.

## Evidence boundary

Run `node tests/model-chat-mobile.mjs` with the existing Playwright/Chrome setup
from [README.md](./README.md). Its labeled adapter fixture checks actual DOM
interaction at 320x568, 390x844, 390x480 and 844x390, including touch targets,
contained scrolling, streamed growth, reading position, manual Latest messages,
visible conversation limits, draft retention and teardown. It also checks entry
from a scrolled loading screen without a corrective test scroll, document pan
refusal at default scale, actual Chrome 2x page zoom and separately labeled
synthetic keyboard/viewport offsets. Chat reserves the available visual viewport
for its log and composer; secondary actions use native disclosure. Loading
position is restored after unloading. Touch targets remain at least 44px and
input text remains 16px. The viewport fixture does not emulate Safari chrome,
physical keyboard/IME behavior or OS rubber-banding.

`node tests/model-chat-pages.mjs` separately verifies the published HTTPS assets,
hashes/MIME/404s, refusal before weights, and real initialization/chat using an
existing exact native File. Configure `BROWSER_MODEL_GGUF_FILE` as documented;
this test downloads no model and does not alter browser security settings.

`node tests/model-chat-init.mjs` uses the same retained-model environment to test
the production cold OPFS and cache-only Memory32 paths in a disposable profile.
Only the canonical model URL's transport is redirected to an owned loopback
stream of existing exact bytes. It also injects typed abort payloads and a real
compatibility WASM-instantiation failure to reproduce the old masking exception
and verify safe errors, plus a labeled child startup fault and cache-preserving
recovery. No external model bytes
are downloaded, no existing browser cache is inspected, and vendor files remain
unchanged. This desktop probe does not identify the physical Safari failure.

Chrome JavaScript feature-probe fixtures do not disable the VM's Memory64 parser.
The separate `model-chat-memory32-engine.mjs` test proves genuine WebKit parser
refusal with a known Memory64 control and the complete primary binary, then
executes the bound official Memory32 build without WebAssembly API overrides.

Desktop Chrome checks use real browser interaction, resized viewports, long text,
scroll/focus checks and reduced motion. A resized desktop viewport can approximate
available keyboard space but does not open an iOS keyboard, emulate Safari's URL
bar, create a notch, measure native peak memory or prove a physical Files picker.
CSS safe-area handling still needs a notched-device check. No browser security
setting should be changed to make a test pass.

The compact local evidence is `.artifacts/proof/model-chat/receipt.json`.
Deployment and physical-device acceptance are separate from whole-product release
qualification. Keep unsupported-browser refusal visible before requesting weights.
