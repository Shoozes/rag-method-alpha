import { createHeadlessForceGraph } from "@ours/forcegraph-tsl/headless";
import { selectRagGraphWindow } from "./layoutGraph.js";
import type { PositionedGraph, PositionedGraphNode } from "./layoutGraph.js";
import type { RagGraphProjection } from "./graphProjection.js";

export interface MemoryGraphLayoutOptions {
  readonly aspect?: number;
}

export interface PositionedMemoryGraphNode extends PositionedGraphNode {
  readonly z: number;
}

export interface PositionedMemoryGraph extends PositionedGraph {
  readonly nodes: readonly PositionedMemoryGraphNode[];
}

interface Position { readonly x: number; readonly y: number; readonly z: number }
const compareId = (a: { readonly id: string }, b: { readonly id: string }): number => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function constellation(positions: readonly Position[], aspect: number): readonly Position[] {
  if (!positions.length) return [];
  const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const point of positions) {
    for (const axis of ["x", "y", "z"] as const) {
      if (!Number.isFinite(point[axis])) throw new Error("Memory layout requires finite 3D force positions.");
      min[axis] = Math.min(min[axis], point[axis]); max[axis] = Math.max(max[axis], point[axis]);
    }
  }
  const span = { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z };
  const longest = Math.max(span.x, span.y, span.z);
  if (!longest) return positions.map(() => ({ x: 0, y: 0, z: 0 }));
  const worldSpan = Math.min(260, Math.max(64, Math.cbrt(positions.length) * 36));
  const scale = worldSpan / longest;
  const shape = Math.sqrt(Math.max(0.4, Math.min(2.5, aspect)));
  const scaleX = scale * shape, scaleY = scale / shape;
  const screenPlaneSpan = Math.max(span.x * scaleX, span.y * scaleY);
  // Preserve the force solution's depth, bounding only excessively flat/deep views.
  const depthRatio = screenPlaneSpan > 0 ? span.z * scale / screenPlaneSpan : 0;
  const scaleZ = span.z > 0 && screenPlaneSpan > 0 && (depthRatio < 0.3 || depthRatio > 0.5)
    ? screenPlaneSpan * 0.42 / span.z : scale;
  const center = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 };
  return positions.map(point => ({
    x: (point.x - center.x) * scaleX,
    y: (point.y - center.y) * scaleY,
    z: (point.z - center.z) * scaleZ,
  }));
}

/** Opt-in spatial memory view; canonical identities and the shared 2D layout stay unchanged. */
export function layoutMemoryGraph(
  projection: RagGraphProjection,
  preferredRecordIds: readonly string[] = [],
  options: MemoryGraphLayoutOptions = { aspect: 1 },
): PositionedMemoryGraph {
  const aspect = options.aspect ?? 1;
  if (!Number.isFinite(aspect) || aspect <= 0) throw new RangeError("Memory graph aspect must be finite and positive.");
  // Canonical ordering precedes admission and simulation, including clipped windows.
  const ordered = { ...projection, nodes: [...projection.nodes].sort(compareId), links: [...projection.links].sort(compareId) };
  const window = selectRagGraphWindow(ordered, preferredRecordIds);
  const admittedNodes = [...window.nodes].sort(compareId), admittedLinks = [...window.links].sort(compareId);
  const layoutSteps = admittedNodes.length <= 1 ? 0 : admittedNodes.length <= 100 ? 160 : 80;
  const started = performance.now();
  const graph = createHeadlessForceGraph({ layout: { seed: 20260919, dimensions: 3, autoStart: false } });
  try {
    graph.setData({
      nodes: admittedNodes.map(node => ({ id: node.id })),
      links: admittedLinks.map(link => ({ id: link.id, source: link.source, target: link.target })),
    });
    if (layoutSteps) graph.stepLayout(layoutSteps);
    const positions = constellation(admittedNodes.map(node => {
      const position = graph.graph.getNodePosition(node.id);
      if (!position) throw new Error("Memory layout omitted a canonical node position.");
      return position;
    }), aspect);
    return Object.freeze({
      view: projection.view,
      nodes: Object.freeze(admittedNodes.map((node, index) => Object.freeze({ ...node, ...positions[index]! }))),
      links: Object.freeze(admittedLinks),
      total_nodes: projection.total_nodes,
      total_links: projection.total_links,
      omitted_nodes: projection.omitted_nodes + Math.max(0, projection.nodes.length - admittedNodes.length),
      omitted_links: projection.omitted_links + Math.max(0, projection.links.length - admittedLinks.length),
      clipped: admittedNodes.length !== projection.total_nodes || admittedLinks.length !== projection.total_links,
      layout_steps: layoutSteps,
      layout_ms: performance.now() - started,
      request_generation: 0,
    });
  } finally { graph.dispose(); }
}
