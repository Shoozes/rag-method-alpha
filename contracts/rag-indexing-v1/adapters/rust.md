# Rust indexing adapter

Implement the frozen profile with Rust Unicode-scalar iteration and the v2
identity functions already shared by production retrieval. Route `.md` and
`.txt` ingest through that native function before EdgeSymbio builds
`FileChunkSource` values. `text_start` and `text_end` are canonical scalar
offsets, not UTF-8 byte lengths. Keep PDF/OCR and SQLite behavior outside the
portable lane.

Use strict `std::str::from_utf8`, the explicit whitespace table, and fixture-
supplied limits. The report must be generated from a clean commit without a
runtime dependency on RAG-Method-PY.

Done when: all cases and native production-seam regressions pass, long lines
stay bounded, supplementary characters are never split, and the clean report
exactly matches the coordinator.

---
AI-edited: 2026-08-09T00:00:00-04:00 | agent=Codex/root | model=gpt-5.6-sol | effort=max | task=rag-indexing-v1 | change=defined the native Rust indexing parity seam
