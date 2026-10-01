import test from "node:test";
import assert from "node:assert/strict";
import { RagEngine } from "../../src/core/retrieval/engine.js";
import { assertFrozenRetrievalProfile, FROZEN_RETRIEVAL_POLICY } from "../../src/core/retrieval/profile.js";
import { tokens, validateQueryVector } from "../../src/core/retrieval/scoring.js";
import { DEFAULT_LIMITS, DEFAULT_PROFILE, recordFromMapping } from "../../src/core/shared/types.js";
import { CONTRACT_RUNTIME } from "../../src/contracts/generated/runtime.js";

function record(id: string, sourceName: string, sourceId: string, text: string) {
  return recordFromMapping({ id, text, source_id: sourceId, source_name: sourceName, path: `${id}.md`, pocket: "test", scopes: ["test"], authority: "workspace_record", priority: 0, provenance: { file_source: true, chunk_source: true }, references: [], embedding_profile_id: null });
}

test("duplicate text vectors and supplementary scalar ties remain ID-stable", () => {
  const engine = new RagEngine([
    record("duplicate-b", "𐀀", "source-b", "Shared duplicate content"),
    record("duplicate-a", "", "source-a", "Shared duplicate content"),
  ]);
  const response = engine.search("shared duplicate content", { mode: "exact_only", top_k: 2, include_scopes: ["test"] });
  assert.deepEqual(response.results.map((result) => result.record.id), ["duplicate-a", "duplicate-b"]);
});

test("retrieval exposes every cancellation phase", () => {
  const phases: string[] = [];
  const engine = new RagEngine([record("one", "One.md", "source-one", "cancel beacon")]);
  engine.search("cancel beacon", { mode: "exact_only", top_k: 1, checkpoint: (phase) => phases.push(phase) });
  assert.deepEqual(phases, FROZEN_RETRIEVAL_POLICY.cancellation_checkpoints);
});

test("synchronous and cooperative retrieval share one deterministic result path", async () => {
  const engine = new RagEngine([
    record("first", "First.md", "source-first", "release canary is amber"),
    record("second", "Second.md", "source-second", "release canary is green"),
  ]);
  const options = { mode: "exact_only" as const, top_k: 2, include_scopes: ["test"] };
  const phases: string[] = [];
  const synchronous = engine.search("release canary", options);
  const cooperative = await engine.searchAsync("release canary", options, async (phase) => { phases.push(phase); });
  assert.deepEqual(cooperative, synchronous);
  assert.deepEqual(phases, ["filter.start", "filter.batch", "rank.start", "rank.batch", "cross_reference.before", "cross_reference.batch", "cross_reference.after", "selection.start", "return"]);
});

test("engine rejects profile and limit drift before retrieval", () => {
  const invalidWeight = { ...DEFAULT_PROFILE, exact_weight: 1_000_001 };
  assert.throws(() => new RagEngine([], invalidWeight));
  const invalidLimits = { ...DEFAULT_LIMITS, durable_candidate_limit: 1, memory_candidate_limit: 2 };
  assert.throws(() => new RagEngine([], DEFAULT_PROFILE, invalidLimits));
  assert.throws(() => validateQueryVector(["1"] as unknown));
  assert.throws(() => validateQueryVector([Number.NaN]));
});

test("frozen runtime profile validates every adapter profile and limit field", () => {
  const profile = CONTRACT_RUNTIME.contracts["rag-behavior-v2"].files["retrieval-profile.json"].data;
  assertFrozenRetrievalProfile(profile);
  const drifted = structuredClone(profile) as Record<string, unknown>;
  const scoring = drifted.scoring as Record<string, unknown>;
  scoring.exact_weight_micro = 1;
  assert.throws(() => assertFrozenRetrievalProfile(drifted));
});

test("keyword and exact normalization use Python Unicode properties", () => {
  assert.deepEqual(tokens("copper compass browser marker \u1C89"), ["browser", "compass", "copper", "marker"]);
  const engine = new RagEngine([record("python-unicode", "Unicode.md", "source-unicode", "Copper\u001Ccompass browser marker")]);
  const keyword = engine.search("copper compass browser marker \u1C89", { mode: "keyword_only", top_k: 1, include_scopes: ["test"] });
  assert.equal(keyword.results[0]?.keyword_micro, 1_000_000);
  const exact = engine.search("copper compass browser marker", { mode: "exact_only", top_k: 1, include_scopes: ["test"] });
  assert.equal(exact.results[0]?.exact_micro, 1_000_000);
});
