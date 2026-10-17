# Model-chat regression guidance

This ledger owns the browser model-chat example's prompt and lifecycle lessons.
It separates observable application behavior from model answer quality and uses
`pitfall-stories.2026-10-15.v1`. Proof stays in the existing candidate receipt.

### Q: Why did ordinary chat repeat “No older user passage selected”?

**Story ID / status / search synopsis:** `RAG-CHAT-001`; resolved within the tested
application assembly/lifecycle scope; native answer quality remains unproved;
Current. Search hooks: Fred conversation, evidence-only chat, “No older user
passage selected.”, “No saved evidence matched this query.”, `passage-3 / t-0005`,
All to Conversation filter, orphan assistant turn, Compact now “Nothing changed”.

**Sources:** `Shoozes/rag-method-alpha`, published source `223adc2`, model-chat
context assembly. Runtime pins wllama 3.5.1 and LFM2.5-230M Q4_K_M. This repair's
prompt assertions use the real workspace/RAG core and a labeled token fixture.
The user's native output is attributed evidence, not an independently replayed
model run. No alternate model, template or framework was substituted.

**What:** Ordinary dialogue could become an evidence-only question with its
preceding turns removed, followed by an empty retrieval status as system text.
An empty status is prompt data, not a safe answer fallback.

**Context and constraints:** The example offers optional scoped memory and a
2,048-token native context with a 160-token reply reserve. Original transcript,
scope/Forget authority, provenance and dispatch freshness must remain intact.
Visual filter changes must not silently destroy conversational continuity.

**Why it happened:** The memory-on instruction required evidence-only answers
even during casual chat. `automaticMemory.identity()` combined content policy
with the selected scope; changing All to Conversation triggered the same cutoff
purge used for actual corrections/Forget. An empty extractor still emitted its
diagnostic sentence as a system message. Raw recent messages could also appear
again as automatic evidence, and a compacted tail could start with an assistant
whose preceding user message was omitted.

**Where:** `examples/browser-model-chat/memory/context.mjs`,
`automatic-context.mjs`, `panel.mjs`, and `app.mjs`.

**Evidence:** Real workspace assembly of the reported conversation, with All to
Conversation after the Fred exchange and no overflow, produced the empty notice
and then the reported `passage-3 / t-0005` selection. With unchanged All scope,
the same under-budget history kept its roles. App/Worker paths render returned
model text directly; they do not substitute that sentence as an answer. Current
deployed assets matched `223adc2`; an already-open tab retaining earlier module
instances remains a separate browser possibility.

**Developer story:** The user reported strange replies and ineffective manual
compaction. Inspection located the literal reply inside the extractor. Controlled
real-assembly comparisons separated model uncertainty from a deterministic
scope-refresh bug. That trace also explained why older dialogue had disappeared
from compaction's eligible range. A source-linked projection can legitimately
cost more than a tiny raw chat; this must stay a truthful no-change result.

**How to catch it:** Run `tests/model-chat-conversation-prompt.test.mjs` with
the prepared real core, `tests/model-chat-compaction-feedback.test.mjs` and the
actual-browser repair harness. Assert complete role-ordered recent dialogue,
latest user turn, no empty statuses in model messages, once-only raw sources,
full-identity stale-dispatch refusal and correction/Forget exclusions. Assert no
pocket/event/particles for a nonreducing manual check. Reset tests must exercise
confirmation, scoped storage, queued writes, late replies and a fresh reload.

**Solutions tried:** Evidence-only prompting and display notices in model context
failed this casual-chat boundary. Disabling memory, fabricating a summary,
hardcoding a Fred answer and weakening policy freshness were rejected.

**Current solution:** The candidate on `workspace/conversation-prompt-repair`
separates content-policy refresh from
scope freshness, keeps a user-first recent tail, conditions evidence instructions
on real evidence and omits empty extractor text from model messages. Manual
no-source/no-reduction results receive neutral structured feedback with actual
counts when measured. They do not claim compaction or Persona promotion.
The receipt binds its exact commit. The 416 native tests and 18 actual-browser
fixture groups pass, including the reported conversation and reset races.

**Decision rationale:** Repair reproducible assembly defects while preserving
native budget and authority gates. Successful fixture replies do not establish
model answer quality. Clear memory must invalidate writers before deleting only
owned state; reset settings must preserve memories and downloaded model cache.

**Effectiveness at the prior repair:** Application regression guards pass. Native answer-quality
effectiveness remains unknown: the pinned existing model file was unavailable
in the scoped artifact/Hugging Face caches. No new weights, inference or paid
calls occurred; fixture token counts are not native measurements.

**Relevance check:** Current; the affected paths own normal chat requests.

