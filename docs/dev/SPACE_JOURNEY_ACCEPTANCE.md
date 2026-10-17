# Local Space conversation acceptance

This is the repeatable local acceptance route for the optional browser model-chat
example. It does not publish a site or qualify physical iOS support. The current
candidate is `workspace/space-chat-acceptance`, based on
`992b230e92b400c01cd8ce372b8b639081a81e00`. The single ignored result is
`.artifacts/proof/space-journey/receipt.json`; its status, source hashes and
separate quality failures control the claim. Earlier published receipts retain
their historical identities.

## Prepared inputs and command

Use an existing installed Chrome and Playwright module, verified wllama 3.5.1
runtime, prepared core/graph, and the exact retained
`LiquidAI/LFM2.5-230M-GGUF` Q4_K_M model at revision
`fa224d4cb60cffe61eb58726712ef255bb64d0b7`:

- Model: `LFM2.5-230M-Q4_K_M.gguf`, 153,406,304 bytes.
- SHA-256: `7bbd90384d3deffe4c646ec9643b212802d32d4ce417c90a1ec9282100650062`.
- Separate LFM Open License 1.0 applies; the GGUF's `other` license metadata
  alone is not redistribution permission.

From the repository root, supply absolute prepared paths:

```powershell
$env:BROWSER_MODEL_GGUF_FILE = 'path/to/LFM2.5-230M-Q4_K_M.gguf'
$env:BROWSER_MODEL_RUNTIME_ROOT = 'path/to/verified/runtime'
$env:BROWSER_MODEL_MEMORY_ROOT = (Resolve-Path '.artifacts/memory').Path
$env:BROWSER_MODEL_PLAYWRIGHT_MODULE = 'path/to/playwright/index.mjs'
$env:MODEL_CHAT_BROWSER = 'path/to/chrome.exe'
node tests/model-chat-space-journey.mjs --scenario full
```

The harness never downloads weights, replaces model operations, or uses the
operator's browser profile. It starts an owned loopback server and disposable
Chrome profile, blocks external requests, and cleans those resources. Available
bounded scenarios are `smoke`, `automatic`, `manual`, `reset`, and `full`; `--smoke` is a
short alias. The full run has a 30-minute hard limit and finite authored turns.
Check the receipt even when the command exits nonzero: a model-quality failure
does not erase independently passed functional checks.
The short `reset` scenario specifically checks an already-open Settings menu
and cancel/close focus before confirmed clearing; its pass is not a full-journey
acceptance result.

## What the journey verifies

The actual production File input loads the exact model. Seed 42, temperature 0,
one CPU thread, context 2,048 and reply reserve 160 leave **1,888 usable prompt
tokens**. Counts come from the production native chat-template measurement, not
character estimates or fixture tokens. The model's larger training-context
metadata does not change this configured budget.

The authored conversation covers Fred, a short Mars-moon follow-up, a unique
notebook code, and Tuesday replacing Monday. Automatic compaction must actually
cross the usable budget, reduce it, retain the unique code/correction and submit
a valid request. The separate manual run measures the current canonical history
and aims for 45–55% of usable prompt capacity before clicking Compact now.
Manual preview must not dispatch an answer or modify the canonical transcript.

For each summary the journey checks committed event/cutoff/cycle, exact original
user spans and hashes, retained summary identity, and absence of duplicate raw
tail admission. It captures before/during/after frames and timestamped actual
renderer positions: source meshes must converge to the real summary node, with
bounded particles/trails and a settled scene. A screenshot of particles alone
cannot satisfy this gate. Search can reveal original sources without creating a
model dispatch; the Context inspector must show the exact submitted messages.

The full route also tests Forget exclusions, generation cancellation/reload,
an actual oversized native-budget refusal, narrow layout and reset/cache
boundaries. `tests/model-chat-init.mjs`, using the same prepared runtime/model,
separately exercises cold OPFS transport, warm cache, typed native failures,
fresh-Worker recovery, Settings reset and confirmed scoped clearing. Loopback
transport of retained bytes is not another external model download.

## Scope and remaining qualification

