# Experimental single-chat memory

Open the [HTTPS preview](https://shoozes.github.io/rag-method-alpha/model-chat/?memory=1).
Use `?memory=0` or no memory parameter for basic chat; add `&graph=0` to memory
mode to omit the read-only event graph. Model loading is always explicit.

Older user passages are selected automatically when native context fills. This
is bounded, lexical, lossy selection, not general semantic summarization. Exact
UTF-16 spans and SHA-256 source hashes bind the selected quotes, including CRLF
and Unicode. The original transcript stays intact. No saved facts are created
automatically. Up to eight passages, 360 codepoints each and 2200 total are used;
scan bounds are 512 prior turns, 512 KiB and 2048 candidates. The recent whole-turn
tail is bounded to four turns / 1000 codepoints when it fits. The latest query
stays whole. A native prompt count with a 160-token reply reserve decides fit.

Save/Correct stores exact selected user words separately for keyword retrieval.
Forget removes a saved record's eligibility and excludes its source turns from
derived context. It preserves originals and independent repeats elsewhere in
the transcript. Historical links mean **Sources sent at the time**, not answer
truth, current eligibility or authenticated execution. Local storage is editable
and is separate from the model's OPFS cache. Clearing browser data removes it.

The graph observes actual local save/recall/compaction/dispatch events. It has no
permission, retrieval, storage or orchestration authority. There are no teams,
personas, background agents, training or cross-repository services in this demo.

The retained 230M experiment selected correct passages over two capacity
crossings. Its first reply recalled all requested fields; after correction it
returned Thursday but omitted codename/city. Previous unrelated-question
abstention and answer-format checks also failed. Check source-linked text when
model prose is unreliable. This preview makes no general accuracy, unlimited
memory or physical-iPhone support claim.

## Local setup and staging

Use Node 22.12+ and the main example's pinned runtime preparation. Reuse an
already prepared esbuild 0.21.5 module by setting
`BROWSER_MEMORY_ESBUILD_MODULE` to its module entry; this helper never installs
dependencies or builds the full explorer. Run:

```sh
node examples/browser-model-chat/memory/build-core.mjs
node examples/browser-model-chat/stage-static.mjs --memory-preview --output .artifacts/model-chat/memory-preview-site
```

The output is exactly 34 payload files plus its source-bound manifest. It carries
first-party/runtime MIT notices and the complete pinned LFM Open License 1.0.
Weights, transcripts, tests, proof and source history are excluded. The model's
distinct license terms remain applicable; no license is changed. Staging alone
grants no release approval. A source tree carrying `PRIVATE_LOCAL_ONLY` still
refuses default staging; the public source contains no private marker or history.

Serve the staged directory over HTTPS (loopback HTTP is suitable locally) with
real missing-file 404s, JavaScript MIME and WASM MIME. A local setup can also use
the example server with an explicit generated-core mount through its API. This
packet verifies a prepared-host and fresh-browser-profile journey; fresh OS/npm
installation and physical-device qualification remain separate.
