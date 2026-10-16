# Experimental automatic chat memory

Open the [HTTPS preview](https://shoozes.github.io/rag-method-alpha/model-chat/?memory=1).
This approved experiment's public source is curated on
`workspace/model-loading-onboarding`; the delivery receipt identifies the exact
revision verified on Pages. Private development history, the private launch
wrapper and machine paths are excluded from that source and the static payload.
No memory parameter or `?memory=0` retains basic chat without memory stores.
Add `&graph=0` for searchable HTML controls. Model loading is always explicit.

Each accepted user or assistant message automatically becomes a source-linked
Conversation node. Canonical turn IDs preserve originals; these nodes are not
saved facts or generated summaries. Assistant text is labeled generated and
searchable for inspection, but excluded from quoted user evidence. Interrupted
replies never become accepted assistant nodes. The existing TSL renderer animates
new node IDs; reduced motion disables that animation.

Memory has one graph, one search and one scope filter:

- All memories reads Global plus the current persona and current conversation.
- Global holds three labeled Space starter facts with NASA links: public
  knowledge shared within this actor's workspace, separate from user facts.
- Persona holds only exact user excerpts explicitly remembered for this bot,
  with their original chat, turn, owner, offsets and source hashes.
- Conversation indexes only this actor/persona/chat's canonical messages.

The filter changes retrieval. Workspace identities bind access; selecting a
label cannot grant another persona or conversation's data. Another chat may
reuse the same persona's explicit excerpts with bounded original-user proof;
other actors/personas cannot. There is no persona picker, thread manager or
autonomous agent. TulpaWeaver's current-companion allow-list informed the scope
boundary; Conversation is this preview's adaptation, not an identical donor
pocket. No private donor code was copied.

Drag the graph background or a node to pan, pinch or wheel to zoom, and use
**Fit** to recover the view. A tap or keyboard activation opens the real source;
dragging does not select it. Only the graph captures navigation gestures.
Details and the graph-disabled list retain native scrolling and selection;
page zoom is left unrestricted outside the graph. Reduced motion disables graph
animation. Conversation is sky blue, Persona violet and Global amber,
with scope labels and base colors retained during search/selection. The memory
view opts into flat colored node bodies and a quiet selection halo to avoid the
metallic shader's white washout; other renderer consumers keep their defaults. Colors do not
change memory ownership, access or compaction policy.

### Prompt context indicator

The slim bar above the composer shows the **last checked prompt**, not transcript
size or live model-cache occupancy. It uses the existing send-time meter: 2,048
context tokens less the actual 160-token reply reservation leaves 1,888 prompt
tokens. System instructions, retrieval quotes and derived context are already
included in that measured prompt, so they are not subtracted again. The endpoint
is the prompt limit; compaction starts above it or when the runtime reports
overflow. No extra measurement or model call is made for the bar, typing, Memory
opening or reload. Unknown occupancy stays unmeasured; estimates and fixture
counts are labeled in the accessible detail. Focus or hover the bar for numbers.

During compaction the bar retains the before count; it has no percentage-complete
animation. A lower count appears only for a successfully finalized prompt.
Failure or cancellation cannot apply a late after-count. A later answer or policy
change makes the reading stale, and reload starts unmeasured rather than treating
historical events as current occupancy. Stop also cancels context preparation.
Compaction selects lossy prompt context while keeping the original transcript;
it does not provide unlimited memory or promote content into Persona.

When Memory next opens after a new successful compaction event, the actual visible
Conversation source nodes receive a brief blue emphasis and “Context compacted ·
originals kept.” This is a source cue: the current graph has no retained summary
node, so no merge destination is fabricated. Each event is consumed before
playback, including interruptions; historical events and repeated opens stay
silent. Reduced motion shows only the static text cue. Navigation and selection
retain their existing behavior.

Desktop Chrome touch-emulation checks cover pan, pinch, Fit, capture transfer,
cancellation, keyboard/source actions and the real list fallback. Native page
pinch remained unqualified even on a plain-page automation control; physical
touch selection and named iPhone/browser behavior still need device testing.

A later question uses the existing local keyword RAG core to select up to three
prior user/public-source excerpts, at most 360 codepoints each. The native prompt
meter and 160-token reply reserve decide fit; the latest question stays whole.
Hashes and UTF-16 offsets bind quoted words. Older-context compaction remains
bounded, lexical and lossy, not general semantic summarization or fact admission.
Quotes are data, not instructions or verified personal facts. Arbitrary natural
language corrections or commands are not parsed. Explicit Save/Edit/Forget and
marked-correction behavior remain; Persona excerpts own their source recall,
while originals remain inspectable in Conversation.

Search lights matching nodes. Last-used highlights refer only to evidence
actually dispatched with a reply; preparing or cancelling alone does not claim
use. Tap a node for its excerpt and provenance; Back returns to the graph.
Conversation citations keep exact references. Global and cross-chat Persona
excerpts expose their own source; they are not invented current-chat messages.
Historical links mean **Sources sent at the time**, not answer truth, current
eligibility or authenticated history. Source hashes establish internal binding,
not independent authentication of editable browser storage.

Forget excludes the selected indexed message and preserves the transcript.
Persona Forget and Global removal retain tombstones. All versions of manually
remembered sources stay protected from automatic recall/compaction resurrection.
Independent repeats in other turns can still be retrieved. Removed starter IDs
are not silently reseeded after a successful save and reload. Legacy v1 history
is adopted only by the original default workspace without inventing new events.

The view shows at most twelve actual nodes, prioritizing matches or last-used
IDs. Indexing refuses beyond 512 turns or 512 KiB rather than searching a partial
transcript. Persona memory admits at most 32 excerpts, 4,000 UTF-16 units each,
and 256 KiB including source proofs/history. Storage failures report session-only
changes; durability is not promised after a failed write. Detected shared-memory
changes from another workspace refuse stale operations until reload.
Browser memory storage is user editable and separate from the model's OPFS cache.
Removing browser data can remove retained chat and memory.

Current routing/UI checks use labeled provider and token-meter fixtures. They
prove deterministic scope, source, persistence and dispatch behavior, not new
native token counts, model accuracy or physical-iOS support. The retained 230M
experiment selected correct passages over two capacity crossings: its first
reply recalled all fields; after correction it returned Thursday but omitted
codename/city. Earlier unrelated-question abstention and answer-format checks
also failed. That historical run was not repeated for automatic indexing.
Selected evidence does not guarantee a correct answer. No semantic promotion,
training, paid inference, teams or worker orchestration is included.

## Sources and local setup

The starter module contains only three brief public astronomy facts and source
links: [Earth orbits the Sun](https://science.nasa.gov/earth/facts/),
[the Moon orbits Earth](https://science.nasa.gov/moon/facts/), and
[Mars has two moons, Phobos and Deimos](https://science.nasa.gov/mars/moons/).
No NASA images, logos or article passages are included. Application/runtime
licenses are unchanged; these citations do not turn starter knowledge into user
facts or establish NASA endorsement.

Use Node 22.12+ and the main example's [runtime preparation](../README.md#run-locally).
Set `BROWSER_MEMORY_ESBUILD_MODULE` to an already prepared esbuild 0.21.5 module,
and follow the [offline graph setup](../README.md#prepare-the-optional-tsl-graph-offline)
for the pinned graph/Three inputs. From this public repository root:

```sh
node examples/browser-model-chat/memory/build-core.mjs
node examples/browser-model-chat/memory/build-graph.mjs
node examples/browser-model-chat/stage-static.mjs --memory-preview --output .artifacts/model-chat/site
```

The bounded output and its source-bound manifest retain the application/runtime
MIT notices, full forcegraph-tsl/Three MIT texts and pinned LFM Open License 1.0.
Weights, transcripts, tests, proof, local launch scripts and private development
history are excluded. The model's separate license remains applicable. Staging
does not itself publish or qualify a broader product release; the default
private-marker guard remains intact.

Serve the staged directory over HTTPS, or use the existing public loopback API
with explicit prepared-core and graph mounts:

```powershell
node --input-type=module -e "import {startServer} from './examples/browser-model-chat/serve.mjs'; console.log((await startServer({port:5187,memoryCoreRoot:'.artifacts/memory',memoryGraphRoot:'.artifacts/memory'})).url+'?memory=1')"
```

Open the printed URL and stop the server with Ctrl+C. Runtime files use the
standard `.artifacts/model-chat/runtime` root unless its API option is supplied.
The server mounts only the named generated core and graph files, with ordinary
module MIME and real missing-file 404s. These commands reuse prepared inputs;
fresh-host installation, model/cache recovery and physical-device qualification
remain separate. No private local launcher or sibling-checkout path is required.
