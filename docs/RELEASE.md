# Release identity and boundaries

This source snapshot contains the RAG method, supported applications, public corpus, licenses, product scripts, and tests. Its setup, run, and test commands are self-contained. Application and graph releases remain separate: the browser application consumes an explicitly pinned, licensed graph archive.

`PUBLIC_MANIFEST.json` lists the exact public file table and its SHA-256 source fingerprint. The manifest excludes itself from that fingerprint to avoid a circular identity. `public-source.json` records known source ancestry only; it does not assert that a private Git history is safe to disclose.

The build identity resolver labels source as reviewed only when the complete current file table matches a manifest with `status: pass` and `manifest_complete: true`. Edits, added source files, absent receipts, and failed or incomplete reviews produce explicitly unreviewed working-source artifacts. Ordinary builds preserve the review receipt. Strict `readPublicSnapshot` verification and the independent allowlist/disclosure check remain required for a release.

The snapshot's `.gitattributes` uses `* -text` so a new Git import and subsequent clones preserve the exact reviewed bytes, including frozen fixtures. Git still detects text for ordinary diffs. Do not apply newline normalization to these fixtures or reuse an older fingerprint after changing source bytes. The private original history remains intact.

The frozen adapter-report protocols predate source snapshots and require a 40-character Git commit. Without a public Git checkout, their compatibility envelope uses the recorded base commit with `dirty:true`. That value is ancestry, not the revision of the sanitized snapshot. Fresh release acceptance and emitted static artifacts must bind `PUBLIC_MANIFEST.json`'s actual `source_fingerprint_sha256`; an older clean report cannot qualify new bytes.

## Included and omitted surfaces

- Included: both frozen contract sets and read-only predecessor metadata, Python reference/backend, React Lab, browser TypeScript core/Worker/application, bounded synthetic Lab collection, pinned Three.js/TSL documentation corpus, exact vendored graph dependency, notices, locked dependencies, and product tests.
- Omitted: `.git` and source history, maintainer tooling, operator state and credentials, prior retained artifacts and private proof receipts, historical removed applications, unreviewed media, and mutable/generated runtime directories.

No unfinished prototype is presented as a runnable public demo. The supported browser explorer and local Lab use the current application source. Their release acceptance requires fresh functional browser evidence against the actual candidate, with screenshot inspection and stated device/rendering limitations.

## Redistribution

First-party source is MIT licensed. Keep `LICENSE`, `THIRD_PARTY_NOTICES.md`, the graph archive's MIT text, and `corpora/threejs-docs/THREEJS-LICENSE.txt`. Static artifact staging also copies the complete first-party, graph, and Three.js runtime license texts into `LICENSES/`. The documentation pack carries its pinned upstream attribution; startup does not fetch it from the network.

Source-surface checks cover the selected current files, archives, and reviewed media. They are not a claim about excluded private history, credentials elsewhere on a machine, every transitive dependency advisory, physical mobile hardware, or all rendering drivers. Keep the original histories private unless a separate history-aware disclosure review justifies opening them.
