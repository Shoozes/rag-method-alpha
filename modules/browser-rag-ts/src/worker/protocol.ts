import { validateQuery } from "../core/retrieval/query.js";
import { validateQueryVector } from "../core/retrieval/scoring.js";
import { normalizeSourcePath } from "../core/indexing/normalize.js";
import { encodeUtf8 } from "../core/shared/utf8.js";
import { assertValidUnicodeScalars } from "../core/shared/unicode.js";
import { RetrievalObservation, WorkerActualReport, WorkerContractIdentity, WorkerExportReport, validateRetrievalObservation, validateWorkerActualReport, validateWorkerContractIdentity, validateWorkerExportReport } from "../reports/reportTypes.js";
import type { RagGraphLink, RagGraphView } from "../application/graphProjection.js";
import { MAX_VISIBLE_GRAPH_LINKS, MAX_VISIBLE_GRAPH_NODES, PositionedGraph, PositionedGraphNode } from "../application/layoutGraph.js";

export const WORKER_PROTOCOL_VERSION = 1;
export const MAX_REQUEST_ID_LENGTH = 128;
export const MAX_BROWSER_DOCUMENTS = 1_200;
export const MAX_BROWSER_SOURCE_UTF8_BYTES = 6 * 1024 * 1024;
export const MAX_BROWSER_DOCUMENT_UTF8_BYTES = 1024 * 1024;
export const MAX_BROWSER_RECORDS = 16_000;
export const MAX_BROWSER_EXCERPT_SCALARS = 180;

export type WorkerOperation = "initialize" | "load-documents" | "get-source" | "get-context" | "get-graph" | "run-indexing-contract" | "run-retrieval-contract" | "search" | "cancel" | "export-report" | "dispose";
export type WorkerContract = "rag-indexing-v1" | "rag-behavior-v2" | null;
export type WorkerErrorCode = "invalid_request" | "invalid_payload" | "unsupported_operation" | "duplicate_request_id" | "operation_busy" | "cancelled" | "disposed" | "not_initialized" | "worker_failed" | "contract_mismatch";

export interface InitializePayload { readonly synthetic_record_count?: number; }
export interface BrowserDocumentPayload {
  readonly path: string;
  readonly format: "markdown" | "text";
  readonly content: string;
  readonly metadata?: BrowserDocumentMetadata;
}
export interface BrowserDocumentMetadata {
  readonly title?: string;
  readonly original_path?: string;
  readonly source_url?: string;
  readonly content_sha256?: string;
}
export interface LoadDocumentsPayload { readonly documents: readonly BrowserDocumentPayload[]; }
export interface GetSourcePayload { readonly record_id?: string; readonly source_id?: string; }
export interface GetContextPayload { readonly query_id: string; readonly expected_query: string; readonly expected_record_ids: readonly string[]; }
export interface GetContextResult {
  readonly query_id: string;
  readonly query: string;
  readonly estimated_tokens: number;
  readonly chunks: readonly { readonly id: string; readonly source_id: string; readonly path: string; readonly heading: string; readonly text: string }[];
}
export interface GetGraphPayload {
  readonly view?: RagGraphView;
  readonly preferred_record_ids?: readonly string[];
  readonly request_generation?: number;
}
export interface SearchOptionsPayload {
  readonly mode?: "exact_only" | "semantic_only" | "keyword_only" | "hybrid" | "scoped_hybrid";
  readonly top_k?: number;
  readonly include_scopes?: readonly string[];
  readonly exclude_scopes?: readonly string[];
  readonly scope_priorities?: Readonly<Record<string, number>>;
  readonly authority_policy?: "all" | "recorded_only";
  readonly vectors?: Readonly<Record<string, readonly number[]>>;
  readonly query_vector?: readonly number[];
  readonly query_embedding_profile_id?: string;
  readonly fixture_query_vector_id?: string;
  readonly semantic_enabled?: boolean;
  readonly semantic_fallback_reason?: "disabled_by_settings" | "no_compatible_vectors" | "embedding_failed";
  readonly expand?: boolean;
  readonly max_context_tokens?: number;
}
export interface SearchPayload { readonly query: string; readonly options?: SearchOptionsPayload; }
export interface CancelPayload { readonly request_id: string; }
export type ExportReportPayload =
  | { readonly kind: "indexing" | "retrieval" }
  | { readonly kind: "query"; readonly expected_query: string };

interface RequestBase<O extends WorkerOperation, P> {
  readonly version: 1;
  readonly request_id: string;
  readonly operation: O;
  readonly payload: P;
}

export type WorkerRequest =
  | RequestBase<"initialize", InitializePayload | undefined>
  | RequestBase<"load-documents", LoadDocumentsPayload>
  | RequestBase<"get-source", GetSourcePayload>
  | RequestBase<"get-context", GetContextPayload>
  | RequestBase<"get-graph", GetGraphPayload | undefined>
  | RequestBase<"run-indexing-contract", undefined>
  | RequestBase<"run-retrieval-contract", undefined>
  | RequestBase<"search", SearchPayload>
  | RequestBase<"cancel", CancelPayload>
  | RequestBase<"export-report", ExportReportPayload>
  | RequestBase<"dispose", undefined>;