**Next prevention step recorded at the prior repair:** When the existing pinned model file is available,
replay the same prefixes with memory off/on/scope-switch under identical native
settings before claiming improved generated answers. Keep Settings clear and
startup pending-reset recovery on the same actor lock, with a durable reset
epoch; regression tests must reject stale replies, saves and recovery deletion.

### Q: Light trails hid a stationary graph

**Story ID / status / search synopsis:** RAG-CHAT-002; resolved for the local
bounded renderer lease and fixture checks. Search hooks: particles without node
motion, zero merge frames, footer resize, source meshes, summary convergence.

**Sources:** `Shoozes/rag-method-alpha`, candidate based on `992b230e`, wllama
3.5.1, LFM2.5-230M Q4_K_M; pinned forcegraph/Three 0.185.0 presentation.
**What:** A success particle capture could coexist with stationary source meshes.
**Context and constraints:** Compaction must retain canonical originals and real
source provenance while showing their actual graph nodes converge to a summary.
**Why it happened:** The first effect was DOM/SVG-only. After adding real motion,
asynchronous persistence left the old one-line footer during effect startup;
the final two-line footer resized the canvas and cancelled the lease at frame 0.
**Where:** `memory/panel.mjs`, `summary-effects.mjs`, application
`graphRenderer.ts`, summary-pocket browser and node-merge tests.
**Evidence:** A real manual 913-to-531-token compaction at 48.4% usable capacity
retained eight sources, but its effect moved no meshes. Controlled layout traces
showed the canvas height changing 386 to 368 pixels. The compact receipt retains
the failed capture and the later actual-position fixture proof.
**Developer story:** Visual inspection prompted a world-coordinate guard. The
first real-node repair then exposed a layout race. Two stable frames before the
save finished were insufficient; queuing after persistence and final UI refresh
removed the cancellation trigger.
**How to catch it:** Assert timestamped actual source XYZ approach the target;
particles alone cannot pass. Also test real resize cancellation, reduced motion,
search revealing canonical originals, settlement and no replay.
**Solutions tried:** DOM particles failed the mesh criterion; an early two-frame
gate still raced persistence; final-layout scheduling passed the focused browser.
**Current solution:** Reversible position lease, at most 12 sources/90 frames,
1.08-second convergence, 1.32-second expiry and bounded start gate. Reduced motion
settles immediately. Canonical layout remains intact.
**Decision rationale:** Repair presentation ownership without changing retrieval
or mutating original conversation records.
**Effectiveness:** Focused browser and Node guards pass; physical-device/GPU
coverage and the full native journey have separate evidence in the receipt.
**Relevance check:** Current; the visible compaction route uses these modules.
**Next prevention step:** Keep actual mesh motion and layout completion as
required guards when changing footer, persistence or graph rendering.

### Q: Repeated reminders crowded unique facts out of a summary

**Story ID / status / search synopsis:** RAG-CHAT-003; resolved for exact-passage
selection tests, native requalification recorded separately. Search hooks:
seven repeated excerpts, Cedar-17 missing, top-k duplicates, Tuesday correction.

**Sources:** Same local RAG candidate and pinned 230M/native runtime; automatic
extractor using the unchanged keyword-only RAG core.
**What:** Seven exact copies of a reminder occupied eight bounded summary slots.
**Context and constraints:** A real overflow reduced 1,973 to 694 prompt tokens,
yet omitted the authored notebook code and corrected watch day.
**Why it happened:** Selection deduplicated candidate IDs, while each identical
quote had its own ID and entered the core's top-k independently.
**Where:** `memory/automatic-context.mjs` and
`tests/model-chat-automatic-dedup.test.mjs`.
**Evidence:** Reconstructed all 34 original turn hashes from failed event e-38;
baseline extraction reproduced its exact summary hash. Deduplication changes
105 scanned candidates to 33 unique ranker inputs; the eight distinct selected
quotes retain Cedar-17 and Tuesday replacing Monday.
**Developer story:** The strict authored-fact assertion failed despite a large
token reduction. Replaying the exact hash-bound prefix isolated ranking crowding
from model generation. Exact text deduplication before core ranking restored
space for the unique authored facts without changing the RAG core.
**How to catch it:** Repeat one instruction twelve times around unique authored
code/correction; assert each quote enters the actual ranker once, source spans
and hashes remain exact, and protected/assistant copies never become references.
**Solutions tried:** ID-only filtering failed; exact quote filtering passed.
**Current solution:** Retain the first eligible exact quote before top-k;
case, Unicode composition and internal whitespace remain distinct. Report
scanned, unique, duplicate and omitted counts honestly. Preserve newest fallback,
2,048-candidate scan refusal and canonical source hashes.
**Decision rationale:** Fix bounded selection without fuzzy truth merging,
automatic memory promotion or new retrieval behavior.
**Effectiveness:** 82 focused extraction/workspace tests and the final 435-test
suite pass. Native and generated-answer acceptance remain separate.
**Relevance check:** Current; repeated chat instructions can consume top-k slots.
**Next prevention step:** Require distinct retained passages and a unique
authored-fact assertion in real automatic and manual compaction journeys.

