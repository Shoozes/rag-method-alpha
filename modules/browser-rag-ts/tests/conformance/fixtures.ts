import { recordFromMapping } from "../../src/core/shared/types.js";

export function conformanceRecord(
  id: string,
  text: string,
  overrides: Record<string, unknown> = {},
) {
  return recordFromMapping({
    id,
    text,
    source_id: `source-${id}`,
    source_name: `${id}.md`,
    path: `${id}.md`,
    pocket: "conformance",
    scopes: ["global"],
    authority: "workspace_record",
    priority: 0,
    provenance: { file_source: true, chunk_source: true },
    references: [],
    embedding_profile_id: null,
    ...overrides,
  });
}
