import { ContractError } from "../shared/errors.js";
import { FROZEN_RETRIEVAL_POLICY } from "../shared/frozenBehaviorPolicy.js";
import { DEFAULT_LIMITS, DEFAULT_PROFILE, RagLimits, RagProfile, validateRagLimits, validateRagProfile } from "../shared/types.js";

export { DEFAULT_LIMITS, DEFAULT_PROFILE } from "../shared/types.js";
export { FROZEN_RETRIEVAL_POLICY } from "../shared/frozenBehaviorPolicy.js";

function assertExactShape(actual: unknown, expected: unknown, path: string): void {
  if (typeof expected !== "object" || expected === null) {
    if (actual !== expected) throw new ContractError(`frozen retrieval policy mismatch at ${path}`);
    return;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) throw new ContractError(`frozen retrieval policy mismatch at ${path}`);
    for (let index = 0; index < expected.length; index += 1) assertExactShape(actual[index], expected[index], `${path}[${index}]`);
    return;
  }
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) throw new ContractError(`frozen retrieval policy mismatch at ${path}`);
  const source = actual as Record<string, unknown>;
  const expectedObject = expected as Record<string, unknown>;
  const actualKeys = Object.keys(source).sort();
  const expectedKeys = Object.keys(expectedObject).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new ContractError(`frozen retrieval policy fields mismatch at ${path}`);
  }
  for (const key of expectedKeys) assertExactShape(source[key], expectedObject[key], `${path}.${key}`);
}

function frozenAdapterProfile(): RagProfile {
  return {
    name: FROZEN_RETRIEVAL_POLICY.profile_id,
    version: 2,
    exact_weight: FROZEN_RETRIEVAL_POLICY.scoring.exact_weight_micro,
    semantic_weight: FROZEN_RETRIEVAL_POLICY.scoring.semantic_weight_micro,
    keyword_weight: FROZEN_RETRIEVAL_POLICY.scoring.keyword_weight_micro,
    scope_weight: FROZEN_RETRIEVAL_POLICY.scoring.scope_weight_micro,
    provenance_weight: FROZEN_RETRIEVAL_POLICY.scoring.provenance_weight_micro,
    authority_weight: FROZEN_RETRIEVAL_POLICY.scoring.authority_weight_micro,
    priority_weight: FROZEN_RETRIEVAL_POLICY.scoring.priority_weight_micro,
    aspect_coverage_weight: FROZEN_RETRIEVAL_POLICY.scoring.aspect_coverage_weight_micro,
    reference_weight: FROZEN_RETRIEVAL_POLICY.scoring.cross_reference_weight_micro,
    semantic_min_score: FROZEN_RETRIEVAL_POLICY.embedding.semantic_min_score_micro,
    authority_scores: FROZEN_RETRIEVAL_POLICY.authority.component_micro,
  };
}

function frozenAdapterLimits(): RagLimits {
  return {
    max_query_chars: FROZEN_RETRIEVAL_POLICY.limits.max_query_chars,
    max_query_utf8_bytes: FROZEN_RETRIEVAL_POLICY.limits.max_query_utf8_bytes,
    max_records: FROZEN_RETRIEVAL_POLICY.limits.max_records,
    max_top_k: FROZEN_RETRIEVAL_POLICY.limits.max_top_k,
    max_context_tokens: FROZEN_RETRIEVAL_POLICY.context.max_rag_context_tokens,
    max_reference_expansion: FROZEN_RETRIEVAL_POLICY.references.max_expansions,
    max_per_source: FROZEN_RETRIEVAL_POLICY.selection.max_chunks_per_source,
    durable_candidate_limit: FROZEN_RETRIEVAL_POLICY.selection.durable_candidate_limit,
    memory_candidate_limit: FROZEN_RETRIEVAL_POLICY.selection.memory_candidate_limit,
  };
}

/**
 * Fail closed unless both generated runtime input and the adapter defaults are
 * exact structural matches for the frozen retrieval profile.
 */
export function assertFrozenRetrievalProfile(
  runtimeProfile: unknown,
  profile: RagProfile = DEFAULT_PROFILE,
  limits: RagLimits = DEFAULT_LIMITS,
): void {
  assertExactShape(runtimeProfile, FROZEN_RETRIEVAL_POLICY, "retrieval-profile.json");
  assertExactShape(validateRagProfile(profile), frozenAdapterProfile(), "adapter profile");
  assertExactShape(validateRagLimits(limits), frozenAdapterLimits(), "adapter limits");
}
