# Python adapter

The Python oracle is `mirrorlight_backend.rag_core.RagEngine`. The contract
runner loads fixture records and vectors without a model download, executes
every case, and compares the complete redacted observation to the frozen
mode-specific expectation.

The profile's identity test vectors also pin the length-prefixed SHA-256
encoding used by the reusable v2 chunking helpers.

The production `RagService` adapter must flatten its indexed chunks in the
same order as its stored vectors, map each chunk to `RagRecord`, and pass the
same record/vector set to `RagEngine`. Query embedding failure is represented
as a semantic fallback; it must not select a second ranking implementation.

Run:

```powershell
python scripts/rag_contract_validate.py
python scripts/rag_run_python_adapter.py --output .artifacts/proof/rag-python-v2.json
```

Done when: the report has zero failed cases, production responses identify
`rag-behavior-v2`, and a regression test proves `RagService` uses the oracle
path.

---
AI-edited: 2026-08-09T22:15:16-04:00 | agent=Codex/root | model=gpt-5.6-sol | effort=max | task=rag-v2 | change=defined the Python oracle and production adapter boundary
