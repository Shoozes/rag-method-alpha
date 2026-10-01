import "./aurel-gold.css";
import "./styles.css";
import "./cinematic.css";
import { CinematicGraphPresentation } from "../src/presentation/cinematicGraph.js";
import { BrowserRagWorkerClient, WorkerRequestHandle } from "../src/worker/client.js";
import { MAX_BROWSER_DOCUMENTS, MAX_BROWSER_SOURCE_UTF8_BYTES } from "../src/worker/protocol.js";
import type { BrowserDocumentChunk, GetContextResult, GetSourceResult, InitializeResult, LoadDocumentsResult } from "../src/worker/protocol.js";
import { assertContextMatches, formatContextPacket } from "../src/application/contextPacket.js";
import { TracePlayback } from "../src/application/tracePlayback.js";
import { documentationPresets } from "../src/application/documentationPrompts.js";
import { BROWSER_RAG_TS_MODULE_VERSION } from "../src/moduleIdentity.js";
import { trimPythonUnicodeWhitespace } from "../src/core/shared/unicode.js";
import type { PositionedGraph, PositionedGraphNode } from "../src/application/layoutGraph.js";
import type { RagGraphView } from "../src/application/graphProjection.js";
import type { RagGraphRenderer } from "../src/application/graphRenderer.js";
import { resolveGraphInteraction } from "../src/application/graphSelection.js";
import { ApplicationOperationCoordinator } from "../src/application/operationCoordinator.js";
import type { ForegroundOperation } from "../src/application/operationCoordinator.js";
import { initializeOptionalResource } from "../src/application/optionalResource.js";
import { applyRagGraphCssPalette, graphFamilyColor } from "../src/application/graphPalette.js";
import { composeRagConstellations } from "../src/application/constellationLayout.js";
import { fetchVaultPack, readBoundedResponse, readVaultFiles, selectVaultFiles } from "../src/application/vaultSources.js";

const DOCUMENTATION_VAULT_NAME = "Three.js + TSL Documentation Vault";
const DOCUMENTATION_PACK_URL = new URL("../corpora/threejs-docs.pack.json", location.href);
const DOCUMENTATION_MANIFEST_URL = new URL("../corpora/threejs-docs.manifest.json", location.href);

type ReportKind = "indexing" | "retrieval" | "query";
type JsonObject = Record<string, unknown>;
type QueryPreset = {
  readonly id: string;
  readonly label: string;
  readonly query: string;
  readonly mode: string;
  readonly scopes: string;
  readonly topK: number;
  readonly fixtureVector?: string;
  readonly excludeScopes?: string;
  readonly expand?: boolean;
};

const contractPresets: readonly QueryPreset[] = [
  { id: "exact-release", label: "Exact phrase · release marker", query: "release canary is amber", mode: "exact_only", scopes: "global", topK: 3 },
  { id: "scoped-evidence", label: "Scoped evidence · workspace notes", query: "scope isolation persistence", mode: "keyword_only", scopes: "workspace:edge", topK: 3 },
  { id: "linked-source", label: "Linked sources · release checklist", query: "stable marker", mode: "exact_only", scopes: "global, workspace:edge", topK: 2, expand: true },
  { id: "private-exclusion", label: "Diagnostic · private-note exclusion", query: "canary", mode: "scoped_hybrid", scopes: "global, persona:private", excludeScopes: "persona:private", topK: 3 },
  { id: "semantic-threshold", label: "Diagnostic · semantic threshold", query: "unrelated semantic wording", mode: "semantic_only", scopes: "test:threshold", topK: 3, fixtureVector: "semantic-threshold" },
];

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("demo root is missing");
const app = root;
const launchParameters = new URLSearchParams(location.search);
const contractMode = launchParameters.get("corpus") === "contract";
const directDocumentationVault = launchParameters.get("vault") === "threejs";
let activePresets: readonly QueryPreset[] = contractMode ? contractPresets : documentationPresets;

document.documentElement.dataset.aurelTheme = "gold";
app.dataset.browserRagTs = BROWSER_RAG_TS_MODULE_VERSION;
app.innerHTML = `
  <main class="shell" data-presentation="atlas" data-motion="full" data-aurel-theme="gold" data-browser-rag-ts="${BROWSER_RAG_TS_MODULE_VERSION}">
    <section id="vault-welcome" class="vault-welcome" aria-labelledby="welcome-heading" ${contractMode ? "hidden" : ""}>
      <div class="welcome-inner">
        <p class="eyebrow">Choose a knowledge space</p>
        <h1 id="welcome-heading">Your knowledge, in motion.</h1>
        <p class="welcome-copy">Explore the demo, or open your own vault.</p>
        <div class="vault-choices">
          <button id="open-demo-vault" type="button" class="vault-choice primary"><strong>Explore demo vault</strong><span>API, TSL, and practical guides · <b id="demo-document-count">reading manifest…</b></span></button>
          <button id="open-local-vault" type="button" class="vault-choice"><strong>Open your vault</strong><span>Markdown and text. Processed locally in this tab.</span></button>
        </div>
        <p id="welcome-state" class="status" aria-live="polite">Preparing the local Worker…</p>
        <button id="retry-example" type="button" hidden>Retry example availability</button>
        <button id="cancel-welcome-import" type="button" hidden>Cancel loading</button>
        <a class="back-link" href="../">Back to RAG Method</a>
      </div>
    </section>
    <header class="hero">
      <div class="hero-title"><p class="eyebrow">RAG Method · ${BROWSER_RAG_TS_MODULE_VERSION}</p><h1>Knowledge Atlas</h1></div>
      <p class="hero-copy">Search the vault, follow the ranked path, and read the exact source behind each result.</p>
      <nav class="hero-links" aria-label="Project links"><button id="toggle-inspector" type="button" class="secondary" aria-controls="evidence-pane" aria-expanded="false">Evidence</button><a href="../#about">How it works</a><a href="../#implementation">Implementation</a></nav>
      <p id="worker-state" class="status" aria-live="polite">Opening the local Worker…</p>
    </header>
    <section class="workspace-panel" aria-labelledby="workspace-heading">
      <div class="stage-heading">
        <div><p class="eyebrow">Active vault</p><h2 id="workspace-heading"><span id="active-collection">Choose a vault to begin</span></h2></div>
        <div class="stage-actions">
          <button id="fit-graph" type="button" class="secondary">Overview</button><details class="motion-disclosure"><summary>Motion Studio</summary><div class="motion-menu"><label>Effects<select id="motion-style"><option value="full">Cinematic</option><option value="quiet">Quiet</option></select></label><button id="replay-build" type="button" class="secondary">Replay build</button><p>Replays the accepted graph. Motion does not measure retrieval speed. Reduced motion takes priority.</p></div></details>
          <label class="view-field">Graph <select id="graph-view"><option value="evidence">Evidence</option><option value="folders">Vault</option></select></label>
          <details class="collection-disclosure">
            <summary>Choose vault</summary>
            <div class="disclosure-body">
              <p>Open an Obsidian vault or choose up to ${MAX_BROWSER_DOCUMENTS.toLocaleString()} Markdown/text files (${Math.floor(MAX_BROWSER_SOURCE_UTF8_BYTES / 1024 / 1024)} MiB). Hidden configuration and application-state folders are excluded. Everything stays in this tab.</p>
              <label class="file-picker">Obsidian vault <input id="local-vault" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" webkitdirectory directory multiple /></label>
              <label class="file-picker compact-picker">Or individual notes <input id="local-files" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" multiple /></label>
              <div class="actions"><button id="load-local-files" type="button" class="secondary" disabled>Index selected vault</button><button id="restore-fixture" type="button" class="secondary" disabled>${contractMode ? "Restore test collection" : "Load documentation vault"}</button></div>
              <p id="document-state" class="muted" aria-live="polite">No vault is active yet.</p>
            </div>
          </details>
        </div>
      </div>
      <div class="mobile-view-switch" role="group" aria-label="Workspace view"><button id="show-evidence" type="button" class="secondary" aria-pressed="true">Evidence</button><button id="show-graph" type="button" class="secondary" aria-pressed="false">Graph</button></div>
      <div id="workspace-grid" class="workspace-grid" data-mobile-pane="graph">
        <section class="graph-pane" aria-labelledby="graph-heading">
          <h3 id="graph-heading" class="visually-hidden">Knowledge graph</h3>
          <div id="graph-surface" class="graph-surface" data-renderer="none">
            <canvas id="graph-tsl-canvas" class="graph-tsl-canvas" width="1000" height="520" aria-label="TSL knowledge graph"></canvas>
            <svg id="graph-canvas" class="graph-canvas" viewBox="0 0 1000 520" role="img" aria-labelledby="graph-heading graph-state"></svg>
            <div class="graph-legend" aria-label="Graph legend"><span data-kind="folder">Folder hubs</span><span data-kind="source">Source notes</span><span data-kind="chunk">Evidence chunks</span><span data-kind="family">Color = vault neighborhood</span><span data-kind="hit">Retrieved matches</span></div>
            <div class="graph-status"><p id="renderer-state" aria-live="polite">The graph renderer starts after a vault is chosen.</p><p id="graph-state" aria-live="polite">Waiting for the active collection.</p></div>
          </div>
        </section>
        <aside id="evidence-pane" class="evidence-pane" aria-labelledby="result-heading" hidden><button id="close-inspector" type="button" class="secondary inspector-close" aria-label="Close evidence">Close</button>
          <div class="evidence-heading"><div><p class="eyebrow">Bounded context packet</p><h3 id="result-heading">Evidence &amp; context</h3></div><span id="result-count" class="result-count">0 results</span></div>
          <section id="source-reader" class="source-reader" aria-labelledby="source-reader-heading" hidden>
            <div class="source-reader-heading"><div><p class="eyebrow">Source reader</p><h4 id="source-reader-heading" tabindex="-1">Selected source</h4><p id="source-breadcrumb" class="source-breadcrumb"></p></div><button id="close-source-reader" type="button" class="secondary" aria-label="Close source reader">Close</button></div>
            <div class="source-reader-actions"><a id="source-origin" href="#" target="_blank" rel="noreferrer" hidden>View pinned source</a><button id="copy-source" type="button" class="secondary">Copy source</button></div>
            <pre id="source-content" tabindex="0"></pre>
          </section>
          <details class="context-overview"><summary>Context overview</summary><div id="query-context" class="query-context empty">Run a trace to see the source-backed excerpts prepared for model context. No model is called in this demo.</div></details>
          <details id="context-packet" hidden><summary>Complete context · verbatim</summary><button id="copy-context" type="button" disabled>Copy context</button><pre id="context-content" tabindex="0"></pre></details>
          <p class="preview-label">Result previews · shortened for browsing</p>
          <ol id="result-list" class="evidence-list"><li class="empty">The evidence trail will appear here.</li></ol>
          <section class="selection-detail" aria-label="Selected graph detail"><p id="graph-detail" class="graph-detail">Select a graph node or evidence excerpt to inspect its relationship.</p></section>

          <details class="visible-records"><summary>Visible graph records</summary><ul id="graph-inspector-list" class="graph-inspector-list" aria-label="Visible graph evidence and sources"></ul></details>
          <details class="query-export"><summary>Query report</summary><div class="actions"><button id="copy-query-report" type="button" class="secondary" disabled>Copy report</button><button id="download-query-report" type="button" class="secondary" disabled>Download report</button></div><p id="export-state" class="muted" aria-live="polite">No current-query report is available.</p></details>
        </aside>
        <section class="command-panel" aria-labelledby="query-heading">
          <div id="suggested-field" class="suggested-field"><span class="field-label">Try asking</span><div id="suggested-questions" class="suggested-questions" aria-label="Suggested questions"></div></div>
          <label class="query-field"><span id="query-heading">Ask the vault</span><textarea id="query-text" rows="2"></textarea></label>
          <button id="run-query" class="retrieve-button" type="button"><span>Search</span><small>Watch the real ranked route</small></button>
          <div class="query-meta">
            <details class="retrieval-options">
              <summary>Retrieval settings <span id="options-summary">Keyword · top 6 · local</span></summary>
              <div class="query-grid">
                <label class="preset-field">Example route <select id="query-preset"></select></label>
                <label>Mode <select id="query-mode"><option value="exact_only">Exact only</option><option value="keyword_only">Keyword only</option><option value="semantic_only">Semantic fixture</option><option value="hybrid">Hybrid</option><option value="scoped_hybrid">Scoped hybrid</option></select></label>
                <label>Top K <input id="query-top-k" type="number" min="1" max="100" value="6" /></label>
                <label>Included scopes <input id="query-scopes" value="browser:local" /></label>
                <label>Excluded scopes <input id="query-exclude-scopes" value="" /></label>
              </div>
            </details>
            <button id="cancel-query" type="button" class="secondary cancel-button" hidden disabled>Cancel</button>
            <button id="skip-trace" type="button" class="secondary" hidden>Skip animation</button>
            <button id="replay-trace" type="button" class="secondary" disabled>Replay trace</button>
            <p id="query-state" class="muted" aria-live="polite">Preparing a local evidence trail…</p>
          </div>
        </section>
      </div>
    </section>
    <details class="panel advanced">
      <summary>Advanced runtime and proof tools</summary>
      <section aria-labelledby="runtime-heading">
        <h2 id="runtime-heading">Runtime</h2>
        <dl id="runtime-details" class="details"></dl>
        <div class="actions">
          <button id="run-contracts" type="button">Generate Worker reports</button>
          <button id="run-cancellation-probe" type="button" class="secondary">Verify cancellation</button>
          <button id="dispose-worker" type="button" class="secondary">Dispose Worker</button>
        </div>
        <p id="proof-state" class="muted">Worker reports have not been generated.</p>
      </section>
      <section aria-labelledby="export-heading">
        <h2 id="export-heading">Contract report export</h2>
        <p class="muted">These raw Worker reports support local cross-runtime proof.</p>
        <div class="actions">
          <button id="download-indexing-report" type="button" class="secondary" disabled>Download Worker indexing report</button>
          <button id="download-retrieval-report" type="button" class="secondary" disabled>Download Worker retrieval report</button>
        </div>
      </section>
      <section aria-labelledby="query-inspection-heading">
        <h2 id="query-inspection-heading">Query inspection</h2>
        <div id="query-diagnostics" class="details empty">No query diagnostics yet.</div>
      </section>
      <section aria-labelledby="diagnostic-results-heading">
        <h2 id="diagnostic-results-heading">Complete score diagnostics</h2>
        <p class="muted">Fixed-point component micro-units and canonical record identifiers for the current query.</p>
        <div class="table-wrap diagnostic-table"><table><thead><tr><th>Rank</th><th>Record</th><th>Source</th><th>Excerpt</th><th>Score</th><th>Exact</th><th>Keyword</th><th>Semantic</th><th>Scope</th><th>Provenance</th><th>Authority</th><th>Priority</th><th>Aspect</th><th>Reference</th><th>Origin</th></tr></thead><tbody id="diagnostic-result-rows"><tr><td colspan="15" class="empty">No results yet.</td></tr></tbody></table></div>
      </section>
    </details>
  </main>
`;
applyRagGraphCssPalette(app.querySelector<HTMLElement>(".shell")!);

