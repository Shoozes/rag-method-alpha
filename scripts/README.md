# Product commands

`project.tasks.json` is the single portable app task catalog. `run.mjs`, `run.cmd`, and `scripts/app.ps1` delegate its declarations. Product behavior remains in the existing Python scripts and package commands.

The Python compatibility runner remains directly callable:

```text
python -B scripts/run.py -Task rag-contract
python -B scripts/run.py -Task rag-indexing-contract
python -B scripts/run.py -Task test
python -B scripts/run.py -Task visual-run --no-open
python -B scripts/run.py -Task browser-rag-run --no-open
```

`scripts/run.py -Task test` means application verification: active backend tests, frozen reference contracts, and frontend checks. The former private PowerShell controller's foundation-test route is not part of this public surface. Use the app menu or Python runner for public tasks rather than an old controller wrapper.

Setup is explicitly selected through `setup-browser` or `setup-lab`. Run/test/build commands do not install packages, download models, or fetch documentation. Local browser journeys use a prepared Chromium browser and clean their owned processes, ports, and temporary state.

See [DEVELOPMENT.md](../docs/DEVELOPMENT.md) for command prerequisites, exact artifact staging, and corpus regeneration.
