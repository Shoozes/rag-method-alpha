# RAG Method Lab backend

The active FastAPI backend owns bounded imports, durable index generations, graph transport, and retrieval. Its compatibility package is `mirrorlight_backend`; route and configuration names retain stable `companion_id` and `MIRRORLIGHT_*` identifiers.

The locked setup is tested with **Python 3.12**. NumPy `2.5.1` in `requirements.lock` requires Python 3.12 or newer. `requirements.txt` and `pyproject.toml` remain the wider range-based development manifest with a `>=3.10` declaration; that range does not make this lock compatible with Python 3.10/3.11.

From the repository root, explicitly select setup and activate the resulting environment:

```text
node run.mjs setup-lab
```

```powershell
source/backend/.venv/Scripts/Activate.ps1
node run.mjs visual-run
```

Or run this backend alone from this directory using the prepared interpreter:

```text
python -B -m mirrorlight_backend
python -B -m unittest discover -s tests -v
```

The default API is `http://127.0.0.1:8080`. The managed Lab launcher instead chooses available loopback ports and supplies its frontend origin. See [setup](../../docs/user/SETUP.md) and the [integration contract](../../docs/dev/RAG_CONTRACT.md) for explicit state, configuration, and request boundaries.

No embedding model is required. Optional hash vectors are a deterministic integration prototype; model-backed SentenceTransformers remains an explicit development extra and is outside the default locked setup. Exact/keyword requests avoid query embedding. Semantic-disabled modes report their state honestly.

The tests use temporary synthetic data and include import/path limits, serialized-index recovery, vector-sidecar validation, cancellation, loopback Host/Origin admission, API compatibility, demo integrity, reports, and launcher cleanup. The same reference functions serve production search and both frozen contract validators.
