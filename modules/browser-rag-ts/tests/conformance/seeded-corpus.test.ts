import test from "node:test";
import assert from "node:assert/strict";
import { RagEngine } from "../../src/core/retrieval/engine.js";
import { conformanceRecord } from "./fixtures.js";

test("seeded corpus handles duplicate text, priorities, scopes, references, and supplementary scalars deterministically", () => {
  const engine = new RagEngine([
    conformanceRecord("duplicate-a", "shared 𐀀 signal", { source_id: "source-a", source_name: "A", priority: -10, scopes: ["global", "workspace:edge"] }),
    conformanceRecord("duplicate-b", "shared 𐀀 signal", { source_id: "source-b", source_name: "B", priority: 10, scopes: ["workspace:edge"] }),
    conformanceRecord("memory", "shared 𐀀 signal", { authority: "conversation_memory", scopes: ["memory"], references: ["duplicate-a"] }),
    conformanceRecord("ref", "other source", { source_id: "source-ref", references: ["duplicate-b"] }),
  ]);
  const response = engine.search("shared 𐀀 signal", { mode: "scoped_hybrid", top_k: 3, include_scopes: ["workspace:edge"], scope_priorities: { "workspace:edge": 25 } });
  assert.deepEqual(response.eligible_ids, ["duplicate-a", "duplicate-b"]);
  assert.deepEqual(response.results.map((result) => result.record.id), ["duplicate-b", "duplicate-a"]);
  assert.equal(response.results.every((result) => result.record.authority !== "conversation_memory"), true);
});
