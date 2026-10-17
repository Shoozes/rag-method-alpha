# Experimental automatic chat memory

For the ordinary-chat prompt and fresh-start regression guards, see
[Model-chat pitfalls](../../../docs/dev/MODEL_CHAT_PITFALLS.md).

Open the [HTTPS preview](https://shoozes.github.io/rag-method-alpha/model-chat/?memory=1).
The delivery receipt identifies the exact source branch and revision verified
on Pages. A local repair candidate is not published merely because its checks
pass. Private development history, the private launch
wrapper and machine paths are excluded from that source and the static payload.
No memory parameter or `?memory=0` retains basic chat without memory stores.
Add `&graph=0` for searchable HTML controls. Model loading is always explicit.

### Ordinary chat and fresh starts

Memory augments ordinary conversation; an empty search is not an instruction to
answer only from evidence. Under-budget recent messages keep their original
roles and appear once in the request. All and Conversation filter changes gate
memory visibility and invalidate stale requests without discarding that recent
dialogue. Save, Pin, Forget and correction safety remain separate content-policy
changes. Inspect Context's full request to distinguish raw chat from cited memory.

Settings is available before loading a model. **Reset settings** restores Ambient
light and the All memory filter. It preserves chat, memories and downloaded
models; no runtime tuning is persisted by this example. **Clear chat & memory**
requires confirmation, stops pending work and resets this demo's conversation,
saved/Persona memory, derived summaries, indexes and memory exclusions. Reload
returns to the unloaded setup with an empty chat/Persona and the three labeled
public Space starter facts. Downloaded model cache and unrelated origin data stay.
A text-free reset marker prevents older tabs or queued saves from restoring the
cleared chat. Clear failures are explicit and retryable; they never claim a
durable reset when storage refuses the operation.

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

Drag the graph background or a node to orbit. Use two contacts to pan and pinch,
or the wheel to zoom, and use
**Fit** to recover the view. A tap or keyboard activation opens the real source;
dragging does not select it. Only the graph captures navigation gestures.
Details and the graph-disabled list retain native scrolling and selection;
page zoom is left unrestricted outside the graph. Reduced motion disables graph
animation. Conversation is sky blue, Persona pink and Global amber,
with scope labels and base colors retained during search/selection. The memory
view uses shaded scope-colored cores and restrained matching auras; other
renderer consumers keep their defaults. Colors do not
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

The latest successful compaction retains one **Conversation summary** node with
the existing exact extractive output, not a generated semantic summary or Persona
fact. **View summary** opens its body and links to the actual authored originals.
All and Conversation show it; Persona and Global filters hide it. Originals and
the protected recent exchange remain intact. The node records what that event
retained; it does not claim the whole conversation was kept or every later
request includes the same selection.

On a new committed output, brief blue light trails gather only its actual authored
source nodes toward this real summary node and finish with a soft pulse. At most
12 visible sources and 24 sparks animate for 1.32 seconds, using bounded Web
Animations and one expiry timer; no application frame loop is added. Reduced
motion shows a static target ring and completion text. Failed, cancelled and
no-reduction attempts create no success effect. Historical reload, repeated opens
and interrupted playback stay silent. This does not fix the pinned Three
renderer's separate visible idle-clock limitation.

One optional event-bound snapshot, at most 96 KiB within the existing 2 MB
workspace envelope, restores the exact output and cutoff after source, owner,
policy, quote/offset/hash and structured-lineage validation. Legacy events without
a retained body never invent a node. Save, Pin and Forget invalidate stale output;
scope-only filtering preserves it. Reload does not measure tokens or replay
effects. Browser storage binding is not authentication of historical execution.

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

Typing searches after a short pause; Enter searches immediately. A persistent
scope-colored ring and match count identify actual hits, including authored
messages protected from duplicate prompt retrieval. The count says **graph search
only**: searching does not submit a model request. Desktop hover or keyboard
focus previews content and scope; tap/select opens source words and provenance.
Native targets follow the visible sphere size and depth. Reduced motion keeps
the match ring and disables selection movement.

Context states whether recalled memory was included and shows exact submitted
system/memory text when retained. Prepared, cancelled and manual previews say
they were not sent; missing text stays unavailable. Last-used highlights refer only to evidence
actually dispatched with a reply; preparing or cancelling alone does not claim
use. Their request hash and source ownership must match; a Persona turn from
another chat cannot highlight a colliding local turn ID. Back returns to the graph.
Conversation citations keep exact references. Global and cross-chat Persona
excerpts expose their own source; they are not invented current-chat messages.
Historical links mean **Sources sent at the time**, not answer truth, current
eligibility or authenticated history. Source hashes establish internal binding,
not independent authentication of editable browser storage.

**Compact now** explicitly runs the existing bounded context selection and native
prompt-meter pipeline. A ready loaded model and eligible older history are
required; protected recent exchanges and original messages remain intact. The
button explains empty, short-history, loading, active-reply and scope gates.
Memory inspection remains available before loading a model. An unavailable
Compact now control can receive pointer/keyboard focus and explain why nothing
changed; it does not start a model or meter. Active operations remain blocked.
After memory rules change, the conservative policy-refresh gate requires a new
ordinary checked request before another manual compaction.
Eligibility means the action can check older context, not that a smaller prompt
is guaranteed. A short chat or unrelated latest message may select no older
excerpt, or a summary's provenance may cost more tokens than the originals.
These results say **Nothing changed** and **Context unchanged**, preserving the
current context and transcript. Measured before/after counts appear only when
both were actually checked. No success event, pocket or particles are invented.
Cancel stops an in-flight attempt. A success needs a real committed compaction
event, lower measured prompt count and final fit; it sends no reply request and
does not save facts or promote Persona memory. Its actual source nodes receive
the one-time cue described above, including under-budget manual reductions.
Failure/cancellation cannot apply a late result. A failed save after success is
reported as session-only compaction, rather than hiding the committed event.
The retained node is not a second retrieval record. Later requests reselect exact
excerpts from canonical originals for the current query; represented summary
sources are excluded from direct automatic recall to avoid duplicate injection.
Only an exactly matching summary body in an actual submitted request can receive
a summary-use cue. Inspect Context for what was really sent.

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
Set `BROWSER_MEMORY_ESBUILD_MODULE` to an already prepared esbuild 0.28.2 module,
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

## Experimental spatial Graph and Context

This presentation uses HAIO 1.5-wip as a visual reference: cosmic graphite/violet atmosphere, saturated shaded scope cores, restrained matching auras, stable real 3D positions and damped orbit. Existing blue/pink/gold scope meanings remain authoritative. Static atmosphere and demand-driven motion replace the donor's perpetual star/nebula loop; no decorative nodes are added.

The Expand/Collapse control fills the app viewport without the browser Fullscreen API; Chat returns to the conversation. Native taps and keyboard controls remain available, two contacts pan/pinch, and Fit restores framing. This experimental publication changes presentation and read-only request inspection; it does not grant new retrieval, storage or model permissions. Private development history and its local marker are excluded from public source.

Mirrorlight RAG is a read-only historical donor for visible source IDs, pocket labels and score-linked match emphasis. Its chat injection, memory assignment UI and automatic writing were future work; no legacy subsystem is imported here.

Search glows identify actual matches. A finite last-dispatch emphasis reads the existing authoritative automatic used-node set, updated only after successful Worker postMessage; it means “Sent in last model request,” never model use or a completed answer. Reload does not replay it. The current dispatch event omits automatic IDs and their request-hash association, so this remains session-only visual evidence; no durable per-request automatic provenance is invented.

The Graph tab remains the default. Context adapts Mirrorlight’s query/source-text/ID inspection pattern to the real modern request lifecycle: actual returned candidates (already core top-k/token filtered), final admitted sources, literal supplied scores, bounded verbatim leading system/memory messages and optionally full request messages. Prepared and submitted records are distinct, submitted records bind the actual accepted reply when available, and failed/stale/cancelled preparation cannot be promoted. Only the latest prepared and last submitted snapshots are retained in session memory (96 KiB each); reload clears them. Older reply contexts, hidden model reasoning, native chat-template expansion and KV state are not retained or represented. Unavailable/oversize fields are explicit, with no clipped text presented as exact.

Idle limitation: pinned Three 0.185.0 starts its internal node-frame clock even with a null user animation callback. Application motion and graph redraws settle, including under reduced motion, but zero idle RAF callbacks is not achieved while Graph is visible. The renderer is disposed while Context is shown, on document-hidden events, or when Memory is closed. Graph return recreates it and restores the camera for the same current node/scope identity; closing retains the existing Fit-on-reopen behavior. No private Three fields are modified. Callback activity and actual scene/GPU work must be reported separately; the strict visible zero-RAF criterion remains unmet. Actual hidden-state behavior, physical iOS and new native-inference qualification remain unproved. All three canonical TypeScript checks pass with cached 5.9.3, but unavailable vite/client declarations and unchanged skipLibCheck leave full installed dependency parity unproved. The delivery receipt identifies the exact source and live verification scope; deployment does not qualify a broader product release.
