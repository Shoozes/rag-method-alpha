import { compareUnicodeScalars } from "../core/shared/scalarOrder.js";
import type { RagRecord } from "../core/shared/types.js";

export const MAX_PROJECTED_GRAPH_NODES = 20_000;
export const MAX_PROJECTED_GRAPH_LINKS = 50_000;
export const MAX_GRAPH_LABEL_SCALARS = 160;
const PROJECTION_BATCH_SIZE = 128;

export type RagGraphView = "evidence" | "folders";
export type RagGraphNodeKind = "chunk" | "source" | "folder";
export type RagGraphLinkKind = "contains" | "reference";

export interface RagGraphNode {
  readonly id: string;
  readonly kind: RagGraphNodeKind;
  readonly label: string;
  readonly path: string;
  readonly source_id: string | null;
  readonly record_id: string | null;
}

export interface RagGraphLink {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly kind: RagGraphLinkKind;
}

export interface RagGraphProjection {
  readonly view: RagGraphView;
  readonly nodes: readonly RagGraphNode[];
  readonly links: readonly RagGraphLink[];
  readonly total_nodes: number;
  readonly total_links: number;
  readonly omitted_nodes: number;
  readonly omitted_links: number;
  readonly truncated: boolean;
  readonly omitted_reference_links: number;
}

export type GraphProjectionSteps = Generator<void, RagGraphProjection, void>;

function tupleId(kind: string, ...parts: readonly string[]): string {
  return `${kind}:${parts.map((part) => `${Array.from(part).length}:${part}`).join(":")}`;
}

function sourceNodeId(sourceId: string): string { return tupleId("source", sourceId); }
function chunkNodeId(recordId: string): string { return tupleId("chunk", recordId); }
function folderNodeId(path: string): string { return tupleId("folder", path); }
function linkId(kind: RagGraphLinkKind, source: string, target: string): string { return tupleId(kind, source, target); }

export function graphDisplayLabel(value: unknown, fallback: string): string {
  const normalized = String(value || fallback).trim() || fallback;
  const scalars = Array.from(normalized);
  return scalars.length <= MAX_GRAPH_LABEL_SCALARS
    ? normalized
    : `${scalars.slice(0, MAX_GRAPH_LABEL_SCALARS - 1).join("")}…`;
}

function leaf(path: string): string {
  return graphDisplayLabel((path.split("/").filter(Boolean).at(-1) ?? path) || "Untitled source", "Untitled source");
}

function orderedSources(records: readonly RagRecord[]): readonly RagRecord[] {
  const sources = new Map<string, RagRecord>();
  for (const record of records) if (!sources.has(record.source_id)) sources.set(record.source_id, record);
  return [...sources.values()].sort((left, right) => compareUnicodeScalars(left.source_id, right.source_id));
}

function maybeYield(index: number): boolean {
  return index > 0 && index % PROJECTION_BATCH_SIZE === 0;
}

function* evidenceProjectionSteps(records: readonly RagRecord[]): GraphProjectionSteps {
  yield;
  const ordered = [...records].sort((left, right) => compareUnicodeScalars(left.id, right.id));
  const sources = orderedSources(ordered);
  const nodes: RagGraphNode[] = [];
  const links: RagGraphLink[] = [];
  const includedNodeIds = new Set<string>();
  const includedRecordIds = new Set<string>();
  let omittedNodes = 0;

  const addNode = (node: RagGraphNode): boolean => {
    if (includedNodeIds.has(node.id)) return true;
    if (nodes.length >= MAX_PROJECTED_GRAPH_NODES) {
      omittedNodes += 1;
      return false;
    }
    includedNodeIds.add(node.id);
    nodes.push(Object.freeze(node));
    return true;
  };

  for (let index = 0; index < sources.length; index += 1) {
    const record = sources[index]!;
    addNode({ id: sourceNodeId(record.source_id), kind: "source", label: leaf(record.path || record.source_name), path: record.path, source_id: record.source_id, record_id: null });
    if (maybeYield(index)) yield;
  }
  for (let index = 0; index < ordered.length; index += 1) {
    const record = ordered[index]!;
    const id = chunkNodeId(record.id);
    if (addNode({
      id,
      kind: "chunk",
      label: graphDisplayLabel(record.metadata.heading, `Chunk ${String(record.metadata.chunk_index ?? "")}`),
      path: record.path,
      source_id: record.source_id,
      record_id: record.id,
    })) includedRecordIds.add(record.id);
    if (maybeYield(index)) yield;
  }

  const totalContains = ordered.length;
  for (let index = 0; index < ordered.length; index += 1) {
    const record = ordered[index]!;
    const source = sourceNodeId(record.source_id);
    const target = chunkNodeId(record.id);
    if (includedNodeIds.has(source) && includedNodeIds.has(target) && links.length < MAX_PROJECTED_GRAPH_LINKS) {
      links.push(Object.freeze({ id: linkId("contains", source, target), source, target, kind: "contains" }));
    }
    if (maybeYield(index)) yield;
  }

  let omittedReferenceLinks = 0;
  let totalReferenceLinks = 0;
  const seenReferences = new Set<string>();
  for (let recordIndex = 0; recordIndex < ordered.length; recordIndex += 1) {
    const record = ordered[recordIndex]!;
    for (const target of [...record.references].sort(compareUnicodeScalars)) {
      if (target === record.id) {
        totalReferenceLinks += 1;
        omittedReferenceLinks += 1;
        continue;
      }
      const source = chunkNodeId(record.id);
      const targetNode = chunkNodeId(target);
      const id = linkId("reference", source, targetNode);
      if (seenReferences.has(id)) continue;
      seenReferences.add(id);
      totalReferenceLinks += 1;
      if (!includedRecordIds.has(record.id) || !includedRecordIds.has(target) || links.length >= MAX_PROJECTED_GRAPH_LINKS) {
        omittedReferenceLinks += 1;
        continue;
      }
      links.push(Object.freeze({ id, source, target: targetNode, kind: "reference" }));
    }
    if (maybeYield(recordIndex)) yield;
  }

  const totalNodes = sources.length + ordered.length;
  const totalLinks = totalContains + totalReferenceLinks;
  const omittedLinks = Math.max(0, totalLinks - links.length);
  return Object.freeze({
    view: "evidence",
    nodes: Object.freeze(nodes),
    links: Object.freeze(links),
    total_nodes: totalNodes,
    total_links: totalLinks,
    omitted_nodes: Math.max(omittedNodes, totalNodes - nodes.length),
    omitted_links: omittedLinks,
    truncated: omittedNodes > 0 || omittedLinks > 0,
    omitted_reference_links: omittedReferenceLinks,
  });
}