export interface InitializeResult {
  readonly status: "initialized";
  readonly records: number;
  readonly synthetic_record_count: number | null;
  readonly contracts: Readonly<{ readonly indexing: WorkerContractIdentity; readonly retrieval: WorkerContractIdentity }>;
  readonly chunks: readonly BrowserDocumentChunk[];
}

export interface BrowserDocumentChunk {
  readonly id: string;
  readonly source_id: string;
  readonly path: string;
  readonly excerpt: string;
  readonly heading: string;
  readonly heading_level: number;
}

export interface LoadDocumentsResult {
  readonly status: "loaded";
  readonly documents: number;
  readonly records: number;
  readonly source_utf8_bytes: number;
  readonly chunks: readonly BrowserDocumentChunk[];
}

export interface GetSourceResult {
  readonly source_id: string;
  readonly record_id: string | null;
  readonly path: string;
  readonly title: string;
  readonly heading: string | null;
  readonly heading_level: number | null;
  readonly content: string;
  readonly source_url: string | null;
  readonly original_path: string | null;
  readonly content_sha256: string | null;
}

export interface CancelResult { readonly cancelled: string | null; }
export interface DisposeResult { readonly disposed: true; }
export interface WorkerProgress {
  readonly phase: "indexing" | "resolving";
  readonly completed: number;
  readonly total: number;
}

export interface WorkerResultByOperation {
  readonly initialize: InitializeResult;
  readonly "load-documents": LoadDocumentsResult;
  readonly "get-source": GetSourceResult;
  readonly "get-context": GetContextResult;
  readonly "get-graph": PositionedGraph;
  readonly "run-indexing-contract": WorkerActualReport;
  readonly "run-retrieval-contract": WorkerActualReport;
  readonly search: RetrievalObservation;
  readonly cancel: CancelResult;
  readonly "export-report": WorkerExportReport;
  readonly dispose: DisposeResult;
}

export type WorkerOperationResult<O extends WorkerOperation> = WorkerResultByOperation[O];

export type WorkerResponse =
  | { readonly version: 1; readonly request_id: string; readonly status: "ok"; readonly contract: WorkerContract; readonly result: unknown }
  | { readonly version: 1; readonly request_id: string; readonly status: "progress"; readonly contract: null; readonly result: WorkerProgress }
  | { readonly version: 1; readonly request_id: string; readonly status: "error" | "cancelled"; readonly contract: WorkerContract; readonly error: { readonly code: WorkerErrorCode; readonly message: string } };

export class WorkerProtocolError extends Error {
  constructor(message: string, readonly code: WorkerErrorCode = "invalid_request") {
    super(message);
    this.name = "WorkerProtocolError";
  }
}

function expectedContract(operation: WorkerOperation): WorkerContract {
  if (operation === "run-indexing-contract") return "rag-indexing-v1";
  if (operation === "run-retrieval-contract" || operation === "search") return "rag-behavior-v2";
  return null;
}

function plainObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new WorkerProtocolError(`${label} must be a plain object`, "invalid_payload");
  }
  return value as Record<string, unknown>;
}

function exactObject(value: unknown, allowed: readonly string[], required: readonly string[], label: string): Record<string, unknown> {
  const object = plainObject(value, label);
  const unknown = Object.keys(object).filter((key) => !allowed.includes(key));
  const missing = required.filter((key) => !(key in object));
  if (unknown.length || missing.length) throw new WorkerProtocolError(`${label} has invalid fields`, "invalid_payload");
  return object;
}

function boundedString(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || !value || value.length > maximum) throw new WorkerProtocolError(`${label} must be a non-empty string up to ${maximum} characters`, "invalid_payload");
  try { assertValidUnicodeScalars(value, label); }
  catch (error) { throw new WorkerProtocolError(error instanceof Error ? error.message : `${label} is invalid`, "invalid_payload"); }
  return value;
}

function boundedText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || value.length > maximum) throw new WorkerProtocolError(`${label} must be a string up to ${maximum} characters`, "invalid_payload");
  try { assertValidUnicodeScalars(value, label); }
  catch (error) { throw new WorkerProtocolError(error instanceof Error ? error.message : `${label} is invalid`, "invalid_payload"); }
  return value;
}

function requestId(value: unknown, label = "request_id"): string {
  const id = boundedString(value, label, MAX_REQUEST_ID_LENGTH);
  if (!/^[A-Za-z0-9._:-]+$/.test(id)) throw new WorkerProtocolError(`${label} contains unsupported characters`, "invalid_payload");
  return id;
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) throw new WorkerProtocolError(`${label} must be an integer between ${minimum} and ${maximum}`, "invalid_payload");
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new WorkerProtocolError(`${label} must be a boolean`, "invalid_payload");
  return value;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new WorkerProtocolError(`${label} must be finite`, "invalid_payload");
  return value;
}

function stringArray(value: unknown, label: string, maximum = 64): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) throw new WorkerProtocolError(`${label} must contain at most ${maximum} strings`, "invalid_payload");
  const output = value.map((item) => boundedString(item, `${label} item`, 256));
  if (new Set(output).size !== output.length) throw new WorkerProtocolError(`${label} must not contain duplicate values`, "invalid_payload");
  return output;
}

