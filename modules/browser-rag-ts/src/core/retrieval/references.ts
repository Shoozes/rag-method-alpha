import { RagRecord, RetrievalResult } from "../shared/types.js";

export function referenceSignals(orderedCandidates: readonly RetrievalResult[], records: ReadonlyMap<string, RagRecord>, maxExpansions: number, allowedIds: ReadonlySet<string>): ReadonlyMap<string, string> {
  const targets = new Map<string, string>();
  for (const anchor of orderedCandidates.filter((candidate) => candidate.has_retrieval_signal)) {
    for (const targetId of anchor.record.references) {
      if (targets.size >= maxExpansions) return targets;
      const target = records.get(targetId);
      if (!target || !allowedIds.has(targetId) || target.source_id === anchor.record.source_id || targets.has(targetId)) continue;
      targets.set(targetId, anchor.record.id);
    }
  }
  return targets;
}
