import type { GetContextResult } from "../worker/protocol.js";
import type { RetrievalObservation } from "../reports/reportTypes.js";

export function assertContextMatches(context: GetContextResult, queryId: string, query: string, observation: RetrievalObservation): void {
  if (context.query_id !== queryId || context.query !== query || context.estimated_tokens !== observation.context_tokens
    || JSON.stringify(context.chunks.map(({ id }) => id)) !== JSON.stringify(observation.context_selected_ids)) {
    throw new Error("Context does not match the accepted retrieval.");
  }
}

/** The displayed and copied application packet; chunk text is never shortened or normalized. */
export function formatContextPacket(context: GetContextResult): string {
  return [`Query: ${context.query}`, ...context.chunks.map((chunk, index) =>
    `[${index + 1}] ${chunk.path} · ${chunk.heading}\nRecord: ${chunk.id}\nSource: ${chunk.source_id}\n\n${chunk.text}`)].join("\n\n");
}
