# Third-party notices

RAG Method first-party source is MIT licensed; see [LICENSE](LICENSE).

| Redistributed material | Identity | License and attribution |
| --- | --- | --- |
| Force-graph dependency | `@ours/forcegraph-tsl` pinned archive and receipt under `modules/browser-rag-ts/vendor/` | MIT; archive includes complete `LICENSE`. |
| Three.js runtime | Locked `three` dependency in the browser module and local Lab | MIT; static browser artifact preserves complete runtime license. |
| Three.js/TSL documentation | Exact `mrdoob/three.js` revision and per-file source URLs in `corpora/threejs-docs/manifest.json` | MIT; complete notice in `corpora/threejs-docs/THREEJS-LICENSE.txt`. |

The pinned documentation corpus is redistributed as normalized Markdown/text and same-origin browser pack assets. Its manifest and document provenance retain the original upstream URLs and hashes. The RAG method and graph projections are first-party application code; upstream documentation ownership remains with its credited authors.

Installed backend/frontend dependencies retain their package-manager license metadata. The browser runtime bundle's shipped dependency notices are copied and hash-bound by `artifact:stage`.
