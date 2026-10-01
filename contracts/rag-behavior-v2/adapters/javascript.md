# JavaScript adapter

Implement the frozen profile natively in TulpaWeaver. The parity lane may use
SQLite and the existing vector-store dependency injection, but it must accept
contract vectors by record ID so duplicate text is unambiguous and no model or
network download is needed.

Pin native tests to every identity test vector in `retrieval-profile.json` as
well as the 15 retrieval reports; count query characters as Unicode scalar
values rather than UTF-16 code units, reject unpaired UTF-16 surrogates, and
measure the separately bounded UTF-8 encoding without replacement characters.
Use Unicode-scalar lexicographic order for string tie fields rather than
locale-sensitive comparison or JavaScript's raw UTF-16 code-unit order.
The `complete_tie_break` and `context_budget` cases deliberately contain
supplementary scalars and will fail raw UTF-16 ordering or length logic.

The shared result order must be produced before prompt assembly, grounding,
citations, memory persistence, UI, or chat behavior. Disable the current
memory-trust, wiki decay, cross-reference tiers, aspect-first reorder, and
durable-first reorder in the parity path. Product features may consume the
frozen order but must not mutate it.

Trim contract record strings before use and reject unpaired surrogates in
records as well as queries; silently inserting Unicode replacement characters
changes identity, matching, ordering, and context counts.

Required return to the coordinator:

- exact implementation commit and dirty state;
- local commands and test results;
- machine report path;
- deviations with what, why, where, how, and done-when;
- the next safe action.

Done when: the JavaScript report validates, all cases match exactly, existing
local TulpaWeaver verification passes, and duplicate-text vectors and query
cancellation have explicit native seams.

---
AI-edited: 2026-08-09T22:15:16-04:00 | agent=Codex/root | model=gpt-5.6-sol | effort=max | task=rag-v2 | change=defined the native JavaScript parity adapter boundary and UTF-16 drift guards
