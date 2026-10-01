import { FROZEN_RETRIEVAL_POLICY } from "../core/shared/frozenBehaviorPolicy.js";
import { recordFromMapping } from "../core/shared/types.js";
import { assertValidUnicodeScalars } from "../core/shared/unicode.js";

export type WorkerReportKind = "indexing" | "retrieval" | "query";

export interface WorkerReportIdentity {
  readonly implementation: "rag-method-browser-ts-worker";
  readonly language: "typescript";
  readonly module_version: string;
}

export interface WorkerContractIdentity {
  readonly id: "rag-indexing-v1" | "rag-behavior-v2";
  readonly version: number;
  readonly runtime_snapshot_digest: string;
  readonly input_digests: Readonly<Record<string, string>>;
}

export interface RetrievalObservation {
  readonly eligible_ids: readonly string[];
  readonly candidate_ids: readonly string[];
  readonly ordered_ids: readonly string[];
  readonly scores: readonly {
    readonly id: string;
    readonly score_micro: number;
    readonly components: Readonly<Record<"exact_micro" | "semantic_micro" | "keyword_micro" | "scope_micro" | "provenance_micro" | "authority_micro" | "priority_micro" | "aspect_coverage_micro" | "cross_reference_micro", number>>;
    readonly cross_reference_from_id: string | null;
  }[];
  readonly context_selected_ids: readonly string[];
  readonly context_tokens: number;
  readonly truncated: boolean;
  readonly semantic_state: "not_requested" | "ready" | "disabled_by_settings" | "lexical_fallback";
  readonly semantic_fallback_reason: "disabled_by_settings" | "no_compatible_vectors" | "embedding_failed" | null;
  readonly errors: readonly string[];
}

export interface WorkerActualCase {
  readonly id: string;
  readonly mode?: string;
  readonly actual: object;
}

export interface WorkerActualReport {
  readonly schema: "browser-rag-ts-worker-actual-report-v1";
  readonly protocol_version: 1;
  readonly kind: "indexing" | "retrieval";
  readonly identity: WorkerReportIdentity;
  readonly contract: WorkerContractIdentity;
  readonly summary: { readonly cases: number; readonly errors: number };
  readonly results: readonly WorkerActualCase[];
}

export interface WorkerQueryReport {
  readonly schema: "browser-rag-ts-worker-query-report-v1";
  readonly protocol_version: 1;
  readonly kind: "query";
  readonly identity: WorkerReportIdentity;
  readonly contract: WorkerContractIdentity;
  readonly query: string;
  readonly observation: RetrievalObservation;
}

export type WorkerExportReport = WorkerActualReport | WorkerQueryReport;

const SCORE_COMPONENT_KEYS = [
  "exact_micro", "semantic_micro", "keyword_micro", "scope_micro", "provenance_micro",
  "authority_micro", "priority_micro", "aspect_coverage_micro", "cross_reference_micro",
] as const;

function plainObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`${label} must be a plain object`);
  return value as Record<string, unknown>;
}

function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  const object = plainObject(value, label);
  const actual = Object.keys(object).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`${label} fields are invalid`);
  return object;
}

function text(value: unknown, label: string, maximum = 16_384): string {
  if (typeof value !== "string" || !value || value.length > maximum) throw new Error(`${label} must be a bounded non-empty string`);
  assertValidUnicodeScalars(value, label);
  return value;
}

function digest(value: unknown, label: string): string {
  const result = text(value, label, 64);
  if (!/^[0-9a-f]{64}$/.test(result)) throw new Error(`${label} must be a SHA-256 digest`);
  return result;
}

function nonNegativeInteger(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error(`${label} must be a bounded non-negative integer`);
  return value;
}

