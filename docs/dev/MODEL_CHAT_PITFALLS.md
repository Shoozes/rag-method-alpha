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

**Effectiveness:** Application regression guards pass. Native answer-quality
effectiveness remains unknown: the pinned existing model file was unavailable
in the scoped artifact/Hugging Face caches. No new weights, inference or paid
calls occurred; fixture token counts are not native measurements.

**Relevance check:** Current; the affected paths own normal chat requests.

**Next prevention step:** When the existing pinned model file is available,
replay the same prefixes with memory off/on/scope-switch under identical native
settings before claiming improved generated answers. Keep Settings clear and
startup pending-reset recovery on the same actor lock, with a durable reset
epoch; regression tests must reject stale replies, saves and recovery deletion.
