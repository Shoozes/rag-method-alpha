# TODO

Updated 2026-10-24. The previous repair/proof batch was published as `a33bbcec7f179bca75334806680331b4a28f49b8`. The next bounded batch addresses native GPU rendering evidence.

## Priority batch: native GPU rendering evidence — completed

The previous batch has no remaining unchecked tasks. Native GPU rendering was its first remaining local proof gap. This pass qualifies the recorded host's WebGL2 path using the existing Atlas journey; performance targets, physical-device coverage, public-media replacement, and release acceptance remain separate decisions.

- [x] Add a native GPU task and record both the actual Atlas canvas renderer and Chromium GPU diagnostics. Preserve software and unverified classifications; require hardware evidence rather than inferring it from launch options or installed adapters.
- [x] Run `node run.mjs test-native-gpu`. **Done when:** all original presentation checks and the native checks pass, all four captures show a hardware WebGL2 renderer, current source/artifact identities match, the images are inspected, and browser/server/port cleanup is proven. **Result:** 55 checks and four captures pass on the RTX 4090 through ANGLE/D3D11; overview, source reader, evidence graph, and mobile images were inspected.
- [x] Verify a forced-software native attempt fails while recording successful owned cleanup. **Done when:** the native command exits nonzero, its separate receipt stays failed and identifies software rendering, and it cannot replace the native passing receipt. **Result:** exit 1, receipt `status: fail`, observed SwiftShader, zero captures; browser/server closure and port rebinding all pass.
- [x] Run the affected GPU regressions and neighboring browser unit/static checks. **Result:** all five new GPU regressions, the 84 application/core/Worker tests, existing artifact/presentation tests, contract synchronization, core/vendor/Unicode boundaries, and typecheck pass. The new portable task and local adapter dry runs reach the existing build/capture owners.

| Current batch command | Result |
| --- | --- |
| `node --test modules/browser-rag-ts/tests/artifact/browser-gpu.test.mjs` | Exit 0; five regressions cover native admission, software/masked/conflicting evidence, bounded diagnostics, timeout, and protocol-session cleanup. |
| `node run.mjs test-browser-unit` | Exit 0; application/core/Worker and artifact/presentation checks pass, including the new GPU regressions. |
| `node run.mjs test-native-gpu` | Exit 0; builds and validates the current static artifact, then passes 55 checks and four native GPU captures. |
| `LOCAL_BROWSER_SOFTWARE_WEBGL=1 node scripts/atlas_presentation.mjs --require-native-gpu` | Expected exit 1; separate failed software receipt, with successful resource cleanup. The assignment is POSIX syntax; set the same environment variable explicitly in PowerShell. |
| `git diff --check` | Exit 0. |

Native evidence uses Node `26.5.0`, Playwright `1.62.0`, Chrome `155.0.8059.86`, and NVIDIA driver `32.0.16.1742`. The passing receipt and image hashes are under `.artifacts/proof/atlas-presentation/native-gpu/`; the negative receipt is under `native-gpu-rejected-software/`. These are declared subdirectories of the existing verifier-owned evidence root. Receipts bind the exact built source/artifact, and final captures are renewed after work-record changes. Public media and the release manifest remain unchanged. The batch qualifies this host's WebGL2 rendering, with no performance, WebGPU, physical-device, or release claim.

## Completed batch

- [x] Pull `origin/main` with `git pull --ff-only`: already up to date at `63666dc3783dfa600d92a4102a1d2008ad8907ae`. The starting checkout was clean; the completed changes below were subsequently published as `a33bbce`.
- [x] Fix scope-priority handling in the browser retrieval core. Valid `constructor`, `toString`, and `__proto__` scopes now receive their configured priority, or zero when absent, without inherited properties producing `NaN` scores. Normalization still rejects actual duplicate keys.
- [x] Reject non-object JSON scope-priority inputs with `ContractError`. Present values follow the frozen query schema's object requirement, including rejection of `null`; the Python function's optional `None` convenience is not a JSON-schema allowance.
- [x] Add five focused retrieval regressions and a Worker search/report regression. Before repair, the focused suite reproduced four failures; after repair, all five pass.
- [x] Document the Python 3.12 requirement for exhaustive adapter conformance in [Development](docs/DEVELOPMENT.md).

## Review and recheck coverage

At the start of the 2026-10-23 review, the checkout had no Summary Bank, repository AGENTS file, AI_PROVENANCE file, or previous TODO/review report. Context came from the manifests, READMEs, method/API contracts, implementation, consumers, tests, and recent commits; that review used direct reads. Later work uses the locally configured context bank. This is a bounded repository review, not a claim that every line or dependency was audited.

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

Both browser commands used `LOCAL_BROWSER_SOFTWARE_WEBGL=1`, Playwright `1.62.0`, and local Chrome `155.0.8059.86`. Receipts confirm Worker/browser/server cleanup, released ports, and Lab temporary-state removal. These checks preceded the guarded publication of `a33bbce`; no hosted checks ran.

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

No further repair or proof task remains in the completed 2026-10-23 batch. The selected 2026-10-24 native GPU batch is recorded above. Performance qualification, physical-device coverage, public-media replacement, and release acceptance remain separate scope. No graph-library change, frozen-contract rewrite, speculative optimization, or broader refactor is selected.
