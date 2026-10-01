import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D, { type ForceGraphMethods } from "react-force-graph-3d";
import { hasWebGLSupport, releaseWebGLRenderer } from "../graphics/webglLifecycle";
import { useElementSize } from "../hooks/useElementSize";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { MAX_FALLBACK_NODES, selectFallbackNodes } from "../graph/selectFallbackNodes";
import type { GraphData, GraphLink, GraphNode } from "../types/rag";

type KnowledgeGraphProps = {
  data: GraphData;
  hitScores: Record<string, number>;
  selectedNodeId: string | null;
  loading: boolean;
  onSelectNode: (node: GraphNode) => void;
  onResetSelection: () => void;
};

const baseTitleColor = "hsl(276, 75%, 65%)";
const baseChunkColor = "hsl(0, 0%, 38%)";
const MAX_RENDER_NODES = 5000;
const FOCUS_DISTANCE = 90;
const goldenAngle = Math.PI * (3 - Math.sqrt(5));

type PositionedGraphNode = GraphNode & {
  x: number;
  y: number;
  z: number;
  fx: number;
  fy: number;
  fz: number;
};

type PositionedGraphData = {
  nodes: PositionedGraphNode[];
  links: GraphLink[];
};

function graphNodeId(value: string | GraphNode): string {
  return typeof value === "string" ? value : value.id;
}

function buildPositionedGraphData(data: GraphData): PositionedGraphData {
  const total = Math.max(1, data.nodes.length);
  const spread = 64 + Math.sqrt(total) * 16;
  const nodes = [...data.nodes]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((node, index) => {
      const vertical = 1 - (2 * (index + 0.5)) / total;
      const radius = Math.sqrt(Math.max(0, 1 - vertical * vertical));
      const angle = index * goldenAngle;
      const x = Math.cos(angle) * radius * spread;
      const y = vertical * spread;
      const z = Math.sin(angle) * radius * spread;
      return { ...node, x, y, z, fx: x, fy: y, fz: z };
    });
  const links = data.links.map((link) => ({
    source: graphNodeId(link.source),
    target: graphNodeId(link.target),
  }));
  return { nodes, links };
}

