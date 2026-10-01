# Python indexing adapter

The executable oracle is `mirrorlight_backend.rag_core.indexing.index_document`.
The production Markdown/text indexer must call the same function and may only
translate its returned records into application graph and persistence shapes.
It must decode files as strict UTF-8 before that call. PDF, OCR, memory JSON,
filesystem scanning, embeddings, and graph resolution stay outside this lane.

Run `python scripts/rag_indexing_contract.py`. Generate a retained report only
from a clean commit with `--output .artifacts/proof/rag-indexing-v1/python.json`.

Done when: all frozen cases pass, the production source path has a regression
test against the oracle observation, and invalid UTF-8 fails visibly rather
than being ignored or replaced.

---
AI-edited: 2026-08-09T00:00:00-04:00 | agent=Codex/root | model=gpt-5.6-sol | effort=max | task=rag-indexing-v1 | change=defined the shared Python oracle and production adapter seam
