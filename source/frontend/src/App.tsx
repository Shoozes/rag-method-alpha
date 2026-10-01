import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiErrorMessage, ragClient, uploadEntriesFromFiles } from "./api/ragClient";
import { CollectionList } from "./components/CollectionList";
import { EvidenceInspector, getHitScores, searchResultId } from "./components/EvidenceInspector";
import { GraphErrorBoundary } from "./components/GraphErrorBoundary";
import { ImportControls } from "./components/ImportControls";
import { ModeComparison } from "./components/ModeComparison";
import { SearchControls } from "./components/SearchControls";
import { SimpleEvidence } from "./components/SimpleEvidence";
import { ViewModeToggle } from "./components/ViewModeToggle";
import {
  DEMO_COLLECTION_ID,
  DEMO_DISPLAY_NAME,
  demoUploadEntries,
  loadDemoManifest,
} from "./demo/loadDemo";
import { ShaderBackground } from "./effects/ShaderBackground";
import { useRagSearch } from "./hooks/useRagSearch";
import { useViewMode } from "./hooks/useViewMode";
import { serializeCurrentQueryReport } from "./reports/currentQueryReport";
import { DEFAULT_POCKETS, type GraphData, type GraphNode, type PocketName } from "./types/rag";

const EMPTY_GRAPH: GraphData = {
  nodes: [],
  links: [],
  companion_id: null,
  pockets: [],
  paths: [],
  fingerprint: "",
  generation: null,
  graph_meta: {
    total_nodes: 0,
    total_links: 0,
    returned_nodes: 0,
    returned_links: 0,
    node_limit: 0,
    link_limit: 0,
    truncated: false,
  },
  embedding: { mode: "disabled", status: "disabled", dimension: 0 },
};
const COLLECTION_LABELS = { [DEMO_COLLECTION_ID]: DEMO_DISPLAY_NAME } as const;
const KnowledgeGraph = lazy(() =>
  import("./components/KnowledgeGraph").then(({ KnowledgeGraph: component }) => ({
    default: component,
  })),
);

