RAG Method browser model chat static payload

Mount this directory under any HTTPS directory URL ending in /. Open index.html.
Serve .mjs and .js as application/javascript; .wasm as application/wasm;
.css as text/css; .html as text/html; .json as application/json.
Unknown files must return 404, never an HTML application fallback.
No repository checkout, Node runtime, model file, credentials, or build tools are required by the site.
Model loading requires a secure context. A local-file choice still verifies the pinned model bytes.
The main wllama 3.5.1 runtime requires WebAssembly Memory64; the pinned maintained compatibility runtime uses Memory32 and Asyncify.
Missing Memory64 or JSPI selects the compatibility runtime automatically; the model identity stays unchanged.
Both runtime profiles require the OPFS API for local File and remote loading.
Writable OPFS is required only for a new remote cache miss; an OPFS write failure does not itself block File or valid cached-byte loading.
JSPI absence alone is not a loading gate.
The model download, cache, and inference run only after an explicit browser action.
Open ?memory=1 for this one-chat memory preview; add &graph=0 to omit the optional read-only SVG event graph.
Older context is selected automatically as source-linked exact passages; no special markup is required.
Automatic passage selection is lossy extractive context, not general semantic summarization or verified fact admission.
Explicit Save stores selected exact user words separately for keyword retrieval; Forget does not erase the transcript.
Historical answer links describe Sources sent at the time, not answer truth, current record eligibility or authenticated execution.
Known 230M model limits include failed unrelated-question abstention and answer-format adherence.
After correction, a native test used Thursday instead of Tuesday but omitted the codename and city in a multi-field answer; answer completeness is not guaranteed.
The complete model license is included at LICENSES/lfm-open-license-1.0.txt; inspect its commercial eligibility and redistribution terms.
Read NOTICE.txt, LICENSES/rag-method.txt, runtime/LICENSE, and the pinned model license.
This package is a static preview, not full product-release or iOS qualification.
