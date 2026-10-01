# Pinned graph dependency

`graph-package.json` records the exact package version, archive byte count, SHA-256, MIT license, Three peer range, and source identity for `@ours/forcegraph-tsl`.

The checked-in archive makes the browser application reproducible without depending on an unpublished registry package. `package.json` and the lockfile reference that archive. `vendor:check` verifies the archive, lock integrity, and installed package file inventory/content; a different installed build fails admission.

A public-source snapshot receipt uses `browser-rag-ts-vendored-graph-v2` with `source.kind: source-snapshot` and its SHA-256 fingerprint. An optional `base_commit` is historical ancestry only. The archive hash identifies the exact consumed package bytes; it must be updated deliberately when package contents or public documentation change.

Keep the archive's complete MIT `LICENSE`. Applications inject their own compatible Three/TSL instance. Graph layout, math, camera, and rendering are separate from the RAG method and remain reusable independently.