function* folderProjectionSteps(records: readonly RagRecord[]): GraphProjectionSteps {
  yield;
  const nodes = new Map<string, RagGraphNode>();
  const links = new Map<string, RagGraphLink>();
  const allNodeIds = new Set<string>();
  const allLinkIds = new Set<string>();
  let omittedNodes = 0;
  const addNode = (node: RagGraphNode): void => {
    if (allNodeIds.has(node.id)) return;
    allNodeIds.add(node.id);
    if (nodes.size >= MAX_PROJECTED_GRAPH_NODES) {
      omittedNodes += 1;
      return;
    }
    nodes.set(node.id, Object.freeze(node));
  };
  const addLink = (link: RagGraphLink): void => {
    if (allLinkIds.has(link.id)) return;
    allLinkIds.add(link.id);
    if (links.size >= MAX_PROJECTED_GRAPH_LINKS || !nodes.has(link.source) || !nodes.has(link.target)) return;
    links.set(link.id, Object.freeze(link));
  };

  const rootId = folderNodeId("");
  addNode({ id: rootId, kind: "folder", label: "Collection root", path: "", source_id: null, record_id: null });
  const sources = orderedSources(records);
  for (let recordIndex = 0; recordIndex < sources.length; recordIndex += 1) {
    const record = sources[recordIndex]!;
    let parent = rootId;
    const parts = record.path.split("/").filter(Boolean).slice(0, -1);
    for (let depth = 0; depth < parts.length; depth += 1) {
      const path = parts.slice(0, depth + 1).join("/");
      const id = folderNodeId(path);
      addNode({ id, kind: "folder", label: graphDisplayLabel(parts[depth], "Folder"), path, source_id: null, record_id: null });
      addLink({ id: linkId("contains", parent, id), source: parent, target: id, kind: "contains" });
      parent = id;
    }
    const id = sourceNodeId(record.source_id);
    addNode({ id, kind: "source", label: leaf(record.path || record.source_name), path: record.path, source_id: record.source_id, record_id: null });
    addLink({ id: linkId("contains", parent, id), source: parent, target: id, kind: "contains" });
    if (maybeYield(recordIndex)) yield;
  }

  const orderedNodes = [...nodes.values()].sort((left, right) => compareUnicodeScalars(left.id, right.id));
  const orderedLinks = [...links.values()].sort((left, right) => compareUnicodeScalars(left.id, right.id));
  const omittedLinks = Math.max(0, allLinkIds.size - orderedLinks.length);
  return Object.freeze({
    view: "folders",
    nodes: Object.freeze(orderedNodes),
    links: Object.freeze(orderedLinks),
    total_nodes: allNodeIds.size,
    total_links: allLinkIds.size,
    omitted_nodes: Math.max(omittedNodes, allNodeIds.size - orderedNodes.length),
    omitted_links: omittedLinks,
    truncated: omittedNodes > 0 || omittedLinks > 0,
    omitted_reference_links: 0,
  });
}

export function projectRagGraphSteps(records: readonly RagRecord[], view: RagGraphView = "evidence"): GraphProjectionSteps {
  return view === "folders" ? folderProjectionSteps(records) : evidenceProjectionSteps(records);
}

export function projectRagGraph(records: readonly RagRecord[], view: RagGraphView = "evidence"): RagGraphProjection {
  const steps = projectRagGraphSteps(records, view);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

export async function projectRagGraphAsync(
  records: readonly RagRecord[],
  view: RagGraphView,
  checkpoint: () => void,
  yieldControl: () => Promise<void>,
): Promise<RagGraphProjection> {
  const steps = projectRagGraphSteps(records, view);
  for (;;) {
    checkpoint();
    const next = steps.next();
    if (next.done) return next.value;
    await yieldControl();
  }
}
