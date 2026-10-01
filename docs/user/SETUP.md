# Setup and first use

## Browser documentation explorer

Prerequisites: Node.js 22.12 or newer, npm, and a current browser. WebGPU/WebGL availability affects graph rendering; the application also has an accessible SVG/list path.

From the repository root:

```text
node run.mjs setup-browser
node run.mjs run-browser
```

`setup-browser` explicitly runs locked npm installation for this application. No other task installs dependencies. Open the URL printed by Vite and choose **Open Atlas**. Stop the server with Ctrl+C.

1. Choose **Explore the Three.js demo vault** to index the bundled Three.js/TSL documentation.
2. Run a suggested question or enter your own query.
3. Select ranked evidence and inspect the matching graph node.
4. Read the complete source and follow its upstream documentation link.
5. Inspect **What does the LLM receive?** to see the selected text a model would receive.
6. Use the local-file/folder action to explore your own Markdown/text files. An interrupted or invalid replacement keeps the previously accepted corpus.

Files selected in this application remain in the current browser Worker session. Refreshing ends that session. The bundled example is served from the local application; startup does not fetch upstream documentation. No model is invoked.

## Python/React Lab

Prerequisites: **Python 3.12**, Node.js 22.12 or newer, npm, and a browser. Python 3.12 is the tested locked setup. `requirements.lock` pins NumPy `2.5.1`, which requires Python 3.12 or newer. The `pyproject.toml` `>=3.10` declaration describes the wider range-based development dependencies, not the compatibility of this lock.

Select setup deliberately:

```text
node run.mjs setup-lab
```

This creates `source/backend/.venv`, installs `source/backend/requirements.lock`, and runs locked npm installation for `source/frontend`. It does not install optional semantic models. The Python selected through `PROJECT_PYTHON` or PATH must be Python 3.12 for this task.

Activate that environment before running or testing the Lab:

```powershell
source/backend/.venv/Scripts/Activate.ps1
node run.mjs run-lab
```

```sh
. source/backend/.venv/bin/activate
node run.mjs run-lab
```

Alternatively set `PROJECT_PYTHON` to the prepared environment's Python executable. The thin Node menu passes this interpreter to product scripts. `run-lab` delegates the existing managed launcher, which selects free loopback ports, prints the URL, and stops both services on Ctrl+C.

1. Choose **Load Demo**; reloading it is idempotent.
2. Ask a suggested query, select ranked evidence, and inspect its source.
3. Enable **Advanced tools** for mode, pocket, Top K, context, and score details.
4. Compare retrieval modes or export the current query report.
5. Import a synthetic folder/ZIP to inspect the local import flow.

The Lab writes mutable state under `runtime-data/mirrorlight/` by default. That directory is ignored. Use `scripts/visual_run.py --data-root <directory>` to select another location. The browser client supports loopback use; it does not supply credentials to a remote backend.

## Prepared environments

If dependencies are already installed, skip setup and select run/test tasks directly. A missing prerequisite produces an actionable error. The menu never installs software in response to a run, build, or test failure.

The browser explorer can run without Python. The frozen reference conformance commands use only Python's standard library and the checked-in reference source. Full Lab and browser-journey checks require the explicit prepared runtimes documented above.