function element<T extends Element>(selector: string): T {
  const value = app.querySelector<T>(selector);
  if (!value) throw new Error(`demo element is missing: ${selector}`);
  return value;
}

const workerState = element<HTMLElement>("#worker-state");
const vaultWelcome = element<HTMLElement>("#vault-welcome");
const welcomeState = element<HTMLElement>("#welcome-state");
const demoDocumentCount = element<HTMLElement>("#demo-document-count");
const openDemoVaultButton = element<HTMLButtonElement>("#open-demo-vault");
const openLocalVaultButton = element<HTMLButtonElement>("#open-local-vault");
const retryExampleButton = element<HTMLButtonElement>("#retry-example");
const cancelWelcomeImportButton = element<HTMLButtonElement>("#cancel-welcome-import");
const skipTraceButton = element<HTMLButtonElement>("#skip-trace");
const replayTraceButton = element<HTMLButtonElement>("#replay-trace");
const contextPacket = element<HTMLDetailsElement>("#context-packet");
const contextContent = element<HTMLElement>("#context-content");
const copyContextButton = element<HTMLButtonElement>("#copy-context");
const proofState = element<HTMLElement>("#proof-state");
const queryState = element<HTMLElement>("#query-state");
const exportState = element<HTMLElement>("#export-state");
const documentState = element<HTMLElement>("#document-state");
const runtimeDetails = element<HTMLDListElement>("#runtime-details");
const collectionDisclosure = element<HTMLDetailsElement>("details.collection-disclosure");
const retrievalOptions = element<HTMLDetailsElement>("details.retrieval-options");
const activeCollection = element<HTMLElement>("#active-collection");
const optionsSummary = element<HTMLElement>("#options-summary");
const localFilesInput = element<HTMLInputElement>("#local-files");
const localVaultInput = element<HTMLInputElement>("#local-vault");
const loadLocalFilesButton = element<HTMLButtonElement>("#load-local-files");
const restoreFixtureButton = element<HTMLButtonElement>("#restore-fixture");
const presetSelect = element<HTMLSelectElement>("#query-preset");
const suggestedField = element<HTMLElement>("#suggested-field");
const suggestedQuestions = element<HTMLElement>("#suggested-questions");
const modeSelect = element<HTMLSelectElement>("#query-mode");
const topKInput = element<HTMLInputElement>("#query-top-k");
const scopeInput = element<HTMLInputElement>("#query-scopes");
const excludeScopeInput = element<HTMLInputElement>("#query-exclude-scopes");
const queryInput = element<HTMLTextAreaElement>("#query-text");
const graphViewSelect = element<HTMLSelectElement>("#graph-view");
const fitGraphButton = element<HTMLButtonElement>("#fit-graph");
const graphState = element<HTMLElement>("#graph-state");
const rendererState = element<HTMLElement>("#renderer-state");
const graphSurface = element<HTMLElement>("#graph-surface");
const graphTslCanvas = element<HTMLCanvasElement>("#graph-tsl-canvas");
const graphCanvas = element<SVGSVGElement>("#graph-canvas");
const graphDetail = element<HTMLElement>("#graph-detail");
const sourceReader = element<HTMLElement>("#source-reader");
const sourceReaderHeading = element<HTMLElement>("#source-reader-heading");
const sourceBreadcrumb = element<HTMLElement>("#source-breadcrumb");
const sourceOrigin = element<HTMLAnchorElement>("#source-origin");
const sourceContent = element<HTMLElement>("#source-content");
const closeSourceReaderButton = element<HTMLButtonElement>("#close-source-reader");
const copySourceButton = element<HTMLButtonElement>("#copy-source");
const graphInspectorList = element<HTMLUListElement>("#graph-inspector-list");
const resultList = element<HTMLOListElement>("#result-list");
const resultCount = element<HTMLElement>("#result-count");
const diagnosticResultRows = element<HTMLTableSectionElement>("#diagnostic-result-rows");
const queryContext = element<HTMLElement>("#query-context");
const queryDiagnostics = element<HTMLElement>("#query-diagnostics");
const workspaceGrid = element<HTMLElement>("#workspace-grid");
const showEvidenceButton = element<HTMLButtonElement>("#show-evidence");
const showGraphButton = element<HTMLButtonElement>("#show-graph");
const runQueryButton = element<HTMLButtonElement>("#run-query");
const inspectorButton = element<HTMLButtonElement>("#toggle-inspector");
const evidencePane = element<HTMLElement>("#evidence-pane");
const closeInspectorButton = element<HTMLButtonElement>("#close-inspector");
const replayBuildButton = element<HTMLButtonElement>("#replay-build");
const motionStyle = element<HTMLSelectElement>("#motion-style");
if (!contractMode) graphViewSelect.value = "folders";
const cancelQueryButton = element<HTMLButtonElement>("#cancel-query");
const runContractsButton = element<HTMLButtonElement>("#run-contracts");
const cancellationButton = element<HTMLButtonElement>("#run-cancellation-probe");
const disposeButton = element<HTMLButtonElement>("#dispose-worker");
const copyQueryButton = element<HTMLButtonElement>("#copy-query-report");
const downloadQueryButton = element<HTMLButtonElement>("#download-query-report");
const downloadIndexingButton = element<HTMLButtonElement>("#download-indexing-report");
const downloadRetrievalButton = element<HTMLButtonElement>("#download-retrieval-report");