export function App() {
  const [collections, setCollections] = useState<string[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  const [collectionId, setCollectionId] = useState("");
  const [suggestedQueries, setSuggestedQueries] = useState<string[]>([]);
  const [graphData, setGraphData] = useState<GraphData>(EMPTY_GRAPH);
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(
    () => !window.matchMedia("(max-width: 820px)").matches,
  );
  const { viewMode, setViewMode, advanced } = useViewMode();
  const graphRequestId = useRef(0);
  const graphAbortController = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const {
    query,
    queryError,
    setQuery,
    settings,
    setSettings,
    observation,
    comparisons,
    searching,
    comparing,
    run,
    compare,
    cancel,
    reset: resetRetrieval,
  } = useRagSearch(selectedCollection, setStatus);

  const clearSelection = useCallback(() => {
    setSelectedResultId(null);
    setSelectedNodeId(null);
  }, []);

  const resetSearch = useCallback(() => {
    resetRetrieval();
    clearSelection();
    setStatus((current) => (current.startsWith("Search error:") ? "" : current));
  }, [clearSelection, resetRetrieval]);

  const refreshCollections = useCallback(async () => {
    const payload = await ragClient.listCompanions();
    const current = payload.companions || [];
    if (mounted.current) setCollections(current);
    return current;
  }, []);

  const loadGraph = useCallback(
    async (
      companion: string,
      force = false,
      pockets: readonly PocketName[] = DEFAULT_POCKETS,
    ): Promise<boolean> => {
      const requestId = ++graphRequestId.current;
      graphAbortController.current?.abort();
      const controller = new AbortController();
      graphAbortController.current = controller;
      setGraphLoading(true);
      setStatus(force ? "Refreshing index…" : "Loading graph…");
      try {
        const payload = await ragClient.getGraph(companion, pockets, force, controller.signal);
        if (!mounted.current || requestId !== graphRequestId.current) return false;
        setGraphData(payload);
        setStatus(
          payload.graph_meta?.truncated
            ? "Graph summarized for the bounded view."
            : force
              ? "Refreshed."
              : "",
        );
        return true;
      } catch (error) {
        if (!mounted.current || requestId !== graphRequestId.current) return false;
        if (controller.signal.aborted) return false;
        setGraphData(EMPTY_GRAPH);
        setStatus(`Error: ${apiErrorMessage(error)}`);
        return false;
      } finally {
        if (mounted.current && requestId === graphRequestId.current) setGraphLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void refreshCollections().catch((error) => {
      if (mounted.current) setStatus(`Error: ${apiErrorMessage(error)}`);
    });
  }, [refreshCollections]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      graphRequestId.current += 1;
      graphAbortController.current?.abort();
    };
  }, []);

  useEffect(() => {
    const firstId = observation?.response.results[0]
      ? searchResultId(observation.response.results[0])
      : "";
    setSelectedResultId(firstId || null);
    setSelectedNodeId(firstId || null);
  }, [observation]);

  const hitScores = useMemo(
    () => getHitScores(observation?.response.results || []),
    [observation],
  );
  const selectedGraphNode = useMemo(
    () => graphData.nodes.find((node) => node.id === selectedNodeId) || null,
    [graphData.nodes, selectedNodeId],
  );
  const reportJson = useMemo(
    () =>
      selectedCollection && observation
        ? serializeCurrentQueryReport(selectedCollection, observation, comparisons)
        : "",
    [comparisons, observation, selectedCollection],
  );

  const selectCollection = useCallback(
    async (collection: string) => {
      resetSearch();
      setSelectedCollection(collection);
      if (collection !== DEMO_COLLECTION_ID) setSuggestedQueries([]);
      setSidebarOpen(false);
      await loadGraph(collection);
    },
    [loadGraph, resetSearch],
  );

  const selectResult = useCallback((resultId: string) => {
    if (!resultId) return;
    setSelectedResultId(resultId);
    setSelectedNodeId(resultId);
  }, []);

  const selectGraphNode = useCallback(
    (node: GraphNode) => {
      setSelectedNodeId(node.id);
      const matchesResult = observation?.response.results.some(
        (result) => searchResultId(result) === node.id,
      );
      setSelectedResultId(matchesResult ? node.id : null);
    },
    [observation],
  );

  const clearGraph = useCallback(() => {
    resetSearch();
    graphRequestId.current += 1;
    graphAbortController.current?.abort();
    setGraphLoading(false);
    setGraphData(EMPTY_GRAPH);
    setStatus("Graph cleared.");
  }, [resetSearch]);

  const refreshGraph = useCallback(() => {
    if (selectedCollection) void loadGraph(selectedCollection, true, settings.pockets);
  }, [loadGraph, selectedCollection, settings.pockets]);

  const runRetrieval = useCallback(async () => {
    if (!selectedCollection) return;
    const graphPockets = graphData.pockets.join(",");
    if (graphPockets !== settings.pockets.join(",")) {
      const graphLoaded = await loadGraph(selectedCollection, false, settings.pockets);
      if (!graphLoaded) return;
    }
    await run();
  }, [graphData.pockets, loadGraph, run, selectedCollection, settings.pockets]);

  const finishImport = useCallback(
    async (id: string) => {
      await refreshCollections();
      setSelectedCollection(id);
      return loadGraph(id, true);
    },
    [loadGraph, refreshCollections],
  );

  const loadDemo = useCallback(async () => {
    resetSearch();
    setBusy(true);
    setStatus("Loading the synthetic demo…");
    try {
      const manifest = await loadDemoManifest();
      setSuggestedQueries(manifest.suggested_queries);
      const current = await refreshCollections();
      if (current.includes(manifest.collection_id)) {
        setSelectedCollection(manifest.collection_id);
        if (await loadGraph(manifest.collection_id)) {
          setStatus(`Ready: ${manifest.collection_id}`);
        }
        return;
      }
      const payload = await ragClient.uploadFolder(
        demoUploadEntries(manifest),
        manifest.collection_id,
      );
      setStatus("Demo imported. Rebuilding view…");
      if (await finishImport(payload.id)) setStatus(`Ready: ${payload.id}`);
    } catch (error) {
      setStatus(`Error: ${apiErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }, [finishImport, loadGraph, refreshCollections, resetSearch]);

  const importZip = useCallback(
    async (file: File, requestedCollectionId: string) => {
      resetSearch();
      setBusy(true);
      setStatus(`Uploading ZIP: ${file.name}…`);
      try {
        const payload = await ragClient.uploadZip(file, requestedCollectionId.trim());
        setStatus("Imported. Rebuilding view…");
        if (await finishImport(payload.id)) setStatus(`Ready: ${payload.id}`);
      } catch (error) {
        setStatus(`Error: ${apiErrorMessage(error)}`);
      } finally {
        setBusy(false);
      }
    },
    [finishImport, resetSearch],
  );

  const importFolder = useCallback(
    async (files: File[], requestedCollectionId: string) => {
      resetSearch();
      setBusy(true);
      setStatus(`Uploading ${files.length} files…`);
      try {
        const payload = await ragClient.uploadFolder(
          uploadEntriesFromFiles(files),
          requestedCollectionId.trim(),
        );
        setStatus("Uploaded. Rebuilding view…");
        if (await finishImport(payload.id)) setStatus(`Ready: ${payload.id}`);
      } catch (error) {
        setStatus(`Error: ${apiErrorMessage(error)}`);
      } finally {
        setBusy(false);
      }
    },
    [finishImport, resetSearch],
  );

  const selectedCollectionLabel = selectedCollection
    ? COLLECTION_LABELS[selectedCollection as keyof typeof COLLECTION_LABELS] || selectedCollection
    : "No Collection selected";

  const graphPanel = (
    <GraphErrorBoundary
      key={`${selectedCollection ?? "none"}:${graphData.fingerprint ?? ""}:${graphData.generation ?? ""}`}
    >
      <Suspense
        fallback={
          <div className="graph-stage">
            <p className="graph-loading">Loading graph tools…</p>
          </div>
        }
      >
        <KnowledgeGraph
          data={graphData}
          hitScores={hitScores}
          selectedNodeId={selectedNodeId}
          loading={graphLoading}
          onSelectNode={selectGraphNode}
          onResetSelection={clearSelection}
        />
      </Suspense>
    </GraphErrorBoundary>
  );

  return (
    <>
      <ShaderBackground />
      <button
        className="mobile-menu-button"
        type="button"
        aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
        aria-expanded={sidebarOpen}
        onClick={() => setSidebarOpen((open) => !open)}
      >
        {sidebarOpen ? "Close" : "Menu"}
      </button>

      <div className="app-shell">
        <aside className={`sidebar${sidebarOpen ? " open" : ""}`}>
          <header className="product-heading">
            <p>RAG Method example</p>
            <h1>RAG Method Lab</h1>
            <span>Inspect indexing, retrieval, scoring, and context selection.</span>
          </header>

          <ViewModeToggle mode={viewMode} onChange={setViewMode} />

          <SearchControls
            advanced={advanced}
            query={query}
            settings={settings}
            collectionSelected={Boolean(selectedCollection)}
            busy={busy}
            searching={searching}
            comparing={comparing}
            queryError={queryError}
            onQueryChange={setQuery}
            onSettingsChange={(next) => setSettings(next)}
            onRun={() => void runRetrieval()}
            onCancel={() => cancel()}
          />

          {selectedCollection === DEMO_COLLECTION_ID && suggestedQueries.length > 0 && (
            advanced ? (
              <section className="suggested-queries" aria-label="Suggested demo queries">
                <p>Suggested queries</p>
                {suggestedQueries.map((suggestedQuery) => (
                  <button
                    key={suggestedQuery}
                    type="button"
                    disabled={busy || searching || comparing}
                    onClick={() => setQuery(suggestedQuery)}
                  >
                    {suggestedQuery}
                  </button>
                ))}
              </section>
            ) : (
              <label className="simple-suggestion" htmlFor="suggested-query">
                <span>Try a demo question</span>
                <select
                  id="suggested-query"
                  value=""
                  disabled={busy || searching || comparing}
                  onChange={(event) => setQuery(event.target.value)}
                >
                  <option value="">Choose a question…</option>
                  {suggestedQueries.map((suggestedQuery) => (
                    <option key={suggestedQuery} value={suggestedQuery}>{suggestedQuery}</option>
                  ))}
                </select>
              </label>
            )
          )}

          {advanced ? (
            <>
              <div className="section-heading">
                <h2>Collections</h2>
                <span>{collections.length}</span>
              </div>
              <CollectionList
                collections={collections}
                selectedCollection={selectedCollection}
                labels={COLLECTION_LABELS}
                disabled={busy}
                onSelect={(collection) => void selectCollection(collection)}
              />
              <ImportControls
                collectionId={collectionId}
                busy={busy}
                canRefresh={Boolean(selectedCollection)}
                onCollectionIdChange={setCollectionId}
                onLoadDemo={() => void loadDemo()}
                onZip={(file, id) => void importZip(file, id)}
                onFolder={(files, id) => void importFolder(files, id)}
                onRefresh={refreshGraph}
                onClear={clearGraph}
              />
            </>
          ) : (
            <section className="simple-collection-card" aria-label="Current Collection">
              <div>
                <p>Current Collection</p>
                <strong>{selectedCollectionLabel}</strong>
              </div>
              <button
                className="button button-demo"
                type="button"
                onClick={() => void loadDemo()}
                disabled={busy}
              >
                {selectedCollection === DEMO_COLLECTION_ID ? "Reload Demo" : "Load Demo"}
              </button>
              <details>
                <summary>Manage Collections</summary>
                <div className="section-heading">
                  <h2>Collections</h2>
                  <span>{collections.length}</span>
                </div>
                <CollectionList
                  collections={collections}
                  selectedCollection={selectedCollection}
                  labels={COLLECTION_LABELS}
                  disabled={busy}
                  onSelect={(collection) => void selectCollection(collection)}
                />
                <ImportControls
                  showDemoButton={false}
                  collectionId={collectionId}
                  busy={busy}
                  canRefresh={Boolean(selectedCollection)}
                  onCollectionIdChange={setCollectionId}
                  onLoadDemo={() => void loadDemo()}
                  onZip={(file, id) => void importZip(file, id)}
                  onFolder={(files, id) => void importFolder(files, id)}
                  onRefresh={refreshGraph}
                  onClear={clearGraph}
                />
              </details>
            </section>
          )}

          <p className="status-line" aria-live="polite">
            {status}
          </p>
        </aside>

        <main className={`main-content ${advanced ? "advanced-view" : "simple-view"}`}>
          {advanced ? (
            <>
              {graphPanel}
              <div className="analysis-panels">
                <EvidenceInspector
                  observation={observation}
                  searching={searching}
                  selectedResultId={selectedResultId}
                  selectedGraphNode={selectedGraphNode}
                  onSelectResult={selectResult}
                  onClearSelection={clearSelection}
                />
                <ModeComparison
                  comparisons={comparisons}
                  comparing={comparing}
                  canCompare={Boolean(observation) && !queryError && !searching && !busy}
                  reportJson={reportJson}
                  onCompare={() => void compare()}
                  onMessage={setStatus}
                />
              </div>
            </>
          ) : (
            <div className="simple-workspace">
              {graphPanel}
              <SimpleEvidence
                observation={observation}
                searching={searching}
                selectedResultId={selectedResultId}
                onSelectResult={selectResult}
                onOpenAdvanced={() => setViewMode("advanced")}
              />
            </div>
          )}
        </main>
      </div>
    </>
  );
}