function vector(value: unknown, label: string): readonly number[] {
  if (!Array.isArray(value) || value.length > 4_096) throw new WorkerProtocolError(`${label} must contain at most 4096 numbers`, "invalid_payload");
  try { return validateQueryVector(value); }
  catch (error) { throw new WorkerProtocolError(error instanceof Error ? error.message : `${label} is invalid`, "invalid_payload"); }
}

function vectorMap(value: unknown, queryVector: readonly number[] | undefined): Readonly<Record<string, readonly number[]>> {
  const object = exactObject(value, Object.keys(plainObject(value, "vectors")), [], "vectors");
  const entries = Object.entries(object);
  if (entries.length > 1_024) throw new WorkerProtocolError("vectors may contain at most 1024 entries", "invalid_payload");
  const output: Record<string, readonly number[]> = {};
  for (const [id, candidate] of entries) {
    boundedString(id, "vector ID", 128);
    const parsed = vector(candidate, `vector ${id}`);
    if (queryVector && parsed.length !== queryVector.length) throw new WorkerProtocolError("vector dimensions must match query_vector", "invalid_payload");
    output[id] = parsed;
  }
  return output;
}

function searchOptions(value: unknown): SearchOptionsPayload {
  const options = exactObject(value, ["mode", "top_k", "include_scopes", "exclude_scopes", "scope_priorities", "authority_policy", "vectors", "query_vector", "query_embedding_profile_id", "fixture_query_vector_id", "semantic_enabled", "semantic_fallback_reason", "expand", "max_context_tokens"], [], "search options");
  const output: Record<string, unknown> = {};
  if (options.mode !== undefined) {
    if (typeof options.mode !== "string" || !["exact_only", "semantic_only", "keyword_only", "hybrid", "scoped_hybrid"].includes(options.mode)) throw new WorkerProtocolError("search mode is invalid", "invalid_payload");
    output.mode = options.mode;
  }
  if (options.top_k !== undefined) output.top_k = integer(options.top_k, "top_k", 1, 100);
  if (options.include_scopes !== undefined) output.include_scopes = stringArray(options.include_scopes, "include_scopes");
  if (options.exclude_scopes !== undefined) output.exclude_scopes = stringArray(options.exclude_scopes, "exclude_scopes");
  if (options.scope_priorities !== undefined) {
    const priorities = plainObject(options.scope_priorities, "scope_priorities");
    if (Object.keys(priorities).length > 64) throw new WorkerProtocolError("scope_priorities may contain at most 64 entries", "invalid_payload");
    output.scope_priorities = Object.fromEntries(Object.entries(priorities).map(([scope, priority]) => [boundedString(scope, "scope priority scope", 256), integer(priority, "scope priority", -100, 100)]));
  }
  if (options.authority_policy !== undefined) {
    if (options.authority_policy !== "all" && options.authority_policy !== "recorded_only") throw new WorkerProtocolError("authority_policy is invalid", "invalid_payload");
    output.authority_policy = options.authority_policy;
  }
  if (options.semantic_enabled !== undefined) output.semantic_enabled = boolean(options.semantic_enabled, "semantic_enabled");
  if (options.semantic_fallback_reason !== undefined) {
    if (typeof options.semantic_fallback_reason !== "string" || !["disabled_by_settings", "no_compatible_vectors", "embedding_failed"].includes(options.semantic_fallback_reason)) throw new WorkerProtocolError("semantic_fallback_reason is invalid", "invalid_payload");
    output.semantic_fallback_reason = options.semantic_fallback_reason;
  }
  if (options.expand !== undefined) output.expand = boolean(options.expand, "expand");
  if (options.max_context_tokens !== undefined) output.max_context_tokens = integer(options.max_context_tokens, "max_context_tokens", 1, 1_800);
  const queryVector = options.query_vector === undefined ? undefined : vector(options.query_vector, "query_vector");
  const vectors = options.vectors === undefined ? undefined : vectorMap(options.vectors, queryVector);
  const embeddingProfile = options.query_embedding_profile_id === undefined ? undefined : boundedString(options.query_embedding_profile_id, "query_embedding_profile_id", 128);
  const fixtureVector = options.fixture_query_vector_id === undefined ? undefined : boundedString(options.fixture_query_vector_id, "fixture_query_vector_id", 128);
  if (queryVector !== undefined || vectors !== undefined || embeddingProfile !== undefined) {
    if (!queryVector || !vectors || !embeddingProfile) throw new WorkerProtocolError("query_vector, vectors, and query_embedding_profile_id must be supplied together", "invalid_payload");
    if (fixtureVector !== undefined) throw new WorkerProtocolError("fixture_query_vector_id cannot be combined with direct vectors", "invalid_payload");
    output.query_vector = queryVector;
    output.vectors = vectors;
    output.query_embedding_profile_id = embeddingProfile;
  }
  if (fixtureVector !== undefined) output.fixture_query_vector_id = fixtureVector;
  return output as SearchOptionsPayload;
}

