# Rust adapter

Implement the frozen profile natively in EdgeSymbio. Copy the contract
artifacts into an EdgeSymbio-owned test fixture or parse them from an explicit
operator-supplied path during development; shipped runtime behavior must not
depend on RAG-Method-PY.

Pin native tests to every identity test vector in `retrieval-profile.json` as
well as the 15 retrieval reports. Identity parts use byte-length-prefixed
strict UTF-8, query and context character counts use Unicode scalar values,
and string ties use Unicode-scalar lexicographic order.
The `complete_tie_break` and `context_budget` cases are the native regression
anchors for these ordering and counting rules.

Preserve EdgeSymbio storage, Nomic runtime, SQLite integrity, API, UI, chat,
and cancellation machinery. The parity lane must use contract-supplied vectors
and emit `rag-behavior-v2-report`. Replace product profile constants only where
they are inside the shared retrieval boundary. Do not edit expected outputs.

Required return to the coordinator:

- exact implementation commit and dirty state;
- local commands and test results;
- machine report path;
- deviations with what, why, where, how, and done-when;
- the next safe action.

Done when: the Rust report validates, all cases match exactly, existing local
EdgeSymbio verification passes, and product-specific behavior remains outside
the parity ordering path.

---
AI-edited: 2026-08-09T22:15:16-04:00 | agent=Codex/root | model=gpt-5.6-sol | effort=max | task=rag-v2 | change=defined the native Rust parity adapter boundary and Unicode scalar rules