function populatePresets(presets: readonly QueryPreset[]): void {
  activePresets = presets;
  presetSelect.replaceChildren(...presets.map((preset) => {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.label;
    return option;
  }));
  const custom = document.createElement("option");
  custom.value = "custom";
  custom.textContent = "Custom query";
  presetSelect.append(custom);
  const suggestions = presets === documentationPresets ? presets : [];
  suggestedField.hidden = suggestions.length === 0;
  suggestedQuestions.replaceChildren(...suggestions.map((preset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "suggested-question";
    button.dataset.presetId = preset.id;
    button.textContent = `${preset.label.replace(/^Understand /u, "Reuse ").replace(/^Keep a canvas /u, "Keep canvas ")}?`;
    button.title = preset.query;
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
      applyPreset(preset);
      queryInput.focus();
    });
    return button;
  }));
}
populatePresets(activePresets);

let client: BrowserRagWorkerClient | null = null;
let activeSearch: WorkerRequestHandle | null = null;
let activeImport: WorkerRequestHandle<"load-documents"> | null = null;
let importController: AbortController | null = null;
let availabilityController: AbortController | null = null;
let currentContext: GetContextResult | null = null;
const playback = new TracePlayback();
let guidedStarted = false;
const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
let reports: Partial<Record<ReportKind, JsonObject>> = {};
let selectedPreset: QueryPreset | null = activePresets[0]!;
let runtimeSource: "fixture" | "local" | "documentation" | "none" = contractMode ? "fixture" : "none";
let selectedFiles: readonly File[] = [];
let currentSource: GetSourceResult | null = null;
let displayMetadata: ReadonlyMap<string, BrowserDocumentChunk> = new Map();
let activeGraph: PositionedGraph | null = null;
let activeGraphRequest: WorkerRequestHandle<"get-graph"> | null = null;
let corpusGeneration = 0;
let graphRequestGeneration = 0;
let queryRequestGeneration = 0;
let traceGeneration = 0;
let hitRecordIds: readonly string[] = [];
let selectedRecordId: string | null = null;
let selectedSourceId: string | null = null;
let selectedFolderPath: string | null = null;
let recordSourceIds: ReadonlyMap<string, string> = new Map();
let graphRenderer: RagGraphRenderer | null = null;
let rendererSessionGeneration = 0;
let startupLocked = true;
let foregroundOperation: ForegroundOperation | null = null;
let terminalShutdown: Promise<void> | null = null;
let rendererStarted = false;
const motionEnabled = () => !motionPreference.matches && motionStyle.value !== "quiet";
const presentation = new CinematicGraphPresentation({ surface:graphSurface, svg:graphCanvas, canvas:graphTslCanvas, renderer:()=>graphRenderer, motionEnabled, isDemo:()=>runtimeSource!=="local" });
function setInspector(open:boolean):void { const opening=open&&evidencePane.hidden;evidencePane.hidden=!open;inspectorButton.setAttribute("aria-expanded",String(open));if(open){collectionDisclosure.open=false;retrievalOptions.open=false;if(opening)closeInspectorButton.focus();} }

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid`);
  return value as JsonObject;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "—");
}

function integer(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function list(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function setBusy(busy: boolean): void {
  const workerReady = client?.isActive === true;
  runQueryButton.disabled = busy || !workerReady;
  runContractsButton.disabled = busy || !workerReady;
  cancellationButton.disabled = busy || !workerReady;
  disposeButton.disabled = busy || !workerReady;
  cancelQueryButton.disabled = !busy || (!activeSearch && !importController) || !workerReady;
  cancelQueryButton.hidden = !activeSearch && !importController;
  cancelWelcomeImportButton.hidden = !importController;
  cancelWelcomeImportButton.disabled = !workerReady;
  replayTraceButton.disabled = busy || !currentContext || !workerReady;
  localFilesInput.disabled = busy || !workerReady;
  localVaultInput.disabled = busy || !workerReady;
  loadLocalFilesButton.disabled = busy || !workerReady || selectedFiles.length === 0;
  restoreFixtureButton.disabled = busy || !workerReady || runtimeSource === (contractMode ? "fixture" : "documentation");
  graphViewSelect.disabled = busy || !workerReady;
  fitGraphButton.disabled = busy || !workerReady || !activeGraph;
  presetSelect.disabled = busy || !workerReady;
  for (const button of suggestedQuestions.querySelectorAll<HTMLButtonElement>("button")) button.disabled = busy || !workerReady;
  modeSelect.disabled = busy || !workerReady;
  topKInput.disabled = busy || !workerReady;
  scopeInput.disabled = busy || !workerReady;
  excludeScopeInput.disabled = busy || !workerReady;
  queryInput.disabled = busy || !workerReady;
  openDemoVaultButton.disabled = busy || !workerReady;
  openLocalVaultButton.disabled = busy || !workerReady;
}

function updateControls(): void {
  app.dataset.operationOwner = foregroundOperation ?? (startupLocked ? "startup" : "idle");
  setBusy(startupLocked || foregroundOperation !== null);
}

function updateOptionsSummary(): void {
  const mode = modeSelect.selectedOptions[0]?.textContent ?? modeSelect.value;
  const scopes = splitScopes(scopeInput.value).join(", ") || "all scopes";
  optionsSummary.textContent = `${mode} · top ${topKInput.value || "—"} · ${scopes}`;
}

function setMobilePane(pane: "evidence" | "graph"): void {
  workspaceGrid.dataset.mobilePane = pane;
  setInspector(pane === "evidence");
  showEvidenceButton.setAttribute("aria-pressed", String(pane === "evidence"));
  showGraphButton.setAttribute("aria-pressed", String(pane === "graph"));
  if (pane === "graph") {
    retrievalOptions.open = false;
    collectionDisclosure.open = false;
    graphRenderer?.refreshViewport();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function releaseFileSelection(): void {
  selectedFiles = [];
  localFilesInput.value = "";
  localVaultInput.value = "";
}

function releaseLocalDocuments(): void {
  releaseFileSelection();
  displayMetadata = new Map();
}

function activateRenderedNode(nodeId: string): void {
  const node = activeGraph?.nodes.find((candidate) => candidate.id === nodeId);
  if (node) selectGraphNode(node, true);
}

function useSvgFallback(message: string): void {
  try { graphRenderer?.dispose(); }
  catch { /* A terminal renderer may already own resource cleanup. */ }
  graphRenderer = null;
  graphSurface.dataset.renderer = "svg";
  rendererState.textContent = `${message} Accessible SVG and list fallback active.`;
  if (activeGraph) renderGraph(activeGraph);
}

async function initializeGraphRenderer(sessionGeneration: number): Promise<void> {
  if (launchParameters.get("renderer") === "svg") {
    if (sessionGeneration === rendererSessionGeneration) useSvgFallback("SVG renderer was explicitly requested.");
    return;
  }
  const backend = launchParameters.get("backend") === "webgl2" ? "webgl2" : "auto";
  await initializeOptionalResource<RagGraphRenderer>({
    load: async () => {
      const { createTslRagGraphRenderer } = await import("../src/application/graphRenderer.js");
      return () => createTslRagGraphRenderer({
        canvas: graphTslCanvas,
        backend,
        onNodeActivate: activateRenderedNode,
        onTerminalFailure: (message) => useSvgFallback(`TSL renderer stopped: ${message}`),
      });
    },
    isCurrent: () => sessionGeneration === rendererSessionGeneration && client?.isActive === true,
    accept: (renderer) => {
      graphRenderer = renderer;
      graphSurface.dataset.renderer = "tsl";
      rendererState.textContent = `TSL renderer ready using ${renderer.backend}. The SVG/list route remains available as the accessible fallback.`;
      if (activeGraph) {
        renderer.render(activeGraph);
        updateGraphSelection();
      }
    },
    reject: (error) => useSvgFallback(`TSL renderer unavailable: ${errorMessage(error)}`),
  });
}

function ensureGraphRenderer(): void {
  if (rendererStarted) return;
  rendererStarted = true;
  const rendererGeneration = ++rendererSessionGeneration;
  void initializeGraphRenderer(rendererGeneration);
}

function disposeGraphRenderer(): void {
  rendererSessionGeneration += 1;
  try { graphRenderer?.dispose(); }
  catch { /* Session cleanup remains terminal even after renderer failure. */ }
  graphRenderer = null;
  graphSurface.dataset.renderer = "svg";
}

function invalidateGraphWork(): void {
  graphRequestGeneration += 1;
  activeGraphRequest?.cancel();
  activeGraphRequest = null;
}

async function cancelAndSettleGraphWork(): Promise<void> {
  graphRequestGeneration += 1;
  const request = activeGraphRequest;
  if (!request) return;
  request.cancel();
  try { await request.promise; }
  catch { /* Cancellation and graph failure both release the foreground boundary. */ }
  if (activeGraphRequest === request) activeGraphRequest = null;
}

const operationCoordinator = new ApplicationOperationCoordinator({
  cancelGraph: cancelAndSettleGraphWork,
  onStateChange: (state) => {
    foregroundOperation = state.foreground;
    updateControls();
  },
});

function invalidateQueryWork(): void {
  queryRequestGeneration += 1;
  stopTrace();
  activeSearch?.cancel();
  activeSearch = null;
}

function clearQueryReportState(message: string): void {
  delete reports.query;
  copyQueryButton.disabled = true;
  downloadQueryButton.disabled = true;
  exportState.textContent = message;
}

function clearReportState(message = "No report export is available for this session."): void {
  reports = {};
  copyQueryButton.disabled = true;
  downloadQueryButton.disabled = true;
  downloadIndexingButton.disabled = true;
  downloadRetrievalButton.disabled = true;
  proofState.textContent = message;
  exportState.textContent = message;
}

function clearGraphState(message: string): void {
  presentation.clear();delete graphSurface.dataset.atlasReady;
  activeGraph = null;
  try { graphRenderer?.clear(); }
  catch (error) { useSvgFallback(`TSL renderer reset failed: ${errorMessage(error)}`); }
  graphCanvas.replaceChildren();
  graphInspectorList.replaceChildren();
  graphDetail.textContent = "No graph selection is active.";
  graphState.textContent = message;
}

function clearSessionDerivedState(message: string): void {
  importController?.abort();
  availabilityController?.abort();
  clearSourceReader();
  invalidateGraphWork();
  invalidateQueryWork();
  releaseLocalDocuments();
  hitRecordIds = [];
  selectedRecordId = null;
  selectedSourceId = null;
  selectedFolderPath = null;
  recordSourceIds = new Map();
  clearReportState();
  resetQueryView(message);
  clearGraphState(message);
  disposeGraphRenderer();
  rendererState.textContent = "Renderer disposed with the session.";
}

function shutdownTerminalSession(
  stateMessage: string,
  workerMessage: string,
  documentMessage: string,
): Promise<void> {
  if (terminalShutdown) return terminalShutdown;
  const ownedClient = client;
  client = null;
  startupLocked = true;
  terminalShutdown = (async () => {
    ownedClient?.terminate();
    clearSessionDerivedState(stateMessage);
    await operationCoordinator.dispose();
    workerState.textContent = workerMessage;
    documentState.textContent = documentMessage;
    updateControls();
  })();
  return terminalShutdown;
}

function presentFailure(target: HTMLElement, action: string, error: unknown): void {
  const message = errorMessage(error);
  target.textContent = `${action} failed: ${message}`;
  if (client?.isActive === true) return;
  void shutdownTerminalSession(
    "Session ended; reload to start a new Worker.",
    `Worker unavailable: ${message}. Reload the page to start a new Worker; session data was released.`,
    "Session ended. No local document-derived state remains in the application.",
  );
}

function runAction(action: () => Promise<void>, target: HTMLElement, label: string): void {
  void action().catch((error) => presentFailure(target, label, error));
}

function renderDetails(rows: readonly (readonly [string, string])[]): void {
  runtimeDetails.replaceChildren(...rows.flatMap(([name, value]) => {
    const term = document.createElement("dt");
    term.textContent = name;
    const detail = document.createElement("dd");
    detail.textContent = value;
    return [term, detail];
  }));
}

function renderRuntime(initialized: InitializeResult): void {
  const contracts = object(initialized.contracts, "initialized contracts");
  const retrieval = object(contracts.retrieval, "retrieval contract");
  const indexing = object(contracts.indexing, "indexing contract");
  renderDetails([
    ["Worker", "initialized"],
    ["Corpus", "deterministic fixture"],
    ["Record count", text(initialized.records)],
    ["Runtime snapshot", text(retrieval.runtime_snapshot_digest)],
    ["Indexing contract", `${text(indexing.id)} v${text(indexing.version)}`],
    ["Retrieval contract", `${text(retrieval.id)} v${text(retrieval.version)}`],
  ]);
  activeCollection.textContent = `Sample collection · ${initialized.records.toLocaleString()} records`;
}

function renderDocumentRuntime(result: LoadDocumentsResult, source: "local" | "documentation"): void {
  renderDetails([
    ["Worker", "initialized"],
    ["Corpus", source === "documentation" ? DOCUMENTATION_VAULT_NAME : "local browser documents"],
    ["Documents", result.documents.toLocaleString()],
    ["Record count", result.records.toLocaleString()],
    ["Source bytes", result.source_utf8_bytes.toLocaleString()],
    ["Contracts", "rag-indexing-v1 + rag-behavior-v2"],
  ]);
  activeCollection.textContent = source === "documentation"
    ? `${DOCUMENTATION_VAULT_NAME} · ${result.documents.toLocaleString()} documents · ${result.records.toLocaleString()} excerpts`
    : `Your vault · ${result.documents.toLocaleString()} note${result.documents === 1 ? "" : "s"} · ${result.records.toLocaleString()} excerpts`;
}

function acceptFixtureRuntime(initialized: InitializeResult, resultMessage: string): void {
  clearSourceReader();
  corpusGeneration += 1;
  invalidateGraphWork();
  invalidateQueryWork();
  runtimeSource = "fixture";
  releaseFileSelection();
  displayMetadata = new Map(initialized.chunks.map((chunk) => [chunk.id, chunk]));
  hitRecordIds = [];
  selectedRecordId = null;
  selectedSourceId = null;
  selectedFolderPath = null;
  recordSourceIds = new Map(initialized.chunks.map((chunk) => [chunk.id, chunk.source_id]));
  clearReportState("Worker reports have not been generated for the active corpus.");
  clearGraphState("Building the fixture graph…");
  renderRuntime(initialized);
  collectionDisclosure.open = false;
  populatePresets(contractPresets);
  applyPreset(contractPresets[0]!);
  resetQueryView(resultMessage);
}

function acceptDocumentRuntime(result: LoadDocumentsResult, source: "local" | "documentation", resultMessage: string): void {
  clearSourceReader();
  corpusGeneration += 1;
  invalidateGraphWork();
  invalidateQueryWork();
  runtimeSource = source;
  releaseFileSelection();
  displayMetadata = new Map(result.chunks.map((chunk) => [chunk.id, chunk]));
  recordSourceIds = new Map(result.chunks.map((chunk) => [chunk.id, chunk.source_id]));
  hitRecordIds = [];
  selectedRecordId = null;
  selectedSourceId = null;
  selectedFolderPath = null;
  graphViewSelect.value = "folders";
  clearReportState(source === "documentation" ? "Proof exports are available from Advanced tools." : "Worker reports have not been generated for the active local corpus.");
  clearGraphState(source === "documentation" ? "Mapping the documentation vault…" : "Building your local evidence graph…");
  renderDocumentRuntime(result, source);
  collectionDisclosure.open = false;
  if (source === "documentation") {
    populatePresets(documentationPresets);
    applyPreset(documentationPresets[0]!);
  } else {
    modeSelect.value = "keyword_only";
    topKInput.value = "6";
    scopeInput.value = "browser:local";
    excludeScopeInput.value = "";
    queryInput.value = "";
    selectedPreset = null;
    populatePresets([]);
    presetSelect.value = "custom";
    updateOptionsSummary();
  }
  resetQueryView(resultMessage);
}

function splitScopes(value: string): readonly string[] {
  return value.split(",").map((entry) => trimPythonUnicodeWhitespace(entry)).filter(Boolean);
}

function applyPreset(preset: QueryPreset): void {
  stopTrace();
  selectedPreset = preset;
  presetSelect.value = preset.id;
  queryInput.value = preset.query;
  modeSelect.value = preset.mode;
  topKInput.value = String(preset.topK);
  scopeInput.value = preset.scopes;
  excludeScopeInput.value = preset.excludeScopes ?? "";
  updateOptionsSummary();
  updateSuggestedSelection();
}

function updateSuggestedSelection(): void {
  for (const button of suggestedQuestions.querySelectorAll<HTMLButtonElement>("button[data-preset-id]")) {
    button.setAttribute("aria-pressed", String(button.dataset.presetId === selectedPreset?.id));
  }
}

function markCustomPreset(): void {
  stopTrace();
  if (selectedPreset
    && selectedPreset.query === queryInput.value
    && selectedPreset.mode === modeSelect.value
    && selectedPreset.topK === Number(topKInput.value)
    && selectedPreset.scopes === scopeInput.value
    && (selectedPreset.excludeScopes ?? "") === excludeScopeInput.value) return;
  selectedPreset = null;
  presetSelect.value = "custom";
  updateSuggestedSelection();
}

function formatRetrievalScore(scoreMicro: number): string {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(scoreMicro / 1_000_000);
}

function renderEmptyDiagnostic(message: string): void {
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 15;
  cell.className = "empty";
  cell.textContent = message;
  row.append(cell);
  diagnosticResultRows.replaceChildren(row);
}

function renderObservation(observation: JsonObject): void {
  const scores = Array.isArray(observation.scores) ? observation.scores : [];
  const orderedIds = list(observation.ordered_ids);
  const contextIds = new Set(list(observation.context_selected_ids));
  resultList.replaceChildren();
  diagnosticResultRows.replaceChildren();
  if (!scores.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No evidence matched this retrieval.";
    resultList.append(empty);
    renderEmptyDiagnostic("No records matched this query.");
  }
  resultCount.textContent = `${scores.length} result${scores.length === 1 ? "" : "s"}`;
  hitRecordIds = orderedIds;
  updateGraphSelection();
  for (const [index, rawScore] of scores.entries()) {
    const score = object(rawScore, "score");
    const components = object(score.components, "score components");
    const recordId = text(score.id);
    const detail = displayMetadata.get(recordId);
    const excerpt = detail?.excerpt;
    const evidenceItem = document.createElement("li");
    evidenceItem.className = "evidence-card";
    const evidenceButton = document.createElement("button");
    evidenceButton.type = "button";
    evidenceButton.className = "evidence-select";
    evidenceButton.dataset.recordId = recordId;
    evidenceButton.setAttribute("aria-pressed", "false");
    evidenceButton.setAttribute("aria-label", `Select evidence ${index + 1}: ${detail?.path ?? "source"}`);
    const rank = document.createElement("span");
    rank.className = "evidence-rank";
    rank.textContent = String(index + 1).padStart(2, "0");
    const source = document.createElement("strong");
    source.className = "evidence-source";
    source.textContent = detail?.path ?? "Fixture source";
    const excerptNode = document.createElement("span");
    excerptNode.className = "evidence-excerpt";
    excerptNode.textContent = excerpt || "No excerpt is available.";
    const metadata = document.createElement("span");
    metadata.className = "evidence-metadata";
    const scoreLabel = document.createElement("span");
    scoreLabel.textContent = `Retrieval score ${formatRetrievalScore(integer(score.score_micro))}`;
    const contextLabel = document.createElement("span");
    contextLabel.className = contextIds.has(recordId) ? "context-included" : "context-candidate";
    contextLabel.textContent = contextIds.has(recordId) ? "Included in context" : "Candidate";
    metadata.append(scoreLabel, contextLabel);
    evidenceButton.append(rank, source, excerptNode, metadata);
    evidenceButton.addEventListener("click", () => selectRecord(recordId));
    evidenceItem.append(evidenceButton);
    resultList.append(evidenceItem);
    const diagnosticValues = [
      String(index + 1), recordId, detail?.path ?? recordId, excerpt || "—",
      String(integer(score.score_micro)), String(integer(components.exact_micro)),
      String(integer(components.keyword_micro)), String(integer(components.semantic_micro)), String(integer(components.scope_micro)),
      String(integer(components.provenance_micro)), String(integer(components.authority_micro)), String(integer(components.priority_micro)),
      String(integer(components.aspect_coverage_micro)), String(integer(components.cross_reference_micro)), text(score.cross_reference_from_id),
    ];
    const row = document.createElement("tr");
    row.dataset.recordId = recordId;
    for (const value of diagnosticValues) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    diagnosticResultRows.append(row);
  }
  updateGraphSelection();
  queryContext.replaceChildren();
  queryContext.classList.remove("empty");
  const contextCount = contextIds.size;
  const summary = document.createElement("p");
  summary.className = "context-summary";
  summary.textContent = `${contextCount} excerpt${contextCount === 1 ? "" : "s"} included · ${integer(observation.context_tokens).toLocaleString()} estimated tokens${observation.truncated === true ? " · bounded selection" : ""}`;
  queryContext.append(summary);
  const contextExplanation = document.createElement("p");
  contextExplanation.className = "context-explanation";
  contextExplanation.textContent = "Open Complete context to read or copy every selected chunk in order. Cards below are shortened previews. The estimate is not a model-tokenizer count and excludes packet labels. No model is called.";
  queryContext.append(contextExplanation);
  const fallback = text(observation.semantic_fallback_reason);
  const errors = list(observation.errors);
  if (fallback !== "none" && fallback !== "—") {
    const notice = document.createElement("p");
    notice.className = "context-notice";
    notice.textContent = `Semantic fallback: ${fallback}`;
    queryContext.append(notice);
  }
  if (errors.length) {
    const notice = document.createElement("p");
    notice.className = "context-notice";
    notice.textContent = `Retrieval note: ${errors.join("; ")}`;
    queryContext.append(notice);
  }
  queryDiagnostics.replaceChildren();
  queryDiagnostics.classList.remove("empty");
  const diagnosticRows: Array<[string, string]> = [
    ["Collection", runtimeSource === "local" ? "local browser documents" : runtimeSource === "documentation" ? DOCUMENTATION_VAULT_NAME : "sample fixture"],
    ["Context-selected IDs", [...contextIds].join(", ") || "none"],
    ["Context tokens", String(integer(observation.context_tokens))],
    ["Truncated", String(observation.truncated === true)],
    ["Semantic state", text(observation.semantic_state)],
    ["Fallback", fallback],
    ["Errors", errors.join("; ") || "none"],
    ["Ordered IDs", orderedIds.join(", ") || "none"],
  ];
  for (const [label, value] of diagnosticRows) {
    const term = document.createElement("dt");
    term.textContent = label;
    const detail = document.createElement("dd");
    detail.textContent = value;
    queryDiagnostics.append(term, detail);
  }
}

function resetQueryView(message: string): void {
  currentContext = null;
  contextContent.textContent = "";
  contextPacket.hidden = true;
  copyContextButton.disabled = true;
  replayTraceButton.disabled = true;
  clearSourceReader();
  const item = document.createElement("li");
  item.className = "empty";
  item.textContent = message;
  resultList.replaceChildren(item);
  renderEmptyDiagnostic(message);
  resultCount.textContent = "0 results";
  queryContext.replaceChildren();
  queryContext.classList.add("empty");
  queryContext.textContent = "Run a trace to see the source-backed excerpts prepared for model context. No model is called in this demo.";
  queryDiagnostics.replaceChildren();
  queryDiagnostics.classList.add("empty");
  queryDiagnostics.textContent = "No query diagnostics yet.";
  clearQueryReportState("No current-query report is available.");
  hitRecordIds = [];
  selectedRecordId = null;
  selectedSourceId = null;
  selectedFolderPath = null;
  updateGraphSelection();
}

const SVG_NS = "http://www.w3.org/2000/svg";

function updateGraphSelection(): void {
  const hits = new Set(hitRecordIds);
  const interaction = resolveGraphInteraction(
    activeGraph?.nodes ?? [],
    { selectedRecordId, selectedSourceId, selectedFolderPath },
    hitRecordIds,
    recordSourceIds,
  );
  const renderedHits = new Set(interaction.hitNodeIds);
  for (const node of graphCanvas.querySelectorAll<SVGCircleElement>("[data-graph-node-id]")) {
    node.dataset.hit = renderedHits.has(node.dataset.graphNodeId ?? "") ? "true" : "false";
    node.dataset.selected = node.dataset.graphNodeId === interaction.selectedNodeId ? "true" : "false";
  }
  for (const link of graphCanvas.querySelectorAll<SVGLineElement>("line[data-source-node-id]")) {
    link.dataset.hit = renderedHits.has(link.dataset.sourceNodeId ?? "") && renderedHits.has(link.dataset.targetNodeId ?? "") ? "true" : "false";
  }
  for (const button of resultList.querySelectorAll<HTMLButtonElement>("button[data-record-id]")) {
    button.dataset.hit = hits.has(button.dataset.recordId ?? "") ? "true" : "false";
    button.dataset.selected = button.dataset.recordId === selectedRecordId ? "true" : "false";
    button.setAttribute("aria-pressed", button.dataset.selected);
  }
  for (const row of diagnosticResultRows.querySelectorAll<HTMLElement>("tr[data-record-id]")) {
    row.dataset.hit = hits.has(row.dataset.recordId ?? "") ? "true" : "false";
    row.dataset.selected = row.dataset.recordId === selectedRecordId ? "true" : "false";
  }
  for (const button of graphInspectorList.querySelectorAll<HTMLButtonElement>("button[data-graph-node-id]")) {
    button.dataset.hit = renderedHits.has(button.dataset.graphNodeId ?? "") ? "true" : "false";
    button.setAttribute("aria-pressed", String(button.dataset.graphNodeId === interaction.selectedNodeId));
  }
  presentation.setSelection(interaction.selectedNodeId, interaction.hitNodeIds);
  try { graphRenderer?.setInteractionState(interaction.selectedNodeId, interaction.hitNodeIds); }
  catch (error) { useSvgFallback(`TSL selection failed: ${errorMessage(error)}`); }
}

function describeGraphNode(node: PositionedGraphNode): void {
  const location = node.path || "Collection root";
  graphDetail.textContent = `${node.label} · ${node.kind} · ${location}`;
}

let sourceReadGeneration = 0;

function clearSourceReader(): void {
  sourceReadGeneration += 1;
  currentSource = null;
  sourceReader.hidden = true;
  copySourceButton.disabled = true;
  sourceOrigin.hidden = true;
  sourceOrigin.removeAttribute("href");
  sourceContent.textContent = "";
  sourceBreadcrumb.textContent = "";
}

async function readSelectedSource(recordId: string | null, sourceId: string | null): Promise<void> {
  if (!client || runtimeSource === "fixture" || runtimeSource === "none" || (!recordId && !sourceId)) return;
  clearSourceReader();
  const generation = sourceReadGeneration;
  const acceptedCorpus = corpusGeneration;
  const isCurrent = () => generation === sourceReadGeneration && acceptedCorpus === corpusGeneration && client?.isActive;
  sourceReader.hidden = false;
  sourceReaderHeading.textContent = "Loading source…";
  sourceBreadcrumb.textContent = "Reading from the active local Worker.";
  sourceContent.textContent = "";
  try {
    const result = await client.request("get-source", recordId ? { record_id: recordId } : { source_id: sourceId });
    if (!isCurrent()) return;
    currentSource = result;
    copySourceButton.disabled = false;
    sourceReaderHeading.textContent = result.title;
    sourceBreadcrumb.textContent = `${result.path}${result.heading ? ` · ${result.heading}` : ""}`;
    sourceContent.textContent = result.content;
    sourceOrigin.hidden = !result.source_url;
    if (result.source_url) sourceOrigin.href = result.source_url;
    sourceReaderHeading.focus({ preventScroll: true });
    evidencePane.scrollTop = 0;
  } catch (error) {
    if (!isCurrent()) return;
    sourceReaderHeading.textContent = "Source unavailable";
    sourceBreadcrumb.textContent = errorMessage(error);
  }
}

function queueSourceRead(recordId: string | null, sourceId: string | null): void {
  void readSelectedSource(recordId, sourceId);
}

function selectRecord(recordId: string): void {
  stopTrace();
  selectedRecordId = recordId;
  selectedSourceId = recordSourceIds.get(recordId) ?? null;
  selectedFolderPath = null;
  const node = activeGraph?.nodes.find((candidate) => candidate.record_id === recordId);
  if (node && activeGraph) {
    renderGraphInspector(activeGraph);
    describeGraphNode(node);
  }
  else {
    graphDetail.textContent = `Selected record ${recordId}; rebuilding the bounded graph window to reveal it.`;
    runAction(refreshGraph, graphState, "Graph selection");
  }
  updateGraphSelection();
  queueSourceRead(recordId, selectedSourceId);
}

function selectGraphNode(node: PositionedGraphNode, focusResult = true): void {
  setInspector(true);
  stopTrace();
  selectedRecordId = node.record_id;
  selectedSourceId = node.source_id;
  selectedFolderPath = node.kind === "folder" ? node.path : null;
  describeGraphNode(node);
  if (activeGraph) renderGraphInspector(activeGraph);
  updateGraphSelection();
  if (node.kind === "source" || node.kind === "chunk") queueSourceRead(node.record_id, node.source_id);
  else clearSourceReader();
  if (!focusResult || !node.record_id) return;
  const evidenceButton = resultList.querySelector<HTMLButtonElement>(`button[data-record-id="${CSS.escape(node.record_id)}"]`);
  evidenceButton?.scrollIntoView({ block: "nearest" });
}

function renderGraphInspector(graph: PositionedGraph): void {
  const focusedNodeId = document.activeElement instanceof HTMLButtonElement && graphInspectorList.contains(document.activeElement)
    ? document.activeElement.dataset.graphNodeId ?? null
    : null;
  const fragment = document.createDocumentFragment();
  const nodesByRecordId = new Map(graph.nodes.flatMap((node) => node.record_id ? [[node.record_id, node] as const] : []));
  const priorityRecordIds = [...new Set([...(selectedRecordId ? [selectedRecordId] : []), ...hitRecordIds])];
  const seen = new Set<string>();
  const inspectorNodes: PositionedGraphNode[] = [];
  for (const node of [...priorityRecordIds.map((recordId) => nodesByRecordId.get(recordId)), ...graph.nodes]) {
    if (!node || seen.has(node.id)) continue;
    seen.add(node.id);
    inspectorNodes.push(node);
    if (inspectorNodes.length === 100) break;
  }
  for (const node of inspectorNodes) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "graph-inspector-item";
    button.dataset.graphNodeId = node.id;
    if (node.record_id) button.dataset.recordId = node.record_id;
    if (node.source_id) button.dataset.sourceId = node.source_id;
    if (node.kind === "folder") button.dataset.folderPath = node.path;
    button.textContent = `${node.kind}: ${node.label}`;
    button.setAttribute("aria-label", `Select ${node.kind} ${node.label}`);
    button.addEventListener("click", () => selectGraphNode(node, true));
    item.append(button);
    fragment.append(item);
  }
  graphInspectorList.replaceChildren(fragment);
  if (focusedNodeId) graphInspectorList.querySelector<HTMLButtonElement>(`button[data-graph-node-id="${CSS.escape(focusedNodeId)}"]`)?.focus();
}

function renderGraph(graph: PositionedGraph): void {
  graphRenderer?.setMotionEnabled(motionEnabled());
  const firstPresentation = graphSurface.dataset.atlasReady !== "true";
  try { graphRenderer?.render(graph); }
  catch (error) { useSvgFallback(`TSL rendering failed: ${errorMessage(error)}`); }
  const positions = new Map(graph.nodes.map((node) => [node.id, node]));
  const xs = graph.nodes.map((node) => node.x);
  const ys = graph.nodes.map((node) => node.y);
  const minX = Math.min(...xs, 0);
  const maxX = Math.max(...xs, 1);
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys, 1);
  const point = (id: string): readonly [number, number] => {
    const position = positions.get(id) ?? { x: 0, y: 0 };
    return [40 + ((position.x - minX) / Math.max(1, maxX - minX)) * 920, 40 + ((position.y - minY) / Math.max(1, maxY - minY)) * 440];
  };
  const fragment = document.createDocumentFragment();
  for (const link of graph.links) {
    const [x1, y1] = point(link.source);
    const [x2, y2] = point(link.target);
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(x1)); line.setAttribute("y1", String(y1)); line.setAttribute("x2", String(x2)); line.setAttribute("y2", String(y2));
    line.dataset.kind = link.kind;
    line.dataset.sourceNodeId = link.source;
    line.dataset.targetNodeId = link.target;
    fragment.append(line);
  }
  for (const node of graph.nodes) {
    const [cx, cy] = point(node.id);
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", String(cx)); circle.setAttribute("cy", String(cy)); circle.setAttribute("r", node.kind === "chunk" ? "1.9" : node.kind === "source" ? "3.8" : "6.5");
    circle.setAttribute("tabindex", "0"); circle.setAttribute("role", "button"); circle.setAttribute("aria-label", `${node.kind}: ${node.label}`);
    circle.dataset.graphNodeId = node.id; circle.dataset.kind = node.kind;
    circle.style.setProperty("--node-color", graphFamilyColor(node.path));
    circle.dataset.layoutX = String(node.x); circle.dataset.layoutY = String(node.y);
    if (node.record_id) circle.dataset.recordId = node.record_id;
    if (node.source_id) circle.dataset.sourceId = node.source_id;
    if (node.kind === "folder") circle.dataset.folderPath = node.path;
    const inspect = () => selectGraphNode(node, true);
    circle.addEventListener("click", inspect);
    circle.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); inspect(); } });
    const title = document.createElementNS(SVG_NS, "title"); title.textContent = `${node.label} — ${node.path || "Collection root"}`; circle.append(title);
    fragment.append(circle);
  }
  graphCanvas.replaceChildren(fragment);
  presentation.setGraph(graph);
  graphSurface.dataset.atlasReady = "true";
  replayBuildButton.disabled=false;
  if (firstPresentation) presentation.replayBuild();
  renderGraphInspector(graph);
  updateGraphSelection();
  const clipped = graph.clipped ? ` Showing ${graph.nodes.length} of ${graph.total_nodes} nodes and ${graph.links.length} of ${graph.total_links} links; ${graph.omitted_nodes} node(s) and ${graph.omitted_links} link(s) omitted.` : "";
  graphState.textContent = `${graph.view === "evidence" ? "Evidence" : "Folder"} graph ready: ${graph.nodes.length} visible nodes, ${graph.links.length} visible links.${clipped} Worker layout ${graph.layout_steps} steps in ${graph.layout_ms.toFixed(1)} ms.`;
}

async function performGraphRefresh(): Promise<void> {
  if (!client) throw new Error("Worker is unavailable");
  graphState.textContent = "Building the application graph projection…";
  const view = graphViewSelect.value as RagGraphView;
  const requestGeneration = ++graphRequestGeneration;
  const acceptedCorpus = corpusGeneration;
  const preferredRecordIds = [...new Set([...(selectedRecordId ? [selectedRecordId] : []), ...hitRecordIds])];
  const request = client.requestHandle("get-graph", { view, preferred_record_ids: preferredRecordIds, request_generation: requestGeneration });
  activeGraphRequest = request;
  let graph: PositionedGraph;
  try {
    graph = await request.promise;
  } catch (error) {
    const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
    if (code === "cancelled" || requestGeneration !== graphRequestGeneration || acceptedCorpus !== corpusGeneration) return;
    graphState.textContent = `Graph unavailable: ${errorMessage(error)} Retrieval remains available for the accepted corpus.`;
    return;
  } finally {
    if (activeGraphRequest === request) activeGraphRequest = null;
  }
  if (requestGeneration !== graphRequestGeneration || graph.request_generation !== requestGeneration || acceptedCorpus !== corpusGeneration || graph.view !== graphViewSelect.value) return;
  const composedGraph = composeRagConstellations(graph);
  activeGraph = composedGraph;
  recordSourceIds = new Map([...recordSourceIds, ...composedGraph.nodes.flatMap((node) => node.record_id && node.source_id ? [[node.record_id, node.source_id] as const] : [])]);
  if (selectedRecordId !== null) selectedSourceId = recordSourceIds.get(selectedRecordId) ?? selectedSourceId;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  if (requestGeneration !== graphRequestGeneration || acceptedCorpus !== corpusGeneration) return;
  renderGraph(composedGraph);
  updateControls();
}

async function refreshGraph(): Promise<void> {
  await operationCoordinator.requestGraph(performGraphRefresh);
}

async function changeGraphView(): Promise<void> {
  stopTrace();
  await refreshGraph();
}

function queueGraphRefresh(label: string): void {
  runAction(refreshGraph, graphState, label);
}

function download(name: string, payload: JsonObject): void {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function loadVault(source: "local" | "documentation"): Promise<void> {
  availabilityController?.abort();
  availabilityController = null;
  retryExampleButton.disabled = false;
  stopTrace();
  clearSourceReader();
  let accepted = false;
  await operationCoordinator.runForeground("import", async () => {
    if (!client) throw new Error("Worker is unavailable");
    const controller = new AbortController();
    importController = controller;
    const progress = (value: { phase: string; completed: number; total: number }) => {
      if (importController !== controller || controller.signal.aborted || !client?.isActive) return;
      const message = `${value.phase} ${value.completed.toLocaleString()} of ${value.total.toLocaleString()}…`;
      documentState.textContent = welcomeState.textContent = queryState.textContent = message;
    };
    updateControls();
    try {
      const documents = source === "local"
        ? await readVaultFiles(selectedFiles, progress, controller.signal)
        : (await fetchVaultPack(DOCUMENTATION_PACK_URL, progress, controller.signal)).documents;
      controller.signal.throwIfAborted();
      activeImport = client.requestHandle("load-documents", { documents }, progress);
      const result = await activeImport.promise;
      // A successful commit wins a too-late cancel; acknowledged cancellation rejects above.
      acceptDocumentRuntime(result, source, "Vault ready. Ask a question to reveal its evidence trail.");
      accepted = true;
      ensureGraphRenderer();
      vaultWelcome.hidden = true;
      documentState.textContent = `Indexed ${result.documents} document(s) into ${result.records} searchable record(s); ${result.source_utf8_bytes.toLocaleString()} source bytes remain in this tab only.`;
      queryState.textContent = "Vault ready. Enter a query and trace retrieval.";
      workerState.textContent = "Worker ready. Retrieval and source text stay in this tab.";
    } catch (error) {
      const cancelled = controller.signal.aborted || (error as { code?: string })?.code === "cancelled";
      const message = `${cancelled ? "Loading cancelled" : `Loading failed: ${errorMessage(error)}`}. The previous accepted vault is unchanged. ${source === "documentation" ? "Retry the example or open your own vault." : "Choose files to try again."}`;
      documentState.textContent = welcomeState.textContent = queryState.textContent = message;
      if (source === "documentation") retryExampleButton.hidden = false;
      if (!client?.isActive) presentFailure(workerState, "Import", error);
    } finally {
      activeImport = null;
      if (importController === controller) importController = null;
      updateControls();
    }
  });
  if (!accepted) return;
  const generation = queryRequestGeneration;
  const presentationGeneration = traceGeneration;
  let guide = false;
  if (source === "documentation" && !guidedStarted) {
    try { guidedStarted = sessionStorage.getItem("rag-method:first-trace") === "done"; } catch { /* Tab-memory fallback. */ }
    guide = !guidedStarted;
    guidedStarted = true;
    try { sessionStorage.setItem("rag-method:first-trace", "done"); } catch { /* No source persistence is required. */ }
  }
  await refreshGraph();
  if (guide && runtimeSource === "documentation" && generation === queryRequestGeneration && presentationGeneration === traceGeneration) {
    applyPreset(documentationPresets[0]!);
    setMobilePane("graph");
    await runQuery();
  }
}

async function loadLocalDocuments(): Promise<void> { await loadVault("local"); }

async function restoreDefaultCollection(): Promise<void> {
  if (!contractMode) { await loadVault("documentation"); return; }
  await operationCoordinator.runForeground("restore", async () => {
    if (!client) throw new Error("Worker is unavailable");
    if (contractMode) {
      documentState.textContent = "Restoring the deterministic fixture corpus…";
      const initialized = await client.request("initialize");
      acceptFixtureRuntime(initialized, "No results yet.");
      queueGraphRefresh("Fixture graph refresh");
      queryState.textContent = "Fixture corpus restored. Run a query when ready.";
      documentState.textContent = "The deterministic fixture corpus is active. Local document contents were discarded from the Worker.";
      return;
    }
  });
}

function stopTrace(): void {
  traceGeneration += 1;
  playback.stop();
  graphRenderer?.stopMotion();
  presentation.stop();
  if (graphSurface.dataset.traceActive === "true") {
    hitRecordIds = currentContext?.chunks.map(({ id }) => id) ?? [];
    selectedRecordId = selectedSourceId = null;
    delete graphSurface.dataset.traceActive;
    updateGraphSelection();
    queryState.textContent = "Context ready. Replay or explore.";
  }
  skipTraceButton.hidden = true;
}

async function replayRetrievalTrace(orderedIds: readonly string[], requestGeneration: number): Promise<void> {
  stopTrace();
  const generation = ++traceGeneration;
  if (requestGeneration !== queryRequestGeneration) return;
  if (orderedIds.some((id) => !activeGraph?.nodes.some((node) => node.record_id === id || node.source_id === recordSourceIds.get(id)))) {
    queryState.textContent = "Results and full context are ready. The graph trace is unavailable in this view.";
    return;
  }
  if (!orderedIds.length || !motionEnabled()) {
    hitRecordIds = orderedIds;
    updateGraphSelection();
    queryState.textContent = `${orderedIds.length} matches · context ready`;
    return;
  }
  graphSurface.dataset.traceActive = "true";
  skipTraceButton.hidden = false;
  await playback.play(orderedIds, (ids, current) => {
    hitRecordIds = ids;
    selectedRecordId = current;
    selectedSourceId = selectedRecordId ? recordSourceIds.get(selectedRecordId) ?? null : null;
    updateGraphSelection();
    queryState.textContent = `Retrieved match ${ids.length} of ${orderedIds.length} → selected context. Results are ready to inspect.`;
  }, !motionEnabled());
  if (generation === traceGeneration && requestGeneration === queryRequestGeneration) {
    selectedRecordId = null;
    selectedSourceId = null;
    updateGraphSelection();
    delete graphSurface.dataset.traceActive;
    skipTraceButton.hidden = true;
    queryState.textContent = `${orderedIds.length} matches · context ready`;
  }
}

async function generateReports(): Promise<void> {
  await operationCoordinator.runForeground("reports", async () => {
    if (!client) throw new Error("Worker is unavailable");
    proofState.textContent = "Generating complete Worker actual reports…";
    reports.indexing = object(await client.request("run-indexing-contract"), "indexing report");
    reports.retrieval = object(await client.request("run-retrieval-contract"), "retrieval report");
    const indexingCases = object(reports.indexing.summary, "indexing summary").cases;
    const retrievalCases = object(reports.retrieval.summary, "retrieval summary").cases;
    proofState.textContent = `Worker actual reports ready: indexing ${text(indexingCases)} cases; retrieval ${text(retrievalCases)} cases. External local proof compares Python, Node, and Worker observations exactly.`;
    downloadIndexingButton.disabled = false;
    downloadRetrievalButton.disabled = false;
  });
}

async function runQuery(): Promise<void> {
  stopTrace();
  const presentationGeneration = traceGeneration;
  const requestGeneration = ++queryRequestGeneration;
  const acceptedCorpus = corpusGeneration;
  const completedIds = await operationCoordinator.runForeground("query", async () => {
    if (!client) throw new Error("Worker is unavailable");
    const query = queryInput.value;
    const topK = Number(topKInput.value);
    if (!Number.isInteger(topK) || topK < 1 || topK > 100) throw new Error("Top K must be an integer from 1 to 100");
    const options: JsonObject = {
      mode: modeSelect.value,
      top_k: topK,
      include_scopes: splitScopes(scopeInput.value),
      exclude_scopes: splitScopes(excludeScopeInput.value),
      expand: selectedPreset?.expand ?? true,
    };
    if (runtimeSource === "fixture" && selectedPreset?.fixtureVector && selectedPreset.query === query && selectedPreset.mode === modeSelect.value) {
      options.fixture_query_vector_id = selectedPreset.fixtureVector;
    }
    resetQueryView("Retrieval is running; previous query output was cleared.");
    queryState.textContent = "Worker retrieval is running…";
    clearQueryReportState("Current-query export is unavailable until retrieval and its matching report both validate.");
    const search = client.requestHandle("search", { query, options });
    activeSearch = search;
    updateControls();
    try {
      const observation = await search.promise;
      if (requestGeneration !== queryRequestGeneration || acceptedCorpus !== corpusGeneration) return;
      const report = object(await client.request("export-report", { kind: "query", expected_query: query }), "query report");
      if (requestGeneration !== queryRequestGeneration || acceptedCorpus !== corpusGeneration) return;
      if (report.kind !== "query" || report.query !== query || JSON.stringify(report.observation) !== JSON.stringify(observation)) {
        throw new Error("query report does not match the submitted retrieval");
      }
      const context = await client.request("get-context", { query_id: search.requestId, expected_query: query, expected_record_ids: observation.context_selected_ids });
      if (requestGeneration !== queryRequestGeneration || acceptedCorpus !== corpusGeneration) return;
      assertContextMatches(context, search.requestId, query, observation);
      currentContext = context;
      contextContent.textContent = formatContextPacket(context);
      contextPacket.hidden = false;
      copyContextButton.disabled = false;
      reports.query = report;
      renderObservation(object(observation, "query observation"));
      copyQueryButton.disabled = false;
      downloadQueryButton.disabled = false;
      queryState.textContent = presentationGeneration === traceGeneration
        ? `Results ready: ${list(observation.ordered_ids).length} ranked result(s). Preparing the graph trace…`
        : "Results and full context are ready. Your graph selection is preserved.";
      return observation.ordered_ids;
    } catch (error) {
      const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
      if (code === "cancelled") queryState.textContent = "Query cancelled before completion.";
      else throw error;
    } finally {
      if (activeSearch === search) activeSearch = null;
      updateControls();
    }
  });
  // Graph scheduling can only drain after the foreground query releases the Worker.
  if (completedIds) {
    await refreshGraph();
    if (acceptedCorpus === corpusGeneration && requestGeneration === queryRequestGeneration && presentationGeneration === traceGeneration) {
      if (contractMode) queryState.textContent = `Query complete: ${completedIds.length} ranked result(s).`;
      else await replayRetrievalTrace(completedIds, requestGeneration);
    }
  }
}

async function cancellationProbe(): Promise<void> {
  await operationCoordinator.runForeground("diagnostic", async () => {
    if (!client?.isActive) throw new Error("Worker is unavailable");
    queryState.textContent = "Starting an isolated bounded Worker to verify real cancellation without replacing the active collection…";
    const probeWorker = new Worker(new URL("../src/worker/rag.worker.ts", import.meta.url), { type: "module" });
    const probeClient = new BrowserRagWorkerClient(probeWorker, { requestTimeoutMs: 30_000 });
    try {
      await probeClient.request("initialize", { synthetic_record_count: 1_024 });
      const pending = probeClient.requestHandle("search", { query: "release", options: { mode: "exact_only", top_k: 1 } });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const acknowledgement = object(await probeClient.cancel(pending.requestId), "cancellation acknowledgement");
      if (acknowledgement.cancelled !== pending.requestId) throw new Error("Worker did not acknowledge the active retrieval cancellation");
      await pending.promise.then(() => { throw new Error("cancelled retrieval unexpectedly completed"); }, (error) => {
        if (!error || typeof error !== "object" || (error as { code?: unknown }).code !== "cancelled") throw error;
      });
      queryState.textContent = "Cancellation passed: the isolated Worker returned cancelled and the active collection was unchanged.";
      proofState.textContent = "Cancellation passed in an isolated real Worker; active reports and corpus were preserved.";
    } finally {
      if (probeClient.isActive) {
        try { await probeClient.dispose(); }
        catch { probeClient.terminate(); }
      }
    }
  });
}

function acceptFileSelection(input: HTMLInputElement): void {
  const files = Array.from(input.files ?? []);
  try {
    if (!files.length) throw new Error("No files were selected.");
    const selection = selectVaultFiles(files);
    selectedFiles = selection.accepted;
    documentState.textContent = files.length
      ? `${selection.accepted.length.toLocaleString()} supported file(s) selected, ${selection.bytes.toLocaleString()} bytes${selection.excluded ? `; ${selection.excluded.toLocaleString()} hidden or unsupported file(s) excluded` : ""}. Indexing replaces the active corpus only after every file passes.`
      : "No local files selected.";
    welcomeState.textContent = documentState.textContent;
  } catch (error) {
    selectedFiles = [];
    input.value = "";
    documentState.textContent = `Selection failed: ${error instanceof Error ? error.message : String(error)}`;
    welcomeState.textContent = documentState.textContent;
  }
  updateControls();
}
localFilesInput.addEventListener("change", () => acceptFileSelection(localFilesInput));
localVaultInput.addEventListener("change", () => {
  acceptFileSelection(localVaultInput);
  if (!vaultWelcome.hidden && selectedFiles.length) runAction(loadLocalDocuments, welcomeState, "Vault import");
});
openDemoVaultButton.addEventListener("click", () => runAction(() => loadVault("documentation"), welcomeState, "Documentation vault"));
retryExampleButton.addEventListener("click", () => runAction(refreshExampleAvailability, welcomeState, "Example availability"));
openLocalVaultButton.addEventListener("click", () => localVaultInput.click());
presetSelect.addEventListener("change", () => {
  const preset = activePresets.find((candidate) => candidate.id === presetSelect.value);
  if (preset) applyPreset(preset);
  else selectedPreset = null;
});
[modeSelect, topKInput, scopeInput, excludeScopeInput].forEach((control) => control.addEventListener("input", () => { markCustomPreset(); updateOptionsSummary(); }));
queryInput.addEventListener("input", markCustomPreset);
showEvidenceButton.addEventListener("click", () => setMobilePane("evidence"));
showGraphButton.addEventListener("click", () => setMobilePane("graph"));
graphViewSelect.addEventListener("change", () => runAction(changeGraphView, graphState, "Graph view"));
fitGraphButton.addEventListener("click", () => {
  stopTrace();
  graphRenderer?.fit();
  rendererState.textContent = "Graph fitted to the current viewport.";
});
loadLocalFilesButton.addEventListener("click", () => runAction(loadLocalDocuments, documentState, "Indexing"));
restoreFixtureButton.addEventListener("click", () => runAction(restoreDefaultCollection, documentState, contractMode ? "Fixture restore" : "Example vault restore"));
runQueryButton.addEventListener("click", () => runAction(runQuery, queryState, "Query"));
function cancelCurrentOperation(): void {
  importController?.abort();
  const search = activeSearch ?? activeImport;
  const activeClient = client;
  if (search && activeClient) runAction(() => activeClient.cancel(search.requestId).then(() => undefined), queryState, "Cancellation");
}
cancelQueryButton.addEventListener("click", cancelCurrentOperation);
cancelWelcomeImportButton.addEventListener("click", cancelCurrentOperation);
skipTraceButton.addEventListener("click", stopTrace);
motionPreference.addEventListener("change", () => { stopTrace();graphRenderer?.setMotionEnabled(motionEnabled()); });
motionStyle.addEventListener("change", () => { stopTrace();app.querySelector<HTMLElement>(".shell")!.dataset.motion=motionStyle.value;graphRenderer?.setMotionEnabled(motionEnabled());updateGraphSelection(); });
inspectorButton.addEventListener("click", () => setInspector(evidencePane.hidden));
closeInspectorButton.addEventListener("click", () => { setInspector(false);inspectorButton.focus(); });
replayBuildButton.addEventListener("click", () => { stopTrace();graphRenderer?.replaySpawn();presentation.replayBuild(); });
document.addEventListener("keydown", event => { if(event.key==="Escape"&&!evidencePane.hidden){setInspector(false);inspectorButton.focus();} });
replayTraceButton.addEventListener("click", () => runAction(async () => {
  if (!currentContext) return;
  const context = currentContext;
  const generation = queryRequestGeneration;
  stopTrace();
  const presentationGeneration = traceGeneration;
  graphViewSelect.value = "evidence";
  await refreshGraph();
  if (currentContext === context && presentationGeneration === traceGeneration) await replayRetrievalTrace(context.chunks.map(({ id }) => id), generation);
}, queryState, "Replay"));
closeSourceReaderButton.addEventListener("click", clearSourceReader);
copyContextButton.addEventListener("click", () => runAction(async () => {
  const context = currentContext;
  if (!context) return;
  try {
    await navigator.clipboard.writeText(formatContextPacket(context));
    if (currentContext === context) queryState.textContent = "Complete context copied. No model was called.";
  } catch (error) { if (currentContext === context) queryState.textContent = `Copy context failed: ${errorMessage(error)}`; }
}, queryState, "Copy context"));
copySourceButton.addEventListener("click", () => void (async () => {
  const source = currentSource;
  if (!source) throw new Error("No source is selected");
  if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable in this browser");
  try {
    await navigator.clipboard.writeText(source.content);
    if (currentSource === source) sourceBreadcrumb.textContent = `${source.path}${source.heading ? ` · ${source.heading}` : ""} · copied`;
  } catch (error) { if (currentSource === source) sourceBreadcrumb.textContent = `Copy source failed: ${errorMessage(error)}`; }
})().catch((error) => presentFailure(sourceBreadcrumb, "Copy source", error)));
runContractsButton.addEventListener("click", () => runAction(generateReports, proofState, "Report generation"));
cancellationButton.addEventListener("click", () => runAction(cancellationProbe, queryState, "Cancellation probe"));
disposeButton.addEventListener("click", () => {
  const activeClient = client;
  if (activeClient) runAction(() => operationCoordinator.runForeground("dispose", async () => {
    await activeClient.dispose();
    await shutdownTerminalSession(
      "Session ended; reload to start a new Worker.",
      "Worker disposed. Local document references were released.",
      "Session ended. Reload the page to start a new Worker.",
    );
  }), workerState, "Worker disposal");
});
copyQueryButton.addEventListener("click", () => void (async () => {
  if (!reports.query) throw new Error("No query report is available");
  if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable in this browser");
  await navigator.clipboard.writeText(JSON.stringify(reports.query, null, 2));
  exportState.textContent = "Current query report copied to the clipboard.";
})().catch((error) => presentFailure(exportState, "Copy", error)));
downloadQueryButton.addEventListener("click", () => { if (reports.query) { download("browser-rag-query-report.json", reports.query); exportState.textContent = "Current query report download started."; } });
downloadIndexingButton.addEventListener("click", () => { if (reports.indexing) { download("browser-rag-indexing-worker-actual.json", reports.indexing); exportState.textContent = "Worker indexing report download started."; } });
downloadRetrievalButton.addEventListener("click", () => { if (reports.retrieval) { download("browser-rag-retrieval-worker-actual.json", reports.retrieval); exportState.textContent = "Worker retrieval report download started."; } });
window.addEventListener("beforeunload", () => {
  void shutdownTerminalSession(
    "Session closed.",
    "Worker session closed.",
    "Session closed. No local document-derived state remains in the application.",
  );
}, { once: true });

async function refreshExampleAvailability(): Promise<void> {
  availabilityController?.abort();
  retryExampleButton.disabled = true;
  const controller = new AbortController();
  availabilityController = controller;
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(DOCUMENTATION_MANIFEST_URL, { cache: "no-store", credentials: "same-origin", signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const manifest = object(await readBoundedResponse(response, 1024 * 1024, controller.signal), "documentation manifest");
    if (!client?.isActive || availabilityController !== controller) return;
    const counts = object(manifest.counts, "documentation manifest counts");
    if (!Number.isInteger(counts.documents) || integer(counts.documents) < 1 || integer(counts.documents) > MAX_BROWSER_DOCUMENTS) throw new Error("Invalid document count");
    demoDocumentCount.textContent = `${integer(counts.documents).toLocaleString()} documents`;
    retryExampleButton.hidden = true;
    if (!importController) welcomeState.textContent = "Example available. Choose a vault; no source text leaves this tab.";
  } catch (error) {
    if (!client?.isActive || availabilityController !== controller) return;
    demoDocumentCount.textContent = "example availability unknown";
    welcomeState.textContent = `Example unavailable (${errorMessage(error)}). Open your own vault or retry the example.`;
    retryExampleButton.hidden = false;
  } finally { clearTimeout(timeout); if (availabilityController === controller) { availabilityController = null; retryExampleButton.disabled = false; } }
}

try {
  const worker = new Worker(new URL("../src/worker/rag.worker.ts", import.meta.url), { type: "module" });
  client = new BrowserRagWorkerClient(worker, {
    requestTimeoutMs: 120_000,
    onFailure: (error) => presentFailure(workerState, "Worker", error),
  });
  updateControls();
  const initialized = await client.request("initialize");
  if (contractMode) {
    ensureGraphRenderer();
    acceptFixtureRuntime(initialized, "No results yet.");
    workerState.textContent = "Worker initialized; generating initial actual reports…";
    await generateReports();
    startupLocked = false;
    updateControls();
    queueGraphRefresh("Initial graph refresh");
    workerState.textContent = "Worker ready. The sample collection and graph are active locally.";
  } else {
    startupLocked = false;
    updateControls();
    welcomeState.textContent = "Local Worker ready. Choose a vault; no source text leaves this tab.";
    workerState.textContent = "Local Worker ready. Choose a vault to begin.";
    void refreshExampleAvailability();
    if (directDocumentationVault) {
      await loadVault("documentation");
    }
  }
  updateControls();
} catch (error) {
  await shutdownTerminalSession(
    "Session failed to initialize.",
    `Worker failed: ${error instanceof Error ? error.message : String(error)}`,
    "Session failed to initialize. Reload the page to start a new Worker.",
  );
}
