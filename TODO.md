# TODO

Updated 2026-10-23 after review, recheck, scoped cleanup, and the accepted dropin/work proof batch.

## Completed batch

- [x] Pull `origin/main` with `git pull --ff-only`: already up to date at `63666dc3783dfa600d92a4102a1d2008ad8907ae`. The starting checkout was clean; the changes below remain local and uncommitted.
- [x] Fix scope-priority handling in the browser retrieval core. Valid `constructor`, `toString`, and `__proto__` scopes now receive their configured priority, or zero when absent, without inherited properties producing `NaN` scores. Normalization still rejects actual duplicate keys.
- [x] Reject non-object JSON scope-priority inputs with `ContractError`. Present values follow the frozen query schema's object requirement, including rejection of `null`; the Python function's optional `None` convenience is not a JSON-schema allowance.
- [x] Add five focused retrieval regressions and a Worker search/report regression. Before repair, the focused suite reproduced four failures; after repair, all five pass.
- [x] Document the Python 3.12 requirement for exhaustive adapter conformance in [Development](docs/DEVELOPMENT.md).

## Review and recheck coverage

The checkout has no Summary Bank, repository AGENTS file, AI_PROVENANCE file, or previous TODO/review report. Context came from the manifests, READMEs, method/API contracts, implementation, consumers, tests, and recent commits; no native Summary Bank commands ran. This is a bounded repository review, not a claim that every line or dependency was audited.

Reviewed browser retrieval, Worker validation/lifecycle, transactional imports, source/context access, graph coordination/replay, build identity, and verification tooling. An independent read-only review covered backend request/upload boundaries, persistence, React request cancellation, and query-report construction; it found no additional verified defect.

There was no formal previous review baseline. Recheck therefore used the specific fixes claimed by `512425e` and their current regressions:

- **Verified closed:** replay reentrancy/cancellation, stale-source and modified-payload capture rejection, failed-journey cleanup preserving failure, and Windows active-port ownership. The full Atlas journey passes on the current runtime changes.
- **New, now closed:** inherited scope-priority keys/non-finite scoring and missing core validation of malformed priority maps.
- **Follow-up verified closed:** POSIX `TIME_WAIT` rebinding and fresh source-bound Atlas presentation captures, as recorded below. Native-GPU behavior remains outside this batch; existing public screenshots qualify their recorded source only.

## Local verification

Windows PowerShell 7; Node `26.5.0`; Python `3.12.10` for locked Lab and adapter/browser checks. Initial standard-library contract/launcher checks also passed on Python `3.13.3`. Locked dependencies were prepared with `node run.mjs setup-browser` and `py -3.12 -B scripts/setup_lab.py`; dependency manifests and locks were not changed.

| Command | Result |
| --- | --- |
| `python -B scripts/rag_contract_validate.py` | Exit 0; 15/15 frozen retrieval cases. |
| `python -B scripts/rag_indexing_contract.py` | Exit 0; 12/12 frozen indexing cases. |
| `node modules/browser-rag-ts/scripts/test.mjs scopePriorities` | Exit 1 before repair (4 failed, 1 passed); exit 0 after repair (5 passed). |
| `node run.mjs test-browser-unit` | Exit 0; 84 application/core/Worker tests, 27 artifact/presentation tests, typecheck, contract synchronization, Unicode and core/vendor checks. |
| `py -3.12 -B scripts/browser_rag_adapter_conformance.py --prepared-module` | Exit 0; exhaustive Unicode and deterministic Python/Node adapter agreement. The initial `python -B` invocation exited 1 because default Python 3.13 differs from the owning 3.12 runtime; no tables were regenerated. |
| `.\.venv\Scripts\python.exe -B -m unittest discover -s tests` from `source/backend` | Exit 0; 159 tests run, one POSIX-only test skipped on Windows. Includes launcher regressions. |
| `npm --prefix source/frontend run test` | Exit 0; React typecheck and production build. Bundle-size warnings are not measured performance defects. |
| `py -3.12 -B scripts/browser_rag_smoke.py` | Exit 0; 44/44 Atlas checks and exact frozen Python/Node/actual-Worker comparisons. |
| `.\source\backend\.venv\Scripts\python.exe -B scripts/browser_smoke.py` | Exit 0; 11/11 Lab checks and validated exported report. |
| `node run.mjs build-browser` | Exit 0; static artifact, Worker bundle boundary, notices, payload/HTML/MIME checks, and source identity validated. |
| `node scripts/atlas_presentation.mjs` | Exit 0; 50/50 presentation checks and four captures reviewed. Used `LOCAL_BROWSER_SOFTWARE_WEBGL=1`. |