### Q: A correct request still produced Fred boilerplate

**Story ID / status / search synopsis:** RAG-CHAT-004; unresolved. Search hooks:
"What are their names?", Fred programming assistant, Phobos Deimos missing,
native meter versus fresh Worker, small-model quality.

**Sources:** Same candidate, official pinned LFM2.5-230M Q4_K_M, native embedded
chat template, seed 42, temperature 0, context 2,048, one CPU thread.
**What:** The short moons follow-up received irrelevant Fred boilerplate.
**Context and constraints:** Exact role-ordered request and source hashes were
correct; generated text must remain the actual model output.
**Why it happened:** The model-side quality cause is unresolved. A native meter
or prior native history is not necessary to reproduce the observed failure.
**Where:** `tests/model-chat-space-journey.mjs`, the retained diagnostic helper,
and the single acceptance receipt.
**Evidence:** Fresh reply-only, fresh measure-then-reply, and unrelated warm-up
then measure/reply returned the same wrong answer for the same failed request
hash. A generic follow-up hint fixed one replay but failed in the full dialogue.
**Developer story:** The real journey exposed a failure hidden by deterministic
UI fixtures. Controlled same-request comparisons tested meter/cache suspicion
before changing unrelated runtime paths. Their identical outputs prevented a
false orchestration diagnosis.
**How to catch it:** Run the actual native authored journey and inspect separate
semantic failures. Do not treat fixture acknowledgements or successful dispatch
as a correct answer.
**Solutions tried:** Generic follow-up instruction had a narrow positive result;
it did not establish general conversational quality. A bounded 12-reply matrix
reconstructed the two failed request hashes through real production operations.
Both baseline failures repeated byte-for-byte across two fresh Workers each.
One generic append fixed the frozen moons case twice but regressed recall twice,
omitting code and corrected day. Two held-out families passed once per arm.
**Current solution:** Keep the failure explicit. No hardcoded moon answers,
model substitution or answer rewriting. Reject the generic append; keep product
prompts unchanged. These diagnostic-exposed families cannot serve as a sealed
future final benchmark or become training rows automatically.
**Decision rationale:** Product correctness requires honest native quality
evidence; source retention and answer quality are distinct gates.
**Effectiveness:** Unknown; a general repair has not passed the quality gate.
**Relevance check:** Current; this is the intended model and conversation route.
**Next prevention step:** Review the failed exact requests before choosing a
separately scoped prompt or model experiment; preserve the same semantic checks.

### Q: A front-facing color test misread overlapping spheres

**Story ID / status / search synopsis:** RAG-CHAT-005; resolved locally with
regression guards. Hooks: front-facing fixture radius contract, 45x25 overlay
drag, centerOwner, body occlusion, pinned amber tint, chromaticity distance 0.198.
**Sources:** Local RAG candidate, historical graph bundle `4949fd33` and fixed
bundle `32fe9a87`,
Chrome 155 with real TSL/WebGL rendering and CDP touch; no native model fixture.
**What:** An older planar proof misclassified the new angled 3D presentation.
**Context and constraints:** Preserve the frozen hue, saturation, body-area,
minimum-pixel and 0.20 separation thresholds; selection grants no permissions.
**Why it happened:** Old radius math assumed a front camera, overlay dragging
assumed translation, and DOM label ownership chose sphere samples. Foreground
persona pixels were then counted against a blue body behind them. After repairing
measurement, a real material defect remained: fixed XYZ sets the producer's
Pinned flag, whose default 18% amber mix dulled memory scope hues.
**Where:** Mobile browser harness and `tests/node-color-area.mjs`.
**Evidence:** Actual targets report radius/depth. Camera-angle measurement proves
the full 45x25 orbit with conserved target/radius. Geometry-only masking fixes
the false hue-area failure. The pinned-state color equation predicts observed
pastel blue (RGB 113.46,170.40,232.60 versus 113.57,170.55,232.78). With the
memory-only pinned mix disabled, the complete eight-group browser route passes;
blue/persona separation is about 0.48–0.51 against the same 0.20 minimum.
**Developer story:** The existing touch route exposed stale assumptions in order.
Actual projection and orbit replaced those assumptions; the next failed pixel
check was inspected before changing measurement. A causal pinned-style analysis
then justified a narrow adapter change; the original failed image remains.
**How to catch it:** Thirteen pure pixel tests reject wrong unoccluded hues,
foreground color contamination, insufficient/fully occluded samples and malformed
mask identities. Run the mobile harness against the current bundle as well.
**Solutions tried:** Fixed front-plane radius and unmasked body disks failed;
actual projection plus conservative depth masks passed those boundaries. The
selected-source presentation also needed genuine two-contact pan: a one-contact
drag now orbits and cannot stand in for translation. Full disks behind an opaque
source reader are excluded geometrically while all bodies still mask occlusion.
**Current solution:** Measure all actual projected bodies, excluding nearer or
depth-tied disks geometrically; keep thresholds and per-scope presence intact.
Set `stateTheme.pinned.colorMix: 0` only for memory-spatial nodes. Preserve palette,
sphere material, fixed placement and generic pinned styling. A focused adapter
test guards both the memory option and untouched generic/legacy behavior.
**Decision rationale:** A test repair must not fabricate a material-quality pass.
**Effectiveness:** Pure pixel and adapter guards pass. All eight actual browser
groups pass, including search/selection/reduced motion, keyboard/source access,
generic wrapper and graph-disabled fallback. Physical iOS remains unqualified.
**Relevance check:** Current; orbit, resize and real body overlap are normal.
**Next prevention step:** Require the unchanged complete touch/color route after
graph state-theme changes; check fixed-coordinate semantics before adjusting
palette anchors or a pixel threshold.