The retained initial full run passed eight functional groups across 34 actual
replies. Automatic compaction reduced 1,973 to 683 tokens; manual compaction
reduced 932 to 555 at 49.4% of usable capacity. Both moved eight real source
meshes. Three explicit semantic assertions failed. A later run uses the same
model and product prompt, captures original-source access, and binds the fixed
graph bytes. It independently passes all eight functional groups and 34 actual
replies in 434.406 seconds, repeats both token reductions and all three quality
failures, and cleans its browser/profile/server. Its six merge frames and two
original-source captures remain byte-bound in the receipt's continuation.
`merge-contact-sheet.jpg` is a mechanical crop/scale of those actual six frames;
it is a convenient visual index, while timestamped mesh coordinates prove motion.

Retained Conversation summary nodes use saturated emerald (`#22e37f`) with an
explicit “Conversation summary” legend/label. This visual subtype keeps
Conversation scope and source lineage. The actual source meshes transition
toward the destination color during merging; the reversible presentation lease
restores source colors and positions on interruption. Search, hover, selection,
reduced motion and reload preserve the summary material rather than only its
CSS aura. Four-type pixel qualification adds a summary hue band while keeping
the existing scope bands, area/saturation/sample and separation thresholds.

The complete touch route now passes all eight groups, including real CDP
orbit/pinch/drag/cancel, detail scroll, search, selection, reduced motion,
keyboard/source actions, generic renderer preservation and list fallback.
Fixed coordinates had marked memory nodes as Pinned; the producer's default
18% amber pinned tint reduced blue/persona separation. The memory-only adapter
now sets pinned `colorMix: 0`, preserving scope anchors and sphere material.
The generic renderer retains its pinned styling. Actual image separation is
about 0.48–0.51 against the unchanged 0.20 minimum. The original 0.198 failure
remains historical evidence. Geometry/depth masks and genuine two-contact pan
keep the pixel test faithful; no color threshold was relaxed.

Labeled summary/repair/package browser fixtures test UI races and deterministic
failures. They do not prove native answer quality. The 230M model has returned
Fred boilerplate to the moons follow-up despite a correct role-ordered request;
the current acceptance receipt retains that failure. A fresh same-request
comparison with and without an earlier native meter produced the same wrong
answer. A generic follow-up hint helped one replay but did not generalize to the
full conversation. Do not add hardcoded facts or call this quality gate passed.
The bounded follow-up diagnostic reconstructs the two unique failed requests
from real production operations and verifies their hashes before inference.
Twelve native replies across fresh Workers show the same baseline failures
twice each. One generic instruction repairs the frozen moons case but regresses
the multi-field recall case, omitting both code and day; it is rejected and the
product prompt stays unchanged. Two held-out cases pass in each arm, once each.
These diagnostic-exposed cases do not form a sealed future final benchmark.
`tests/model-chat-quality-cases.mjs` and
`tests/model-chat-quality-diagnostic.mjs` retain a repeatable bounded route;
the single receipt retains exact requests, outputs and development/evaluation
family roles. Nothing is admitted for training.

The current semantic assertions check explicit facts and corrections. Retained
native replies also expose verbosity and instruction-following limits; those
are not a complete fluency or formatting score.

Graph evidence identifies the actual backend. Desktop SwiftShader results do
not establish hardware-GPU performance. Application motion/draws settle, while
pinned Three 0.185.0 can retain its internal clock while visible. Physical iOS,
native touch hardware, a new HTTPS device/cache/recovery matrix, and clean-host
dependency installation require separate proof. Offline TypeScript checks with
cached tools do not establish unavailable Vite declaration parity.

The generic producer's Corpus motion repair belongs in
`Shoozes/tsl-smooth-graph-alpha`; the RAG application owns this summary projection,
extraction and prompt orchestration. Neither candidate changes graph retrieval
ownership, automatically writes Persona memory, trains a model, or starts an
agent orchestrator. Publication remains a separate reviewed action.

The isolated producer candidate integrates remote main `caa8b503` through merge
`5826a402`. All 68 focused tests and actual desktop/narrow browser journeys
pass; runtime source, lockfile and the pinned RAG archive remain identical.
Incoming package/Pages tooling is inspected, but its release manifest is not
renewed and full fresh-install, Pages/package and search-scan GPU gates remain
outside this local integration proof.
