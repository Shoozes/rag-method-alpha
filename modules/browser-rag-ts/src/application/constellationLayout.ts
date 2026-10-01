import type { PositionedGraph, PositionedGraphNode } from "./layoutGraph.js";
import { graphFamilyKey } from "./graphPalette.js";

const GOLDEN_ANGLE = 2.399963229728653;

function groupKey(node: PositionedGraphNode): string {
  return graphFamilyKey(node.path);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sourceKey(node: PositionedGraphNode): string {
  return node.source_id ?? node.id;
}

function localPoint(index: number, count: number, radius: number, phase: number): Readonly<{ x: number; y: number }> {
  if (count === 0) return Object.freeze({ x: 0, y: 0 });
  const angle = phase + index * GOLDEN_ANGLE;
  const distance = count === 1 ? radius * 0.72 : radius * Math.sqrt((index + 0.6) / count);
  return Object.freeze({ x: Math.cos(angle) * distance, y: Math.sin(angle) * distance });
}

function hashPhase(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 4294967295) * Math.PI * 2;
}

/**
 * Reflows a real projected RAG graph into stable path-based constellations.
 * Identity and links remain untouched; only application presentation changes.
 */
export function composeRagConstellations(graph: PositionedGraph): PositionedGraph {
  if (graph.nodes.length < 2) return graph;
  const groups = new Map<string, PositionedGraphNode[]>();
  for (const node of graph.nodes) {
    const key = groupKey(node);
    const bucket = groups.get(key) ?? [];
    bucket.push(node);
    groups.set(key, bucket);
  }
  const orderedGroups = [...groups.entries()].sort(([leftKey, left], [rightKey, right]) =>
    right.length - left.length || compareText(leftKey, rightKey));
  const positions = new Map<string, Readonly<{ x: number; y: number }>>();
  for (const [groupIndex, [key, members]] of orderedGroups.entries()) {
    const groupAngle = groupIndex * GOLDEN_ANGLE - 0.62;
    const groupDistance = groupIndex === 0 ? 0 : 310 * Math.sqrt(groupIndex);
    const center = {
      x: Math.cos(groupAngle) * groupDistance * 1.28,
      y: Math.sin(groupAngle) * groupDistance,
    };
    const bySource = new Map<string, PositionedGraphNode[]>();
    for (const node of members) {
      const source = sourceKey(node);
      const bucket = bySource.get(source) ?? [];
      bucket.push(node);
      bySource.set(source, bucket);
    }
    const sources = [...bySource.entries()].sort(([left], [right]) => compareText(left, right));
    // Source neighborhoods occupy the group, rather than collapsing into its center.
    const sourceRadius = Math.max(96, 50 + Math.sqrt(sources.length) * 66);
    for (const [sourceIndex, [source, sourceMembers]] of sources.entries()) {
      const sourceOffset = localPoint(sourceIndex, sources.length, sourceRadius, hashPhase(key));
      const sourceCenter = { x: center.x + sourceOffset.x, y: center.y + sourceOffset.y };
      const orderedMembers = [...sourceMembers].sort((left, right) =>
        Number(right.kind === "source" || right.kind === "folder") - Number(left.kind === "source" || left.kind === "folder")
        || compareText(left.id, right.id));
      const anchor = orderedMembers.find((node) => node.kind === "source" || node.kind === "folder") ?? orderedMembers[0]!;
      positions.set(anchor.id, sourceCenter);
      const satellites = orderedMembers.filter((node) => node.id !== anchor.id);
      for (const [satelliteIndex, node] of satellites.entries()) {
        const orbit = localPoint(satelliteIndex, satellites.length, 42 + Math.sqrt(satellites.length) * 13, hashPhase(`${key}:${source}`));
        positions.set(node.id, { x: sourceCenter.x + orbit.x, y: sourceCenter.y + orbit.y });
      }
    }
  }
  return Object.freeze({
    ...graph,
    nodes: Object.freeze(graph.nodes.map((node) => {
      const position = positions.get(node.id);
      return position ? Object.freeze({ ...node, ...position }) : node;
    })),
  });
}