function GraphFallback({
  data,
  loading,
  reason,
  selectedNodeId,
  hitScores,
  onSelectNode,
  onResetSelection,
}: {
  data: GraphData;
  loading: boolean;
  reason: string;
  selectedNodeId: string | null;
  hitScores: Record<string, number>;
  onSelectNode: (node: GraphNode) => void;
  onResetSelection: () => void;
}) {
  const { nodes: visibleNodes, selectedMissing, hitRanks } = selectFallbackNodes({
    nodes: data.nodes,
    links: data.links,
    selectedNodeId,
    hitScores,
  });
  const totalNodes = data.graph_meta?.total_nodes ?? data.nodes.length;
  const totalLinks = data.graph_meta?.total_links ?? data.links.length;
  return (
    <section className="graph-stage graph-fallback" aria-label="Knowledge graph summary">
      {loading && <div className="graph-loading">Loading graph…</div>}
      {!data.nodes.length ? (
        <p className="graph-empty">
          {data.companion_id ? "No indexed graph nodes for this selection." : reason}
        </p>
      ) : (
        <div className="graph-summary">
          <p className="graph-empty">{reason}</p>
          {selectedMissing && (
            <p className="graph-fallback-notice" role="status">
              Selected retrieval evidence is outside the bounded graph response.
            </p>
          )}
          <p>
            {data.nodes.length} of {totalNodes} nodes · {data.links.length} of {totalLinks} links
            {data.graph_meta?.truncated ? " · transport truncated" : ""}
          </p>
          <ul>
            {visibleNodes.map((node) => (
              <li key={node.id}>
                <button
                  type="button"
                  data-node-id={node.id}
                  className={[
                    selectedNodeId === node.id ? "selected" : "",
                    hitScores[node.id] !== undefined ? "hit" : "",
                  ].filter(Boolean).join(" ")}
                  aria-pressed={selectedNodeId === node.id}
                  onClick={() => onSelectNode(node)}
                >
                  <span>{node.label || node.id}</span>
                  <small className="graph-node-status">
                    {node.type || "node"}
                    {hitScores[node.id] !== undefined && (
                      <> · hit #{hitRanks.get(node.id) || "?"} · {hitScores[node.id].toFixed(3)}</>
                    )}
                    {selectedNodeId === node.id && " · selected"}
                  </small>
                </button>
              </li>
            ))}
          </ul>
          {(data.graph_meta?.truncated || data.nodes.length > visibleNodes.length) && (
            <p>Showing {visibleNodes.length} prioritized nodes (bounded to {MAX_FALLBACK_NODES}).</p>
          )}
          {selectedNodeId && (
            <button className="graph-reset" type="button" onClick={onResetSelection}>
              Reset selection
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function KnowledgeGraph({
  data,
  hitScores,
  selectedNodeId,
  loading,
  onSelectNode,
  onResetSelection,
}: KnowledgeGraphProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<ForceGraphMethods | undefined>(undefined);
  const reducedMotion = usePrefersReducedMotion();
  const [webgl, setWebgl] = useState(false);
  const [cameraTargetId, setCameraTargetId] = useState<string | null>(null);
  const graphData = useMemo(() => buildPositionedGraphData(data), [data]);
  const selectedNode = useMemo(
    () => graphData.nodes.find((node) => node.id === selectedNodeId) || null,
    [graphData.nodes, selectedNodeId],
  );
  const canRender3d =
    webgl &&
    !reducedMotion &&
    data.nodes.length > 0 &&
    !data.graph_meta?.truncated &&
    data.nodes.length <= MAX_RENDER_NODES;
  const size = useElementSize(containerRef, canRender3d);

  useEffect(() => setWebgl(hasWebGLSupport()), []);

  useLayoutEffect(() => {
    if (!canRender3d) return undefined;
    const graph = graphRef.current;
    if (!graph) return undefined;
    const renderer = graph.renderer();
    return () => {
      try {
        graph.pauseAnimation();
      } finally {
        releaseWebGLRenderer(renderer);
      }
    };
  }, [canRender3d]);

  const nodeColor = useCallback(
    (rawNode: object) => {
      const node = rawNode as GraphNode;
      if (node.id === selectedNodeId) return "hsl(38, 92%, 58%)";
      const score = hitScores[node.id];
      if (typeof score === "number") {
        const saturation = Math.round(25 + 60 * score);
        const lightness = Math.round(40 + 40 * score);
        return `hsl(120, ${saturation}%, ${lightness}%)`;
      }
      return node.color || (node.type === "title" ? baseTitleColor : baseChunkColor);
    },
    [hitScores, selectedNodeId],
  );

  useEffect(() => {
    graphRef.current?.refresh();
  }, [hitScores, selectedNodeId]);

  const focusNode = useCallback(
    (node: PositionedGraphNode) => {
      const graph = graphRef.current;
      if (!graph) return false;
      const coordinate = (value: number | undefined) =>
        typeof value === "number" && Number.isFinite(value) ? value : 0;
      const x = coordinate(node.x);
      const y = coordinate(node.y);
      const z = coordinate(node.z);
      const length = Math.hypot(x, y, z);
      const ratio = length > 0 ? 1 + FOCUS_DISTANCE / length : 1;
      graph.cameraPosition(
        length > 0 ? { x: x * ratio, y: y * ratio, z: z * ratio } : { x: 0, y: 0, z: 120 },
        { x, y, z },
        450,
      );
      setCameraTargetId((current) => (current === node.id ? current : node.id));
      return true;
    },
    [],
  );

  useEffect(() => {
    if (!canRender3d || !selectedNode) {
      setCameraTargetId(null);
      return;
    }
    focusNode(selectedNode);
  }, [canRender3d, focusNode, selectedNode]);

  const selectNode = useCallback(
    (rawNode: object) => onSelectNode(rawNode as GraphNode),
    [onSelectNode],
  );

  const resetView = useCallback(() => {
    onResetSelection();
    setCameraTargetId(null);
    graphRef.current?.zoomToFit(400, 40);
  }, [onResetSelection]);

  const settleView = useCallback(() => {
    if (selectedNode && focusNode(selectedNode)) return;
    graphRef.current?.zoomToFit(400, 40);
  }, [focusNode, selectedNode]);

  const cameraTargetLabel = cameraTargetId
    ? data.nodes.find((node) => node.id === cameraTargetId)?.label || cameraTargetId
    : null;

  const fallbackProps = { data, hitScores, loading, selectedNodeId, onSelectNode, onResetSelection };

  if (!data.nodes.length) {
    return <GraphFallback {...fallbackProps} reason="Select a collection to visualize." />;
  }
  if (data.graph_meta?.truncated) {
    return <GraphFallback {...fallbackProps} reason="This graph is larger than the 3D view; showing a bounded summary." />;
  }
  if (reducedMotion) {
    return <GraphFallback {...fallbackProps} reason="Reduced motion is enabled; showing a static summary." />;
  }
  if (!webgl) {
    return <GraphFallback {...fallbackProps} reason="WebGL is unavailable; showing a static summary." />;
  }
  if (data.nodes.length > MAX_RENDER_NODES) {
    return <GraphFallback {...fallbackProps} reason="This graph is too large for the 3D view." />;
  }

  return (
    <section
      ref={containerRef}
      className="graph-stage has-graph"
      aria-label="Knowledge graph"
      data-camera-target-id={cameraTargetId || ""}
    >
      <ForceGraph3D
        ref={graphRef}
        graphData={graphData}
        width={size.width}
        height={size.height}
        backgroundColor="rgba(0, 0, 0, 0)"
        rendererConfig={{ antialias: true, alpha: true }}
        nodeRelSize={9}
        nodeLabel={(node) => (node as GraphNode).label || (node as GraphNode).id}
        nodeColor={nodeColor}
        nodeVal={(node) =>
          (node as GraphNode).id === selectedNodeId
            ? 3
            : (node as GraphNode).type === "title"
              ? 2
              : 1
        }
        linkOpacity={0.35}
        cooldownTicks={data.nodes.length > 250 ? 80 : 160}
        onEngineStop={settleView}
        onNodeClick={selectNode}
      />
      <aside className="graph-toolbar" aria-label="Graph status and controls">
        <p>
          {data.graph_meta.returned_nodes}/{data.graph_meta.total_nodes} nodes · {data.graph_meta.returned_links}/{data.graph_meta.total_links} links
        </p>
        <div className="graph-legend">
          <span><i className="legend-title" />source/title</span>
          <span><i className="legend-chunk" />chunk</span>
          <span><i className="legend-hit" />retrieval hit</span>
          <span><i className="legend-selected" />selected</span>
        </div>
        {cameraTargetLabel && <p className="camera-focus" aria-live="polite">Camera focused on {cameraTargetLabel}</p>}
        <button type="button" onClick={resetView}>Reset view</button>
      </aside>
      {loading && <div className="graph-loading">Loading graph…</div>}
    </section>
  );
}