function browserDocuments(value: unknown): LoadDocumentsPayload {
  const payload = exactObject(value, ["documents"], ["documents"], "load-documents payload");
  if (!Array.isArray(payload.documents) || payload.documents.length < 1 || payload.documents.length > MAX_BROWSER_DOCUMENTS) {
    throw new WorkerProtocolError(`documents must contain between 1 and ${MAX_BROWSER_DOCUMENTS} items`, "invalid_payload");
  }
  const paths = new Set<string>();
  let totalBytes = 0;
  const documents = payload.documents.map((value, index) => {
    const document = exactObject(value, ["path", "format", "content", "metadata"], ["path", "format", "content"], `document ${index}`);
    let path: string;
    try { path = normalizeSourcePath(document.path as string); }
    catch (error) { throw new WorkerProtocolError(error instanceof Error ? error.message : `document ${index} path is invalid`, "invalid_payload"); }
    if (paths.has(path)) throw new WorkerProtocolError(`document path is duplicated: ${path}`, "invalid_payload");
    paths.add(path);
    if (document.format !== "markdown" && document.format !== "text") throw new WorkerProtocolError(`document ${index} format is invalid`, "invalid_payload");
    if (typeof document.content !== "string" || document.content.includes("\0")) throw new WorkerProtocolError(`document ${index} content is invalid`, "invalid_payload");
    try { assertValidUnicodeScalars(document.content, `document ${index} content`); }
    catch (error) { throw new WorkerProtocolError(error instanceof Error ? error.message : `document ${index} content is invalid`, "invalid_payload"); }
    const bytes = encodeUtf8(document.content).byteLength;
    if (bytes > MAX_BROWSER_DOCUMENT_UTF8_BYTES) {
      throw new WorkerProtocolError(`document ${index} exceeds the ${MAX_BROWSER_DOCUMENT_UTF8_BYTES} byte per-document limit`, "invalid_payload");
    }
    totalBytes += bytes;
    if (totalBytes > MAX_BROWSER_SOURCE_UTF8_BYTES) {
      throw new WorkerProtocolError(`documents exceed the ${MAX_BROWSER_SOURCE_UTF8_BYTES} byte browser limit`, "invalid_payload");
    }
    let metadata: BrowserDocumentMetadata | undefined;
    if (document.metadata !== undefined) {
      const raw = exactObject(document.metadata, ["title", "original_path", "source_url", "content_sha256"], [], `document ${index} metadata`);
      const sourceUrl = raw.source_url === undefined ? undefined : boundedString(raw.source_url, `document ${index} metadata source_url`, 2_048);
      if (sourceUrl !== undefined && !/^https?:\/\//u.test(sourceUrl)) throw new WorkerProtocolError(`document ${index} metadata source_url is invalid`, "invalid_payload");
      const contentSha256 = raw.content_sha256 === undefined ? undefined : boundedString(raw.content_sha256, `document ${index} metadata content_sha256`, 64);
      if (contentSha256 !== undefined && !/^[0-9a-f]{64}$/u.test(contentSha256)) throw new WorkerProtocolError(`document ${index} metadata content_sha256 is invalid`, "invalid_payload");
      metadata = Object.freeze({
        ...(raw.title === undefined ? {} : { title: boundedString(raw.title, `document ${index} metadata title`, 512) }),
        ...(raw.original_path === undefined ? {} : { original_path: boundedString(raw.original_path, `document ${index} metadata original_path`, 1_024) }),
        ...(sourceUrl === undefined ? {} : { source_url: sourceUrl }),
        ...(contentSha256 === undefined ? {} : { content_sha256: contentSha256 }),
      });
    }
    return Object.freeze({ path, format: document.format, content: document.content, ...(metadata === undefined ? {} : { metadata }) });
  });
  return Object.freeze({ documents: Object.freeze(documents) });
}

function payloadFor(operation: WorkerOperation, value: unknown): WorkerRequest["payload"] {
  if (operation === "initialize") {
    if (value === undefined) return undefined;
    const payload = exactObject(value, ["synthetic_record_count"], [], "initialize payload");
    return payload.synthetic_record_count === undefined ? {} : { synthetic_record_count: integer(payload.synthetic_record_count, "synthetic_record_count", 1, 50_000) };
  }
  if (operation === "load-documents") return browserDocuments(value);
  if (operation === "get-source") {
    const payload = exactObject(value, ["record_id", "source_id"], [], "get-source payload");
    if ((payload.record_id === undefined) === (payload.source_id === undefined)) throw new WorkerProtocolError("get-source requires exactly one of record_id or source_id", "invalid_payload");
    return payload.record_id === undefined
      ? { source_id: boundedString(payload.source_id, "get-source source_id", 128) }
      : { record_id: boundedString(payload.record_id, "get-source record_id", 128) };
  }
  if (operation === "get-graph") {
    if (value === undefined) return undefined;
    const payload = exactObject(value, ["view", "preferred_record_ids", "request_generation"], [], "get-graph payload");
    if (payload.view !== undefined && payload.view !== "evidence" && payload.view !== "folders") throw new WorkerProtocolError("get-graph view is invalid", "invalid_payload");
    const preferred = payload.preferred_record_ids === undefined ? undefined : stringArray(payload.preferred_record_ids, "preferred_record_ids", 101);
    const generation = payload.request_generation === undefined ? undefined : integer(payload.request_generation, "request_generation", 0, Number.MAX_SAFE_INTEGER);
    return {
      ...(payload.view === undefined ? {} : { view: payload.view }),
      ...(preferred === undefined ? {} : { preferred_record_ids: preferred }),
      ...(generation === undefined ? {} : { request_generation: generation }),
    };
  }
  if (operation === "get-context") {
    const payload = exactObject(value, ["query_id", "expected_query", "expected_record_ids"], ["query_id", "expected_query", "expected_record_ids"], "context payload");
    try { validateQuery(payload.expected_query); }
    catch { throw new WorkerProtocolError("expected_query is invalid", "invalid_payload"); }
    return { query_id: requestId(payload.query_id), expected_query: payload.expected_query as string, expected_record_ids: stringArray(payload.expected_record_ids, "context record IDs", 100) };
  }
  if (operation === "search") {
    const payload = exactObject(value, ["query", "options"], ["query"], "search payload");
    try { validateQuery(payload.query); }
    catch (error) { throw new WorkerProtocolError(error instanceof Error ? error.message : "query is invalid", "invalid_payload"); }
    return { query: payload.query as string, ...(payload.options === undefined ? {} : { options: searchOptions(payload.options) }) };
  }
  if (operation === "cancel") {
    const payload = exactObject(value, ["request_id"], ["request_id"], "cancel payload");
    return { request_id: requestId(payload.request_id, "cancel request_id") };
  }
  if (operation === "export-report") {
    const payload = exactObject(value, ["kind", "expected_query"], ["kind"], "export-report payload");
    if (payload.kind !== "indexing" && payload.kind !== "retrieval" && payload.kind !== "query") throw new WorkerProtocolError("export-report kind is invalid", "invalid_payload");
    if (payload.kind === "query") {
      try { validateQuery(payload.expected_query); }
      catch (error) { throw new WorkerProtocolError(error instanceof Error ? error.message : "expected_query is invalid", "invalid_payload"); }
      return { kind: "query", expected_query: payload.expected_query as string };
    }
    if (payload.expected_query !== undefined) throw new WorkerProtocolError("expected_query is only valid for query reports", "invalid_payload");
    return { kind: payload.kind };
  }
  if (value !== undefined) throw new WorkerProtocolError(`${operation} does not accept a payload`, "invalid_payload");
  return undefined;
}

export function validateRequest(value: unknown): WorkerRequest {
  const raw = exactObject(value, ["version", "request_id", "operation", "payload"], ["version", "request_id", "operation"], "worker request");
  if (raw.version !== WORKER_PROTOCOL_VERSION) throw new WorkerProtocolError("worker protocol version is unsupported", "invalid_request");
  const id = requestId(raw.request_id);
  if (typeof raw.operation !== "string" || !["initialize", "load-documents", "get-source", "get-context", "get-graph", "run-indexing-contract", "run-retrieval-contract", "search", "cancel", "export-report", "dispose"].includes(raw.operation)) throw new WorkerProtocolError("worker operation is unsupported", "unsupported_operation");
  const operation = raw.operation as WorkerOperation;
  const payload = payloadFor(operation, raw.payload);
  return { version: 1, request_id: id, operation, payload } as WorkerRequest;
}

function responseError(value: unknown): { readonly code: WorkerErrorCode; readonly message: string } {
  const error = exactObject(value, ["code", "message"], ["code", "message"], "worker error");
  const codes: readonly WorkerErrorCode[] = ["invalid_request", "invalid_payload", "unsupported_operation", "duplicate_request_id", "operation_busy", "cancelled", "disposed", "not_initialized", "worker_failed", "contract_mismatch"];
  if (typeof error.code !== "string" || !codes.includes(error.code as WorkerErrorCode)) throw new WorkerProtocolError("worker error code is invalid", "invalid_request");
  return { code: error.code as WorkerErrorCode, message: boundedString(error.message, "worker error message", 512) };
}

function browserRecordDisplays(value: unknown, records: number, label: string): readonly BrowserDocumentChunk[] {
  if (!Array.isArray(value) || value.length !== records) throw new WorkerProtocolError(`${label} chunks are invalid`, "invalid_request");
  const ids = new Set<string>();
  return Object.freeze(value.map((entry, index) => {
    const chunk = exactObject(entry, ["id", "source_id", "path", "excerpt", "heading", "heading_level"], ["id", "source_id", "path", "excerpt", "heading", "heading_level"], `${label} chunk ${index}`);
    const id = boundedString(chunk.id, `${label} chunk ${index} id`, 128);
    if (ids.has(id)) throw new WorkerProtocolError(`${label} chunk IDs must be unique`, "invalid_request");
    ids.add(id);
    const excerpt = boundedString(chunk.excerpt, `${label} chunk ${index} excerpt`, MAX_BROWSER_EXCERPT_SCALARS * 2 + 1);
    if (Array.from(excerpt).length > MAX_BROWSER_EXCERPT_SCALARS + 1) throw new WorkerProtocolError(`${label} chunk ${index} excerpt is too long`, "invalid_request");
    return Object.freeze({
      id,
      source_id: boundedString(chunk.source_id, `${label} chunk ${index} source_id`, 128),
      path: boundedString(chunk.path, `${label} chunk ${index} path`, 1_024),
      excerpt,
      heading: boundedString(chunk.heading, `${label} chunk ${index} heading`, 512),
      heading_level: integer(chunk.heading_level, `${label} chunk ${index} heading_level`, 0, 6),
    });
  }));
}

function initializeResult(value: unknown): InitializeResult {
  const raw = exactObject(value, ["status", "records", "synthetic_record_count", "contracts", "chunks"], ["status", "records", "synthetic_record_count", "contracts", "chunks"], "initialize result");
  if (raw.status !== "initialized") throw new WorkerProtocolError("initialize result status is invalid", "invalid_request");
  const contracts = exactObject(raw.contracts, ["indexing", "retrieval"], ["indexing", "retrieval"], "initialize result contracts");
  let indexing: WorkerContractIdentity;
  let retrieval: WorkerContractIdentity;
  try {
    indexing = validateWorkerContractIdentity(contracts.indexing);
    retrieval = validateWorkerContractIdentity(contracts.retrieval);
  } catch (error) {
    throw new WorkerProtocolError(error instanceof Error ? error.message : "initialize result contracts are invalid", "invalid_request");
  }
  if (indexing.id !== "rag-indexing-v1" || retrieval.id !== "rag-behavior-v2") throw new WorkerProtocolError("initialize result contracts are invalid", "invalid_request");
  const records = integer(raw.records, "initialize result records", 1, 50_000);
  return Object.freeze({
    status: "initialized",
    records,
    synthetic_record_count: raw.synthetic_record_count === null ? null : integer(raw.synthetic_record_count, "initialize result synthetic_record_count", 1, 50_000),
    contracts: Object.freeze({ indexing, retrieval }),
    chunks: browserRecordDisplays(raw.chunks, records, "initialize result"),
  });
}

function loadDocumentsResult(value: unknown): LoadDocumentsResult {
  const raw = exactObject(value, ["status", "documents", "records", "source_utf8_bytes", "chunks"], ["status", "documents", "records", "source_utf8_bytes", "chunks"], "load-documents result");
  if (raw.status !== "loaded") throw new WorkerProtocolError("load-documents result status is invalid", "invalid_request");
  const documents = integer(raw.documents, "load-documents result documents", 1, MAX_BROWSER_DOCUMENTS);
  const records = integer(raw.records, "load-documents result records", 1, MAX_BROWSER_RECORDS);
  const sourceBytes = integer(raw.source_utf8_bytes, "load-documents result source_utf8_bytes", 1, MAX_BROWSER_SOURCE_UTF8_BYTES);
  return Object.freeze({ status: "loaded", documents, records, source_utf8_bytes: sourceBytes, chunks: browserRecordDisplays(raw.chunks, records, "load-documents result") });
}

function getSourceResult(value: unknown): GetSourceResult {
  const fields = ["source_id", "record_id", "path", "title", "heading", "heading_level", "content", "source_url", "original_path", "content_sha256"];
  const raw = exactObject(value, fields, fields, "get-source result");
  const nullableString = (candidate: unknown, label: string, maximum: number): string | null => candidate === null ? null : boundedString(candidate, label, maximum);
  const digest = nullableString(raw.content_sha256, "get-source content_sha256", 64);
  if (digest !== null && !/^[0-9a-f]{64}$/u.test(digest)) throw new WorkerProtocolError("get-source content_sha256 is invalid", "invalid_request");
  const sourceUrl = nullableString(raw.source_url, "get-source source_url", 2_048);
  if (sourceUrl !== null && !/^https?:\/\//u.test(sourceUrl)) throw new WorkerProtocolError("get-source source_url is invalid", "invalid_request");
  return Object.freeze({
    source_id: boundedString(raw.source_id, "get-source source_id", 128),
    record_id: nullableString(raw.record_id, "get-source record_id", 128),
    path: boundedString(raw.path, "get-source path", 1_024),
    title: boundedString(raw.title, "get-source title", 512),
    heading: nullableString(raw.heading, "get-source heading", 512),
    heading_level: raw.heading_level === null ? null : integer(raw.heading_level, "get-source heading_level", 0, 6),
    content: boundedText(raw.content, "get-source content", MAX_BROWSER_DOCUMENT_UTF8_BYTES),
    source_url: sourceUrl,
    original_path: nullableString(raw.original_path, "get-source original_path", 1_024),
    content_sha256: digest,
  });
}

function positionedGraphResult(value: unknown): PositionedGraph {
  const fields = ["view", "nodes", "links", "total_nodes", "total_links", "omitted_nodes", "omitted_links", "clipped", "layout_steps", "layout_ms", "request_generation"];
  const raw = exactObject(value, fields, fields, "positioned graph");
  if (raw.view !== "evidence" && raw.view !== "folders") throw new WorkerProtocolError("positioned graph view is invalid", "invalid_request");
  if (!Array.isArray(raw.nodes) || raw.nodes.length > MAX_VISIBLE_GRAPH_NODES) throw new WorkerProtocolError("positioned graph nodes are invalid", "invalid_request");
  const nodeIds = new Set<string>();
  const nodes: PositionedGraphNode[] = raw.nodes.map((value, index) => {
    const node = exactObject(value, ["id", "kind", "label", "path", "source_id", "record_id", "x", "y"], ["id", "kind", "label", "path", "source_id", "record_id", "x", "y"], `graph node ${index}`);
    const id = boundedString(node.id, `graph node ${index} id`, 4_096);
    if (nodeIds.has(id)) throw new WorkerProtocolError("graph projection node IDs must be unique", "invalid_request");
    nodeIds.add(id);
    if (node.kind !== "chunk" && node.kind !== "source" && node.kind !== "folder") throw new WorkerProtocolError(`graph node ${index} kind is invalid`, "invalid_request");
    const sourceId = node.source_id === null ? null : boundedString(node.source_id, `graph node ${index} source_id`, 128);
    const recordId = node.record_id === null ? null : boundedString(node.record_id, `graph node ${index} record_id`, 128);
    if (node.kind === "chunk" && (!sourceId || !recordId)) throw new WorkerProtocolError(`graph node ${index} mapping is invalid`, "invalid_request");
    if (node.kind === "source" && (!sourceId || recordId !== null)) throw new WorkerProtocolError(`graph node ${index} mapping is invalid`, "invalid_request");
    if (node.kind === "folder" && (sourceId !== null || recordId !== null)) throw new WorkerProtocolError(`graph node ${index} mapping is invalid`, "invalid_request");
    return Object.freeze({ id, kind: node.kind, label: boundedString(node.label, `graph node ${index} label`, 1_024), path: boundedText(node.path, `graph node ${index} path`, 1_024), source_id: sourceId, record_id: recordId, x: finiteNumber(node.x, `graph node ${index} x`), y: finiteNumber(node.y, `graph node ${index} y`) });
  });
  if (!Array.isArray(raw.links) || raw.links.length > MAX_VISIBLE_GRAPH_LINKS) throw new WorkerProtocolError("positioned graph links are invalid", "invalid_request");
  const linkIds = new Set<string>();
  const links: RagGraphLink[] = raw.links.map((value, index) => {
    const link = exactObject(value, ["id", "source", "target", "kind"], ["id", "source", "target", "kind"], `graph link ${index}`);
    const id = boundedString(link.id, `graph link ${index} id`, 8_192);
    const source = boundedString(link.source, `graph link ${index} source`, 4_096);
    const target = boundedString(link.target, `graph link ${index} target`, 4_096);
    if (linkIds.has(id)) throw new WorkerProtocolError("graph projection link IDs must be unique", "invalid_request");
    if (!nodeIds.has(source) || !nodeIds.has(target) || source === target) throw new WorkerProtocolError(`graph link ${index} endpoints are invalid`, "invalid_request");
    if (link.kind !== "contains" && link.kind !== "reference") throw new WorkerProtocolError(`graph link ${index} kind is invalid`, "invalid_request");
    linkIds.add(id);
    return Object.freeze({ id, source, target, kind: link.kind });
  });
  const totalNodes = integer(raw.total_nodes, "positioned graph total_nodes", nodes.length, Number.MAX_SAFE_INTEGER);
  const totalLinks = integer(raw.total_links, "positioned graph total_links", links.length, Number.MAX_SAFE_INTEGER);
  const omittedNodes = integer(raw.omitted_nodes, "positioned graph omitted_nodes", 0, Number.MAX_SAFE_INTEGER);
  const omittedLinks = integer(raw.omitted_links, "positioned graph omitted_links", 0, Number.MAX_SAFE_INTEGER);
  const clipped = boolean(raw.clipped, "positioned graph clipped");
  if (omittedNodes < totalNodes - nodes.length || omittedLinks < totalLinks - links.length || clipped !== (omittedNodes > 0 || omittedLinks > 0)) {
    throw new WorkerProtocolError("positioned graph omission metadata is inconsistent", "invalid_request");
  }
  return Object.freeze({
    view: raw.view,
    nodes: Object.freeze(nodes),
    links: Object.freeze(links),
    total_nodes: totalNodes,
    total_links: totalLinks,
    omitted_nodes: omittedNodes,
    omitted_links: omittedLinks,
    clipped,
    layout_steps: integer(raw.layout_steps, "positioned graph layout_steps", 0, 1_000),
    layout_ms: finiteNumber(raw.layout_ms, "positioned graph layout_ms"),
    request_generation: integer(raw.request_generation, "positioned graph request_generation", 0, Number.MAX_SAFE_INTEGER),
  });
}

export function validateOperationResult<O extends WorkerOperation>(operation: O, value: unknown): WorkerOperationResult<O> {
  try {
    if (operation === "get-context") {
      const raw = exactObject(value, ["query_id", "query", "estimated_tokens", "chunks"], ["query_id", "query", "estimated_tokens", "chunks"], "context result");
      validateQuery(raw.query);
      if (!Array.isArray(raw.chunks) || raw.chunks.length > 100) throw new WorkerProtocolError("context chunks are invalid", "invalid_payload");
      const ids = new Set<string>();
      let bytes = 0;
      const chunks = raw.chunks.map((value) => {
        const chunk = exactObject(value, ["id", "source_id", "path", "heading", "text"], ["id", "source_id", "path", "heading", "text"], "context chunk");
        const id = boundedString(chunk.id, "context ID", 128);
        const content = boundedText(chunk.text, "context text", MAX_BROWSER_DOCUMENT_UTF8_BYTES);
        bytes += encodeUtf8(content).byteLength;
        if (ids.has(id) || bytes > MAX_BROWSER_SOURCE_UTF8_BYTES) throw new WorkerProtocolError("context identity or byte budget is invalid", "invalid_payload");
        ids.add(id);
        return Object.freeze({ id, source_id: boundedString(chunk.source_id, "context source", 128), path: boundedString(chunk.path, "context path", 1024), heading: boundedString(chunk.heading, "context heading", 512), text: content });
      });
      return Object.freeze({ query_id: requestId(raw.query_id), query: raw.query as string, estimated_tokens: integer(raw.estimated_tokens, "context estimated tokens", 0, 1800), chunks: Object.freeze(chunks) }) as WorkerOperationResult<O>;
    }
    if (operation === "initialize") return initializeResult(value) as WorkerOperationResult<O>;
    if (operation === "load-documents") return loadDocumentsResult(value) as WorkerOperationResult<O>;
    if (operation === "get-source") return getSourceResult(value) as WorkerOperationResult<O>;
    if (operation === "get-graph") return positionedGraphResult(value) as WorkerOperationResult<O>;
    if (operation === "run-indexing-contract") return validateWorkerActualReport(value, "indexing") as WorkerOperationResult<O>;
    if (operation === "run-retrieval-contract") return validateWorkerActualReport(value, "retrieval") as WorkerOperationResult<O>;
    if (operation === "search") return validateRetrievalObservation(value) as WorkerOperationResult<O>;
    if (operation === "cancel") {
      const raw = exactObject(value, ["cancelled"], ["cancelled"], "cancel result");
      if (raw.cancelled !== null) return Object.freeze({ cancelled: requestId(raw.cancelled, "cancel result request_id") }) as WorkerOperationResult<O>;
      return Object.freeze({ cancelled: null }) as WorkerOperationResult<O>;
    }
    if (operation === "export-report") return validateWorkerExportReport(value) as WorkerOperationResult<O>;
    const raw = exactObject(value, ["disposed"], ["disposed"], "dispose result");
    if (raw.disposed !== true) throw new WorkerProtocolError("dispose result is invalid", "invalid_request");
    return Object.freeze({ disposed: true }) as WorkerOperationResult<O>;
  } catch (error) {
    if (error instanceof WorkerProtocolError) throw error;
    throw new WorkerProtocolError(error instanceof Error ? error.message : "worker result is invalid", "invalid_request");
  }
}

export function validateResponse(value: unknown, operation?: WorkerOperation): WorkerResponse {
  const raw = exactObject(value, ["version", "request_id", "status", "contract", "result", "error"], ["version", "request_id", "status", "contract"], "worker response");
  if (raw.version !== WORKER_PROTOCOL_VERSION) throw new WorkerProtocolError("worker response protocol version is unsupported", "invalid_request");
  const id = requestId(raw.request_id);
  if (raw.contract !== null && raw.contract !== "rag-indexing-v1" && raw.contract !== "rag-behavior-v2") throw new WorkerProtocolError("worker response contract is invalid", "invalid_request");
  if (raw.status === "ok") {
    if (!("result" in raw) || "error" in raw) throw new WorkerProtocolError("successful worker response is invalid", "invalid_request");
    if (operation !== undefined && raw.contract !== expectedContract(operation)) throw new WorkerProtocolError("worker response contract does not match its operation", "invalid_request");
    return { version: 1, request_id: id, status: "ok", contract: raw.contract, result: operation === undefined ? raw.result : validateOperationResult(operation, raw.result) };
  }
  if (raw.status === "progress") {
    if (!('result' in raw) || 'error' in raw || raw.contract !== null) throw new WorkerProtocolError("worker progress response is invalid", "invalid_request");
    const progress = exactObject(raw.result, ["phase", "completed", "total"], ["phase", "completed", "total"], "worker progress");
    if (progress.phase !== "indexing" && progress.phase !== "resolving") throw new WorkerProtocolError("worker progress phase is invalid", "invalid_request");
    const total = integer(progress.total, "worker progress total", 1, MAX_BROWSER_DOCUMENTS);
    return { version: 1, request_id: id, status: "progress", contract: null, result: Object.freeze({ phase: progress.phase, completed: integer(progress.completed, "worker progress completed", 0, total), total }) };
  }
  if (raw.status === "error" || raw.status === "cancelled") {
    if (!("error" in raw) || "result" in raw) throw new WorkerProtocolError("failed worker response is invalid", "invalid_request");
    const error = responseError(raw.error);
    if (raw.status === "cancelled" && error.code !== "cancelled") throw new WorkerProtocolError("cancelled worker response must use the cancelled code", "invalid_request");
    return { version: 1, request_id: id, status: raw.status, contract: raw.contract, error };
  }
  throw new WorkerProtocolError("worker response status is invalid", "invalid_request");
}

export function okResponse<O extends WorkerOperation>(operation: O, requestId: string, contract: WorkerContract, result: unknown): WorkerResponse {
  if (contract !== expectedContract(operation)) throw new WorkerProtocolError("worker success contract does not match its operation", "worker_failed");
  return { version: 1, request_id: requestId, status: "ok", contract, result: validateOperationResult(operation, result) };
}

export function errorResponse(requestId: string, code: WorkerErrorCode, message: string, status: "error" | "cancelled" = "error", contract: WorkerContract = null): WorkerResponse {
  return { version: 1, request_id: requestId, status, contract, error: { code, message: message.slice(0, 512) || code } };
}

export function progressResponse(requestId: string, result: WorkerProgress): WorkerResponse {
  return validateResponse({ version: 1, request_id: requestId, status: "progress", contract: null, result });
}
