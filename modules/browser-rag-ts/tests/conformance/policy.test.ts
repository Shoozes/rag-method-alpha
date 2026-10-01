import test from "node:test";
import assert from "node:assert/strict";
import { CONTRACT_RUNTIME } from "../../src/contracts/generated/runtime.js";
import { assertFrozenRetrievalProfile } from "../../src/core/retrieval/profile.js";

function profile(): Record<string, unknown> {
  return structuredClone(CONTRACT_RUNTIME.contracts["rag-behavior-v2"].files["retrieval-profile.json"].data) as Record<string, unknown>;
}

test("every frozen policy group fails closed on mutation, omission, and unknown keys", () => {
  assertFrozenRetrievalProfile(profile());
  const mutations: Array<(value: Record<string, unknown>) => void> = [
    (value) => { value.status = "open"; },
    (value) => { (value.identity as Record<string, unknown>).digest = "sha1"; },
    (value) => { (value.normalization as Record<string, unknown>).exact = "lowercase"; },
    (value) => { (value.embedding as Record<string, unknown>).fixture_dimension = 8; },
    (value) => { (value.scoring as Record<string, unknown>).exact_weight_micro = 1; },
    (value) => { ((value.authority as Record<string, unknown>).component_micro as Record<string, unknown>).unclassified = 1; },
    (value) => { (value.scope as Record<string, unknown>).deny_first = false; },
    (value) => { (value.references as Record<string, unknown>).max_expansions = 3; },
    (value) => { (value.selection as Record<string, unknown>).max_chunks_per_source = 1; },
    (value) => { (value.context as Record<string, unknown>).max_rag_context_tokens = 1; },
    (value) => { (value.limits as Record<string, unknown>).max_top_k = 99; },
    (value) => { (value.semantic_states as unknown[]).pop(); },
    (value) => { (value.fallback_reasons as unknown[]).pop(); },
    (value) => { (value.modes as unknown[]).pop(); },
    (value) => { (value.cancellation_checkpoints as unknown[]).pop(); },
    (value) => { delete value.status; },
    (value) => { value.unexpected = true; },
  ];
  for (const mutate of mutations) {
    const value = profile();
    mutate(value);
    assert.throws(() => assertFrozenRetrievalProfile(value));
  }
});