### Q: Streaming repaint reopened a pending Copy action

**Story ID / status / search synopsis:** `RAG-CHAT-006`; resolved in the tested
DOM lifecycle scope; Current. Search hooks: streaming re-enabled Copy, pending
clipboard write, stale manual-copy fallback, late focus after pagehide,
"Clipboard unavailable. Select and copy the original text below."

**Sources:** `Shoozes/rag-method-alpha`, safe formatting/copy repair `71559da`.
Pinned wllama 3.5.1 and LFM2.5-230M are unchanged; no model call was needed.
**What:** Token repaint and an asynchronous Copy operation shared one disabled
button state. A token could enable a second write while the first was pending;
out-of-order outcomes could then show stale status or focus an old fallback.
**Context and constraints:** Copy must preserve the exact original string while
the rendered message may change. Clipboard completion must not mutate a cleared
or disposed view. The OS clipboard is user-controlled, separate from storage.
**Why it happened:** Initial `paintMessage` derived disabled state only from
nonempty text. Copy set disabled before awaiting the clipboard, but repaint
could overwrite that state. Epoch/connected-node checks alone did not exclude
pagehide, whose document nodes can still be connected.
**Where:** `examples/browser-model-chat/app.mjs`, `paintMessage`, Copy handler
and pagehide cleanup; `tests/model-chat-format-browser.mjs`.
**Evidence:** The initial 12-group browser pass omitted delayed clipboard
operations. Independent source review located the shared-state race; a retained
pre-fix failing clipboard replay is not claimed. The final browser fixture
holds a clipboard promise, emits a token, forces duplicate activation and
asserts exactly one write, disabled state and exact click-time fallback text.
A late rejection after pagehide cannot change status, fallback or focus.
**Developer story:** Passing ordinary copy/error cases did not cover ownership
while streaming. Review identified the missing interleaving. The repair added
per-message in-flight ownership and a synchronous view-lifetime guard, then
extended the actual DOM fixture before the clean candidate was committed.
**How to catch it:** Run the Copy concurrency/teardown group in
`tests/model-chat-format-browser.mjs`; preserve its delayed-promise and forced
duplicate-event assertions alongside selection, reload and exact raw copy.
**Solutions tried:** Disabling only in the click handler was insufficient;
repaint must respect the same in-flight owner. A connected node does not prove
an active view. No clipboard permission bypass or model/prompt change was used.
**Current solution:** A WeakSet guards both repaint and duplicate activation.
Async UI updates require the current session epoch, a connected message and
`viewActive`; pagehide clears that last gate synchronously.
**Decision rationale:** Keep one small ownership guard per async UI action
rather than serializing model tokens or changing accepted conversation data.
**Effectiveness:** Cross-device effectiveness is unknown. All 12 actual Chrome
fixture groups and 479 regression tests pass for the repaired source; the
fixture does not write the OS clipboard or establish physical iOS behavior.
**Relevance check:** Current; streaming and denied/delayed clipboard access are
normal supported routes.
**Next prevention step:** Keep this interleaving when changing message actions;
qualify real clipboard permissions and mobile behavior in the device gate.
