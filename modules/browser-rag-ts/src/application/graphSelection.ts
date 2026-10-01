import type { PositionedGraphNode } from "./layoutGraph.js";

export interface GraphSelectionState {
  readonly selectedRecordId: string | null;
  readonly selectedSourceId: string | null;
  readonly selectedFolderPath: string | null;
}

export interface ResolvedGraphInteraction {
  readonly selectedNodeId: string | null;
  readonly hitNodeIds: readonly string[];
}

export function resolveSelectedGraphNode(
  nodes: readonly PositionedGraphNode[],
  selection: GraphSelectionState,
): PositionedGraphNode | null {
  if (selection.selectedRecordId !== null) {
    const exact = nodes.find((node) => node.record_id === selection.selectedRecordId);
    if (exact) return exact;
    if (selection.selectedSourceId !== null) {
      const source = nodes.find((node) => node.kind === "source" && node.source_id === selection.selectedSourceId);
      if (source) return source;
    }
  } else if (selection.selectedSourceId !== null) {
    const source = nodes.find((node) => node.kind === "source" && node.source_id === selection.selectedSourceId);
    if (source) return source;
  }
  if (selection.selectedRecordId === null && selection.selectedSourceId === null && selection.selectedFolderPath !== null) {
    return nodes.find((node) => node.kind === "folder" && node.path === selection.selectedFolderPath) ?? null;
  }
  return null;
}

export function resolveGraphInteraction(
  nodes: readonly PositionedGraphNode[],
  selection: GraphSelectionState,
  hitRecordIds: readonly string[],
  recordSourceIds: ReadonlyMap<string, string>,
): ResolvedGraphInteraction {
  const selected = resolveSelectedGraphNode(nodes, selection);
  const hits = new Set(hitRecordIds);
  const hitSources = new Set(hitRecordIds.flatMap((recordId) => {
    const sourceId = recordSourceIds.get(recordId);
    return sourceId ? [sourceId] : [];
  }));
  return Object.freeze({
    selectedNodeId: selected?.id ?? null,
    hitNodeIds: Object.freeze(nodes.flatMap((node) => (
      (node.record_id !== null && hits.has(node.record_id))
      || (node.kind === "source" && node.source_id !== null && hitSources.has(node.source_id))
        ? [node.id]
        : []
    ))),
  });
}