Both browser commands used `LOCAL_BROWSER_SOFTWARE_WEBGL=1`, Playwright `1.62.0`, and local Chrome `155.0.8059.86`. Receipts confirm Worker/browser/server cleanup, released ports, and Lab temporary-state removal. No hosted checks, publication, commits, or pushes ran.

Receipts remain in the repository's existing verifier-owned `.artifacts/proof/` paths, preserving their documented path contracts: `browser-rag-ts/browser.json`, `browser-rag-ts/adapter-conformance.json`, both three-way comparison reports, and `browser-smoke.json`. Prepared local dependencies and build outputs remain available for reruns. Public media and `PUBLIC_MANIFEST.json` were not regenerated; local builds remain unreviewed working-source artifacts.

## Accepted dropin/work batch — completed

The follow-up accepted the two outstanding proof items after checking current source and receipts. Prior scope-priority fixes remain verified complete; no separate architect feedback or research-inbox item was supplied or found. Work stayed in `rag-method-alpha` at the base commit recorded above, preserving the existing local edits. This batch owns this work-record update and the existing verifier output paths; no additional product-code change was needed.

- [x] Run `node run.mjs build-browser`, then `node scripts/atlas_presentation.mjs`; inspect the resulting four captures. **Done when:** all presentation checks pass against the current source fingerprint and actual images are reviewed. **Result:** 50 checks pass; overview, docked source reader, evidence graph, and mobile captures show readable content and reachable Search controls without pane overlap. The receipt at `.artifacts/proof/atlas-presentation/manifest.json` binds the exact captured source/artifact and image hashes. Public media was not replaced.
- [x] Qualify the POSIX launcher lane on an explicitly selected installed WSL2 distro or local POSIX host. **Done when:** the documented browser-runner, visual-run, and portable-runner tests pass, including real `TIME_WAIT` rebinding. **Result:** passed in `Codex-Compat-EOF`, Linux `6.6.87.2`, Python `3.10.12`, using the same mounted working tree at `/mnt/c/DevStuff/rag-method-alpha`.

The POSIX commands used `wsl.exe -d Codex-Compat-EOF --exec bash -lc` with `cd /mnt/c/DevStuff/rag-method-alpha` before each command:

| Linux command | Result |
| --- | --- |
| `python3 -B -m unittest discover -s source/backend/tests -p test_browser_rag_runner.py -v` | Exit 0; 7 passed, no skips, including real `TIME_WAIT` replacement-listener behavior. |
| `python3 -B -m unittest discover -s source/backend/tests -p test_visual_run.py -v` | Exit 0; 5 passed, no skips. |
| `python3 -B -m unittest discover -s source/backend/tests -p test_portable_runner.py -v` | Exit 0; 13 passed, one Windows-only process-group test skipped. |

The first selected distro, `Codex-Compat`, could not start because its registered `D:\WSL\Codex-Compat\ext4.vhdx` was missing (`Wsl/Service/CreateInstance/MountDisk/HCS/ERROR_PATH_NOT_FOUND`). The installed fallback supplied the required POSIX evidence; no WSL repair, installation, or configuration change was performed. That host issue does not block this repository batch.

No further evidenced repair or proof task remains in the selected batch. Native-GPU/performance qualification, physical-device coverage, public-media replacement, and release/publication acceptance are separate scope. No graph-library change, frozen-contract rewrite, speculative optimization, or broader refactor is selected.
