import { createHeadlessForceGraph } from "@ours/forcegraph-tsl/headless";
import type { RagGraphLink, RagGraphNode, RagGraphProjection, RagGraphView } from "./graphProjection.js";
import { graphFamilyKey } from "./graphPalette.js";

export const MAX_VISIBLE_GRAPH_NODES = 500;
export const MAX_VISIBLE_GRAPH_LINKS = 2_000;
export const GRAPH_LAYOUT_BATCH_STEPS = 8;

export interface PositionedGraphNode extends RagGraphNode {
  readonly x: number;
  readonly y: number;
  /** Optional host-owned depth; the existing atlas layouts remain two-dimensional. */
  readonly z?: number;
}
export interface PositionedGraph {
  readonly view: RagGraphView;
  readonly nodes: readonly PositionedGraphNode[];
  readonly links: readonly RagGraphLink[];
  readonly total_nodes: number;
  readonly total_links: number;
  readonly omitted_nodes: number;
  readonly omitted_links: number;
  readonly clipped: boolean;
  readonly layout_steps: number;
  readonly layout_ms: number;
  readonly request_generation: number;
}

export function selectRagGraphWindow(
  projection: RagGraphProjection,
  preferredRecordIds: readonly string[] = [],
): Pick<RagGraphProjection, "nodes" | "links"> {
  const nodeById = new Map(projection.nodes.map((node) => [node.id, node]));
  const nodeByRecordId = new Map(projection.nodes.flatMap((node) => node.record_id ? [[node.record_id, node] as const] : []));
  const preferred = preferredRecordIds.map((id) => nodeByRecordId.get(id)).filter((node) => node !== undefined);
  const preferredIds = new Set(preferred.map((node) => node.id));
  const neighborIds = new Set<string>();
  for (const link of projection.links) {
    if (preferredIds.has(link.source)) neighborIds.add(link.target);
    if (preferredIds.has(link.target)) neighborIds.add(link.source);
  }
  const admittedNodes = [] as RagGraphNode[];
  const seen = new Set<string>();
  // Fill the bounded evidence window with connected source neighborhoods, not
  // source-only nodes. Round-robin families keeps the atlas representative.
  const neighborhoods = new Map<string, RagGraphNode[]>();
  for (const node of projection.nodes) {
    const key = node.source_id ?? node.id;
    const bucket = neighborhoods.get(key) ?? [];
    bucket.push(node);
    neighborhoods.set(key, bucket);
  }
  const families = new Map<string, RagGraphNode[][]>();
  for (const nodes of neighborhoods.values()) {
    const key = graphFamilyKey(nodes[0]!.path);
    const family = families.get(key) ?? [];
    family.push(nodes);
    families.set(key, family);
  }
  const balanced: RagGraphNode[] = [];
  const orderedFamilies = [...families.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, buckets]) => buckets);
  for (let index = 0; orderedFamilies.some((family) => index < family.length); index++) {
    for (const family of orderedFamilies) balanced.push(...(family[index]?.slice(0, 7) ?? []));
  }
  const candidates = [...preferred, ...projection.nodes.filter((candidate) => neighborIds.has(candidate.id)), ...(projection.view === "evidence" ? balanced : projection.nodes), ...projection.nodes];
  for (const node of candidates) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    admittedNodes.push(node);
    if (admittedNodes.length === MAX_VISIBLE_GRAPH_NODES) break;
  }
  const admittedIds = new Set(admittedNodes.map((node) => node.id));
  const admittedLinks = projection.links
    .filter((link) => admittedIds.has(link.source) && admittedIds.has(link.target))
    .slice(0, MAX_VISIBLE_GRAPH_LINKS);
  for (const link of admittedLinks) {
    if (!nodeById.has(link.source) || !nodeById.has(link.target)) throw new Error("graph window contains an invalid link endpoint");
  }
  return Object.freeze({ nodes: Object.freeze(admittedNodes), links: Object.freeze(admittedLinks) });
}

function positionedResult(
  projection: RagGraphProjection,
  admittedNodes: readonly RagGraphNode[],
  admittedLinks: readonly RagGraphLink[],
  positions: ReadonlyMap<string, { readonly x: number; readonly y: number }>,
  layoutSteps: number,
  layoutMs: number,
  requestGeneration: number,
): PositionedGraph {
  const nodes = admittedNodes.map((node) => {
    const position = positions.get(node.id) ?? { x: 0, y: 0 };
    return Object.freeze({ ...node, x: position.x, y: position.y });
  });
  return Object.freeze({
    view: projection.view,
    nodes: Object.freeze(nodes),
    links: Object.freeze([...admittedLinks]),
    total_nodes: projection.total_nodes,
    total_links: projection.total_links,
    omitted_nodes: projection.omitted_nodes + Math.max(0, projection.nodes.length - admittedNodes.length),
    omitted_links: projection.omitted_links + Math.max(0, projection.links.length - admittedLinks.length),
    clipped: admittedNodes.length !== projection.total_nodes || admittedLinks.length !== projection.total_links,
    layout_steps: layoutSteps,
    layout_ms: layoutMs,
    request_generation: requestGeneration,
  });
}

export function layoutRagGraph(
  projection: RagGraphProjection,
  preferredRecordIds: readonly string[] = [],
  requestGeneration = 0,
): PositionedGraph {
  const window = selectRagGraphWindow(projection, preferredRecordIds);
  const graph = createHeadlessForceGraph({ layout: { seed: 20260919, dimensions: 2, autoStart: false } });
  const started = performance.now();
  const layoutSteps = window.nodes.length <= 1 ? 0 : window.nodes.length <= 100 ? 160 : 80;
  try {
    graph.setData({
      nodes: window.nodes.map((node) => ({ id: node.id })),
      links: window.links.map((link) => ({ id: link.id, source: link.source, target: link.target })),
    });
    if (layoutSteps) graph.stepLayout(layoutSteps);
    const positions = new Map(window.nodes.map((node) => [node.id, graph.graph.getNodePosition(node.id) ?? { x: 0, y: 0 }]));
    return positionedResult(projection, window.nodes, window.links, positions, layoutSteps, performance.now() - started, requestGeneration);
  } finally {
    graph.dispose();
  }
}

export async function layoutRagGraphAsync(
  projection: RagGraphProjection,
  preferredRecordIds: readonly string[],
  requestGeneration: number,
  checkpoint: () => void,
  yieldControl: () => Promise<void>,
): Promise<PositionedGraph> {
  const window = selectRagGraphWindow(projection, preferredRecordIds);
  const graph = createHeadlessForceGraph({ layout: { seed: 20260919, dimensions: 2, autoStart: false } });
  const started = performance.now();
  const layoutSteps = window.nodes.length <= 1 ? 0 : window.nodes.length <= 100 ? 160 : 80;
  try {
    graph.setData({
      nodes: window.nodes.map((node) => ({ id: node.id })),
      links: window.links.map((link) => ({ id: link.id, source: link.source, target: link.target })),
    });
    let remaining = layoutSteps;
    while (remaining > 0) {
      checkpoint();
      const steps = Math.min(GRAPH_LAYOUT_BATCH_STEPS, remaining);
      graph.stepLayout(steps);
      remaining -= steps;
      await yieldControl();
    }
    checkpoint();
    const positions = new Map(window.nodes.map((node) => [node.id, graph.graph.getNodePosition(node.id) ?? { x: 0, y: 0 }]));
    return positionedResult(projection, window.nodes, window.links, positions, layoutSteps, performance.now() - started, requestGeneration);
  } finally {
    graph.dispose();
  }
}
