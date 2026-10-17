# Browser chat product and demo checklist

Scope: one browser-local text conversation, optionally augmented by scoped
memory. This is an experimental preview, not a qualified commercial workspace.
Review baseline: `71559daf0dc23ef3f9f17587564c92f68a4f03c9`.

Publication: that source and Pages `adc1ecf` were published normally; legacy
Pages build `1292719372` completed. Nine HTTPS groups pass: all 49 assets match
GET/HEAD hashes and MIME, across 118 requests, without model/Worker execution.
Twelve formatting groups also pass against the deployed HTTPS UI: 31 unique
production assets were checked against the published source, with a labeled
provider/meter/clipboard fixture. No model or OS clipboard was used. Fixture/live
asset checks do not replace native quality or device acceptance.

## Identities and boundaries

- **RAG browser chat:** actual pinned wllama/WASM inference after explicit load;
  optional scoped retrieval and request inspection, separate from Atlas ([preview](../../examples/browser-model-chat/README.md),
  [bootstrap](../../examples/browser-model-chat/bootstrap.mjs#L10)).
- **Atlas:** model-free retrieval/graph demonstration ([root guide](../../README.md)).
- **Umbra-Desk:** separate fixture-backed shell/presets; starter kits are proposed.
  Its `docs/WORKSPACE_TEMPLATE_PLAN.md` owns the overall plan. Fixture participants
  are not working agents; visual persona selection grants no access.
- No paid/full-product, accounts, billing, teams, thread/persona manager,
  attachments, tools or autonomous agents are established. Palette tokens remain deferred.

## Ordered acceptance checklist

| Order / owner | Current source and limits | Next finite acceptance |
| --- | --- | --- |
| 1. Correctness/usability - browser owner | **Verified:** 479 local tests, 12 local and 12 HTTPS UI fixture groups, seven package groups and nine live delivery groups. Assistant Markdown supports paragraphs, emphasis, flat lists, inline/fenced code and explicit HTTP/HTTPS links; user text stays literal. HTML/images/unsupported syntax stay inert; URLs are checked. Selection defers repaint. Copy preserves raw text with manual fallback. [Renderer](../../examples/browser-model-chat/message-renderer.mjs#L77), [tests](../../tests/model-chat-message-renderer.test.mjs), [browser cases](../../tests/model-chat-format-browser.mjs). | Completed for the pinned preview: exact live bytes, keyboard copy, narrow code scrolling, hostile markup/URLs, selection, reload/history and citations. Preserve these guards when changing messages. Prompts, source hashes and stored text remain unchanged. |
| 2. Completion and recovery — browser/runtime owner | An explicit native `length` reason shows the unchanged 160-token reply cap; absent/unrecognized reasons stay **unknown**. Native availability of that metadata was not freshly observed by the fixture checks. Stop still terminates/unloads the model and needs cache-first reload; its accessible description says so. [Completion UI](../../examples/browser-model-chat/app.mjs#L428), [Worker](../../examples/browser-model-chat/engine-worker.mjs#L250), [transport tests](../../examples/browser-model-chat/tests/engine-worker-completion.test.mjs), [Stop](../../examples/browser-model-chat/index.html#L61). | In the next separately bounded native acceptance, record actual finish metadata and Stop/reload recovery. Do not infer truncation from character count or call formatting a model-quality fix. Three prior native semantic failures remain open ([quality evidence](SPACE_JOURNEY_ACCEPTANCE.md)). |
| 3. Identity/privacy/deletion — product/browser owner | Memory uses **unencrypted JSON localStorage**; basic chat is session-only. Cold weights use pinned Hugging Face HTTPS; inference stays local. Reset settings preserves content. Confirmed Clear invalidates old saves but preserves model downloads; Forget preserves transcript. No cache-clear UI. [Storage](../../examples/browser-model-chat/memory/workspace.mjs#L108), [download](../../examples/browser-model-chat/model-contract.mjs#L7), [reset](../../examples/browser-model-chat/session-storage.mjs#L17), [confirmation](../../examples/browser-model-chat/index.html#L64). | Review first-use storage/shared-device/download/Stop/deletion wording and discoverable version identity. Decide cache/export scope; do not promise encryption, universal offline operation or erase-all semantics. |
| 4. Text-model contract — GenUni/Praxeon owners, independent evaluator | GenUni owns preparation and canonical `docs/dev/DATA_PREPARATION_MODULE.md`; Praxeon retains NPC acceptance. NPC/oracle data is not automatically suitable for an assistant. Orbit's checkout remains unlocated. No fit/ingestion is authorized. | Follow overall-plan T1–T7: rights/objective/manifest; source/conversation/family leakage audit; sealed common held-out set excluded from both training sets; exact base/tokenizer/template; approved resource budget; independent base comparison; merge/conversion/GGUF parity; browser qualification before authorized publication. Exposed diagnostic cases are not fresh finals. |
| 5. Device/install — browser/release owner | Physical iOS, screen-reader streaming, hardware GPU and clean install remain unqualified. SHA verification adds memory beyond 153.4 MB weights. [Runtime](../../examples/browser-model-chat/engine-worker.mjs#L134), [limits](SPACE_JOURNEY_ACCEPTANCE.md), [mobile checklist](../../examples/browser-model-chat/MOBILE.md). | Record named device/browser, HTTPS, Files picker, cold/cache loads, memory, cancel/recovery and inference; test a screen reader and clean setup. Historical HTTPS success/HTTP failure near 50 MB is an observation, not a platform rule. |
| 6. Extraction — Umbra/release and consumer owners | Shared shell/loader interfaces are candidates; GenAce needs owner coordination. | Require a second consumer, stable interfaces, setup/license attribution, clean-install proof and qualified demo. Graph/RAG owners retain behavior. Further modules/shaders follow functional acceptance; no new repository/sales listing is implied. |

Next packet: identity/privacy/recovery wording and cache/export decisions.
The local Umbra-Desk `docs/CONVERSATIONAL_MODEL_EXPERIMENT.md` now proposes
exact HF metadata/config/template pins, data/split prerequisites, a finite pilot
budget and evaluation/export/browser gates. Owner selection, tokenizer-byte and
backend checks, data-use approval and resource confirmation remain blockers.
Current browser prompts request plain text; a changed formatting policy needs
review and equal baseline/candidate framing. Implementation, training, paid
compute and uploads need their own scope.