function stringArray(value: unknown, label: string, maximum = 50_000): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${label} must be a bounded string array`);
  return value.map((item, index) => text(item, `${label}[${index}]`));
}

function actualIsError(value: object): boolean {
  return plainObject(value, "Worker actual observation").status === "error";
}

function validateIndexingActual(value: unknown): object {
  const candidate = plainObject(value, "Worker indexing observation");
  if (candidate.status === "error") {
    const error = exactObject(candidate, ["status", "error"], "Worker indexing error observation");
    const details = exactObject(error.error, ["code"], "Worker indexing error details");
    text(details.code, "Worker indexing error code", 128);
    return Object.freeze({ status: "error", error: Object.freeze({ code: details.code }) });
  }
  if (candidate.status !== "ok") throw new Error("Worker indexing observation status is invalid");
  const success = exactObject(candidate, ["status", "document"], "Worker indexing success observation");
  const raw = exactObject(success.document, ["format", "path", "pocket", "scopes", "authority", "priority", "source_id", "source_content_id", "source_utf8_bytes", "canonical_content_id", "canonical_scalar_count", "normalization", "limits", "records"], "Worker indexing document observation");
  if (raw.format !== "markdown" && raw.format !== "text") throw new Error("Worker indexing format is invalid");
  for (const field of ["path", "pocket", "authority"] as const) text(raw[field], `Worker indexing ${field}`, 256);
  stringArray(raw.scopes, "Worker indexing scopes", 16);
  if (typeof raw.priority !== "number" || !Number.isInteger(raw.priority) || raw.priority < -100 || raw.priority > 100) throw new Error("Worker indexing priority is invalid");
  for (const field of ["source_id", "source_content_id", "canonical_content_id"] as const) digest(raw[field], `Worker indexing ${field}`);
  nonNegativeInteger(raw.source_utf8_bytes, "Worker indexing source_utf8_bytes", 10 * 1024 * 1024);
  nonNegativeInteger(raw.canonical_scalar_count, "Worker indexing canonical_scalar_count", 10 * 1024 * 1024);
  const normalization = exactObject(raw.normalization, ["bom_removed", "line_endings_changed", "frontmatter_removed"], "Worker indexing normalization");
  if (Object.values(normalization).some((item) => typeof item !== "boolean")) throw new Error("Worker indexing normalization is invalid");
  const limits = exactObject(raw.limits, ["max_chars", "max_tokens"], "Worker indexing limits");
  nonNegativeInteger(limits.max_chars, "Worker indexing max_chars", 1_000_000);
  nonNegativeInteger(limits.max_tokens, "Worker indexing max_tokens", 1_000_000);
  if (!Array.isArray(raw.records) || raw.records.length > 50_000) throw new Error("Worker indexing records are invalid");
  for (const record of raw.records) recordFromMapping(record);
  return Object.freeze({ status: "ok", document: raw });
}

export function validateWorkerContractIdentity(value: unknown): WorkerContractIdentity {
  const raw = exactObject(value, ["id", "version", "runtime_snapshot_digest", "input_digests"], "Worker contract identity");
  if (raw.id !== "rag-indexing-v1" && raw.id !== "rag-behavior-v2") throw new Error("Worker contract identity id is invalid");
  const inputDigests = plainObject(raw.input_digests, "Worker contract identity input_digests");
  const digests = Object.fromEntries(Object.keys(inputDigests).sort().map((path) => [text(path, "Worker contract input path", 512), digest(inputDigests[path], `Worker contract input digest ${path}`)]));
  if (!Object.keys(digests).length) throw new Error("Worker contract identity must contain input digests");
  return Object.freeze({
    id: raw.id,
    version: nonNegativeInteger(raw.version, "Worker contract version", 1_000),
    runtime_snapshot_digest: digest(raw.runtime_snapshot_digest, "Worker runtime snapshot digest"),
    input_digests: Object.freeze(digests),
  });
}

function validateWorkerReportIdentity(value: unknown): WorkerReportIdentity {
  const raw = exactObject(value, ["implementation", "language", "module_version"], "Worker report identity");
  if (raw.implementation !== "rag-method-browser-ts-worker" || raw.language !== "typescript") throw new Error("Worker report identity is invalid");
  return Object.freeze({ implementation: raw.implementation, language: raw.language, module_version: text(raw.module_version, "Worker module version", 64) });
}

export function validateRetrievalObservation(value: unknown): RetrievalObservation {
  const raw = exactObject(value, ["eligible_ids", "candidate_ids", "ordered_ids", "scores", "context_selected_ids", "context_tokens", "truncated", "semantic_state", "semantic_fallback_reason", "errors"], "retrieval observation");
  const scoresValue = raw.scores;
  if (!Array.isArray(scoresValue) || scoresValue.length > 100) throw new Error("retrieval observation scores are invalid");
  const scores = scoresValue.map((value, index) => {
    const score = exactObject(value, ["id", "score_micro", "components", "cross_reference_from_id"], `retrieval observation score ${index}`);
    const components = exactObject(score.components, SCORE_COMPONENT_KEYS, `retrieval observation score ${index} components`);
    const parsedComponents = Object.fromEntries(SCORE_COMPONENT_KEYS.map((name) => {
      const item = components[name];
      if (typeof item !== "number" || !Number.isSafeInteger(item) || item < -1_000_000 || item > 1_000_000) throw new Error(`retrieval observation score ${index} component ${name} is invalid`);
      return [name, item];
    })) as RetrievalObservation["scores"][number]["components"];
    if (typeof score.score_micro !== "number" || !Number.isSafeInteger(score.score_micro) || score.score_micro < 0 || score.score_micro > 1_000_000) throw new Error(`retrieval observation score ${index} is invalid`);
    if (score.cross_reference_from_id !== null && typeof score.cross_reference_from_id !== "string") throw new Error(`retrieval observation score ${index} reference is invalid`);
    return Object.freeze({ id: text(score.id, `retrieval observation score ${index} id`, 128), score_micro: score.score_micro, components: Object.freeze(parsedComponents), cross_reference_from_id: score.cross_reference_from_id === null ? null : text(score.cross_reference_from_id, `retrieval observation score ${index} reference`, 128) });
  });
  const ordered = stringArray(raw.ordered_ids, "retrieval observation ordered_ids");
  if (JSON.stringify(ordered) !== JSON.stringify(scores.map((score) => score.id))) throw new Error("retrieval observation ordered_ids do not match scores");
  const semanticState = raw.semantic_state;
  if (!FROZEN_RETRIEVAL_POLICY.semantic_states.includes(semanticState as never)) throw new Error("retrieval observation semantic_state is invalid");
  const fallback = raw.semantic_fallback_reason;
  if (fallback !== null && !FROZEN_RETRIEVAL_POLICY.fallback_reasons.includes(fallback as never)) throw new Error("retrieval observation semantic_fallback_reason is invalid");
  if (typeof raw.truncated !== "boolean") throw new Error("retrieval observation truncated is invalid");
  return Object.freeze({
    eligible_ids: stringArray(raw.eligible_ids, "retrieval observation eligible_ids"),
    candidate_ids: stringArray(raw.candidate_ids, "retrieval observation candidate_ids"),
    ordered_ids: ordered,
    scores,
    context_selected_ids: stringArray(raw.context_selected_ids, "retrieval observation context_selected_ids"),
    context_tokens: nonNegativeInteger(raw.context_tokens, "retrieval observation context_tokens", 1_800),
    truncated: raw.truncated,
    semantic_state: semanticState as RetrievalObservation["semantic_state"],
    semantic_fallback_reason: fallback as RetrievalObservation["semantic_fallback_reason"],
    errors: stringArray(raw.errors, "retrieval observation errors"),
  });
}

export function validateWorkerActualReport(value: unknown, kind?: "indexing" | "retrieval"): WorkerActualReport {
  const raw = exactObject(value, ["schema", "protocol_version", "kind", "identity", "contract", "summary", "results"], "Worker actual report");
  if (raw.schema !== "browser-rag-ts-worker-actual-report-v1" || raw.protocol_version !== 1 || (raw.kind !== "indexing" && raw.kind !== "retrieval") || (kind !== undefined && raw.kind !== kind)) throw new Error("Worker actual report identity is invalid");
  const summary = exactObject(raw.summary, ["cases", "errors"], "Worker actual report summary");
  if (!Array.isArray(raw.results) || raw.results.length !== nonNegativeInteger(summary.cases, "Worker actual report cases", 50_000)) throw new Error("Worker actual report cases are invalid");
  const results = raw.results.map((value, index) => {
    const item = plainObject(value, `Worker actual report result ${index}`);
    const keys = Object.keys(item).sort();
    const expected = Object.prototype.hasOwnProperty.call(item, "mode") ? ["actual", "id", "mode"] : ["actual", "id"];
    if (JSON.stringify(keys) !== JSON.stringify(expected)) throw new Error(`Worker actual report result ${index} fields are invalid`);
    if (item.mode !== undefined && typeof item.mode !== "string") throw new Error(`Worker actual report result ${index} mode is invalid`);
    const actual = raw.kind === "retrieval" ? validateRetrievalObservation(item.actual) : validateIndexingActual(item.actual);
    return Object.freeze({ id: text(item.id, `Worker actual report result ${index} id`, 256), ...(item.mode === undefined ? {} : { mode: text(item.mode, `Worker actual report result ${index} mode`, 128) }), actual });
  });
  const errors = results.filter((result) => actualIsError(result.actual)).length;
  if (nonNegativeInteger(summary.errors, "Worker actual report errors", results.length) !== errors) throw new Error("Worker actual report error summary is invalid");
  return Object.freeze({ schema: raw.schema, protocol_version: 1, kind: raw.kind, identity: validateWorkerReportIdentity(raw.identity), contract: validateWorkerContractIdentity(raw.contract), summary: Object.freeze({ cases: results.length, errors }), results });
}

export function validateWorkerQueryReport(value: unknown): WorkerQueryReport {
  const raw = exactObject(value, ["schema", "protocol_version", "kind", "identity", "contract", "query", "observation"], "Worker query report");
  if (raw.schema !== "browser-rag-ts-worker-query-report-v1" || raw.protocol_version !== 1 || raw.kind !== "query") throw new Error("Worker query report identity is invalid");
  return Object.freeze({ schema: raw.schema, protocol_version: 1, kind: "query", identity: validateWorkerReportIdentity(raw.identity), contract: validateWorkerContractIdentity(raw.contract), query: text(raw.query, "Worker query report query", 16_384), observation: validateRetrievalObservation(raw.observation) });
}

export function validateWorkerExportReport(value: unknown): WorkerExportReport {
  const raw = plainObject(value, "Worker export report");
  if (raw.kind === "query") return validateWorkerQueryReport(raw);
  return validateWorkerActualReport(raw);
}

export function workerActualReport(
  kind: "indexing" | "retrieval",
  contract: WorkerContractIdentity,
  moduleVersion: string,
  results: readonly WorkerActualCase[],
): WorkerActualReport {
  return validateWorkerActualReport({
    schema: "browser-rag-ts-worker-actual-report-v1",
    protocol_version: 1,
    kind,
    identity: { implementation: "rag-method-browser-ts-worker", language: "typescript", module_version: moduleVersion },
    contract,
    summary: { cases: results.length, errors: results.filter((result) => actualIsError(result.actual)).length },
    results: [...results],
  }, kind);
}

export function workerQueryReport(
  contract: WorkerContractIdentity,
  moduleVersion: string,
  query: string,
  observation: RetrievalObservation,
): WorkerQueryReport {
  return validateWorkerQueryReport({
    schema: "browser-rag-ts-worker-query-report-v1",
    protocol_version: 1,
    kind: "query",
    identity: { implementation: "rag-method-browser-ts-worker", language: "typescript", module_version: moduleVersion },
    contract,
    query,
    observation,
  });
}
