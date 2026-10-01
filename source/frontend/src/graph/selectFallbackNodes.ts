import type { GraphLink, GraphNode } from "../types/rag";

export const MAX_FALLBACK_NODES = 24;

type FallbackSelectionOptions = {
  nodes: readonly GraphNode[];
  links: readonly GraphLink[];
  selectedNodeId: string | null;
  hitScores: Readonly<Record<string, number>>;
  limit?: number;
};

export type FallbackNodeSelection = {
  nodes: GraphNode[];
  selectedMissing: boolean;
  hitRanks: ReadonlyMap<string, number>;
};

function referenceId(value: string | GraphNode): string {
  return typeof value === "string" ? value : value.id;
}

export function selectFallbackNodes({
  nodes,
  links,
  selectedNodeId,
  hitScores,
  limit = MAX_FALLBACK_NODES,
}: FallbackSelectionOptions): FallbackNodeSelection {
  const boundedLimit = Math.max(0, Math.min(MAX_FALLBACK_NODES, Math.trunc(limit)));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const sourceOrder = new Map(nodes.map((node, index) => [node.id, index]));
  const selected = new Set<string>();
  const result: GraphNode[] = [];
  const add = (id: string) => {
    const node = nodeById.get(id);
    if (!node || selected.has(id) || result.length >= boundedLimit) return;
    selected.add(id);
    result.push(node);
  };

  add(selectedNodeId || "");

  const rankedHits = Object.entries(hitScores)
    .filter(([id, score]) => nodeById.has(id) && Number.isFinite(score))
    .sort(
      ([leftId, leftScore], [rightId, rightScore]) =>
        rightScore - leftScore
        || (sourceOrder.get(leftId) ?? Number.MAX_SAFE_INTEGER)
          - (sourceOrder.get(rightId) ?? Number.MAX_SAFE_INTEGER),
    );
  const hitRanks = new Map(rankedHits.map(([id], index) => [id, index + 1]));
  for (const [id] of rankedHits) add(id);

  if (selectedNodeId && nodeById.has(selectedNodeId)) {
    for (const link of links) {
      const source = referenceId(link.source);
      const target = referenceId(link.target);
      if (source === selectedNodeId) add(target);
      else if (target === selectedNodeId) add(source);
      if (result.length >= boundedLimit) break;
    }
  }

  for (const node of nodes) add(node.id);

  return {
    nodes: result,
    selectedMissing: Boolean(selectedNodeId && !nodeById.has(selectedNodeId)),
    hitRanks,
  };
}
