# Three.js documentation vault

This directory contains the normalized source corpus for the documentation explorer: 921 API, TSL, and manual documents selected from the exact upstream revision recorded in `manifest.json`. Application startup and offline tests do not fetch upstream content.

`vault/` contains ordinary Markdown. The same deterministic preparation command emits the same-origin browser pack and manifest under `modules/browser-rag-ts/demo/public/corpora/`. API Markdown is retained; TSL sections and selected manual lessons are converted without scripts, embeds, images, or page chrome.

To regenerate, provide an existing local checkout of the pinned Three.js revision:

```text
node scripts/prepare_threejs_docs.mjs --upstream <local-three-checkout>
node scripts/prepare_threejs_docs.mjs --upstream <local-three-checkout> --check
```

The command does not clone or download. Do not hand-edit generated vault files. An upstream revision change creates a new corpus identity and requires review.

`evaluation.json` defines expected relevance independently of live rankings, including exact lookup, closely named APIs, procedural retrieval, linked-source expansion, and an absent topic. Tests may consume it but must not rewrite it from observed search results.

`THREEJS-LICENSE.txt` preserves the complete upstream MIT terms. Document provenance retains the pinned upstream URL and source hash.
