import { CONTRACT_RUNTIME } from "../contracts/generated/runtime.js";
import { projectRagGraphAsync } from "../application/graphProjection.js";
import { resolveDocumentReferences } from "../application/documentReferences.js";
import { layoutRagGraphAsync, PositionedGraph } from "../application/layoutGraph.js";
import { BROWSER_RAG_TS_MODULE_VERSION } from "../moduleIdentity.js";
import { indexDocument } from "../core/indexing/indexDocument.js";
import { indexingObservation } from "../core/indexing/observations.js";
import { assertFrozenRetrievalProfile } from "../core/retrieval/profile.js";
import { RagEngine, SearchOptions } from "../core/retrieval/engine.js";
import { RagRecord, recordFromMapping, recordToMapping } from "../core/shared/types.js";
import { retrievalObservation } from "../reports/observations.js";
import { RetrievalObservation, WorkerActualCase, WorkerActualReport, WorkerContractIdentity, WorkerExportReport, WorkerQueryReport, workerActualReport, workerQueryReport } from "../reports/reportTypes.js";
import { WorkerCancelledError } from "./errors.js";
import { cooperativeScheduler } from "../application/cooperativeScheduler.js";
import type { GetContextPayload, GetContextResult } from "./protocol.js";
import { BrowserDocumentChunk, BrowserDocumentMetadata, ExportReportPayload, GetGraphPayload, GetSourcePayload, GetSourceResult, InitializePayload, LoadDocumentsPayload, LoadDocumentsResult, MAX_BROWSER_EXCERPT_SCALARS, MAX_BROWSER_RECORDS, SearchOptionsPayload, SearchPayload, WorkerContract, WorkerErrorCode, WorkerProtocolError, WorkerRequest, WorkerResponse, errorResponse, okResponse, progressResponse, validateRequest } from "./protocol.js";

const MODULE_VERSION = BROWSER_RAG_TS_MODULE_VERSION;
const MAX_COMPLETED_REQUEST_IDS = 512;

type RuntimeFile<T> = { readonly data: T; readonly sha256: string };
type RetrievalFixture = {
  readonly id: string;
  readonly query: string;
  readonly mode: NonNullable<SearchOptions["mode"]>;
  readonly top_k: number;
  readonly include_scopes?: readonly string[];
  readonly exclude_scopes?: readonly string[];
  readonly scope_priorities?: Readonly<Record<string, number>>;
  readonly authority_policy?: string;
  readonly query_vector_id?: string;
  readonly semantic_enabled?: boolean;
  readonly semantic_fallback_reason?: string;
  readonly expand?: boolean;
  readonly max_context_tokens?: number;
};
type RetrievalRuntime = {
  readonly records: readonly unknown[];
};
type VectorRuntime = {
  readonly profile_id: string;
  readonly dimension: number;
  readonly record_vectors: Readonly<Record<string, readonly number[]>>;
  readonly query_vectors: Readonly<Record<string, readonly number[]>>;
};
type IndexingFixture = {
  readonly id: string;
  readonly content: string;
  readonly format: "markdown" | "text";
  readonly path: string;
  readonly pocket: string;
  readonly scopes: readonly string[];
  readonly authority: string;
  readonly priority: number;
  readonly limits?: { readonly max_chars: number; readonly max_tokens: number };
};

interface RuntimeState {
  readonly engine: RagEngine;
  readonly vectors: Readonly<Record<string, readonly number[]>>;
  readonly vectorProfileId: string;
  readonly queryVectors: Readonly<Record<string, readonly number[]>>;
  readonly vectorDimension: number;
  readonly recordCount: number;
  readonly syntheticRecordCount: number | null;
  readonly sources: ReadonlyMap<string, RuntimeSourceDocument>;
  indexingReport: WorkerActualReport | null;
  retrievalReport: WorkerActualReport | null;
  queryReport: WorkerQueryReport | null;
  context: GetContextResult | null;
}

interface RuntimeSourceDocument {
  readonly sourceId: string;
  readonly path: string;
  readonly content: string;
  readonly metadata: BrowserDocumentMetadata;
}

interface ActiveOperation {
  readonly requestId: string;
  readonly operation: WorkerRequest["operation"];
  readonly completion: Promise<void>;
  resolve(): void;
  yieldControl(force?: boolean): Promise<void>;
}

const cancelled = new Set<string>();
const completedRequestIds = new Set<string>();
const completedRequestOrder: string[] = [];
let runtime: RuntimeState | null = null;
let active: ActiveOperation | null = null;
let disposeInFlight = false;
let disposed = false;
let corpusRevision = 0;
const graphCache = new Map<string, PositionedGraph>();
let publishProgress: (response: WorkerResponse) => void = () => undefined;

function advanceCorpusRevision(): void {
  corpusRevision += 1;
  graphCache.clear();
}

function runtimeFile<T>(contract: "rag-indexing-v1" | "rag-behavior-v2", path: string): T {
  const contracts = CONTRACT_RUNTIME.contracts as Record<string, { readonly files: Readonly<Record<string, RuntimeFile<unknown>>> }>;
  const entry = contracts[contract]?.files[path];
  if (!entry) throw new Error(`generated runtime contract file is missing: ${contract}/${path}`);
  return entry.data as T;
}

function contractIdentity(contract: "rag-indexing-v1" | "rag-behavior-v2"): WorkerContractIdentity {
  const contracts = CONTRACT_RUNTIME.contracts as Record<string, { readonly version: number; readonly input_digests: Readonly<Record<string, string>> }>;
  const source = contracts[contract];
  if (!source || typeof CONTRACT_RUNTIME.snapshot_digest !== "string") throw new Error(`generated runtime contract identity is missing: ${contract}`);
  return { id: contract, version: source.version, runtime_snapshot_digest: CONTRACT_RUNTIME.snapshot_digest, input_digests: { ...source.input_digests } };
}

function rememberRequest(requestId: string): boolean {
  if (completedRequestIds.has(requestId)) return false;
  completedRequestIds.add(requestId);
  completedRequestOrder.push(requestId);
  if (completedRequestOrder.length > MAX_COMPLETED_REQUEST_IDS) {
    const expired = completedRequestOrder.shift();
    if (expired) completedRequestIds.delete(expired);
  }
  return true;
}

function checkCancellation(requestId: string): void {
  if (cancelled.has(requestId)) throw new WorkerCancelledError();
}

function workerYield(requestId: string, force = false): Promise<void> {
  checkCancellation(requestId);
  return active?.yieldControl(force) ?? Promise.resolve();
}

function beginOperation(request: WorkerRequest): ActiveOperation | null {
  if (active || disposeInFlight) return null;
  let resolveCompletion: (() => void) | undefined;
  const completion = new Promise<void>((resolve) => { resolveCompletion = resolve; });
  const operation: ActiveOperation = {
    requestId: request.request_id,
    operation: request.operation,
    completion,
    resolve: () => resolveCompletion?.(),
    yieldControl: cooperativeScheduler(() => checkCancellation(request.request_id)),
  };
  active = operation;
  return operation;
}

function finishOperation(operation: ActiveOperation): void {
  if (active === operation) active = null;
  cancelled.delete(operation.requestId);
  operation.resolve();
}

function fixtureState(payload: InitializePayload | undefined): RuntimeState {
  const profile = runtimeFile<unknown>("rag-behavior-v2", "retrieval-profile.json");
  assertFrozenRetrievalProfile(profile);
  const fixture = runtimeFile<RetrievalRuntime>("rag-behavior-v2", "fixture-records.json");
  const vectors = runtimeFile<VectorRuntime>("rag-behavior-v2", "fixture-vectors.json");
  const requestedCount = payload?.synthetic_record_count;
  const sourceRecords = fixture.records;
  if (!sourceRecords.length) throw new Error("generated retrieval fixture contains no records");
  const rawRecords = requestedCount === undefined
    ? sourceRecords
    : Array.from({ length: requestedCount }, (_, index) => {
      const source = recordToMapping(recordFromMapping(sourceRecords[index % sourceRecords.length]!));
      return { ...source, id: `synthetic-${index}`, source_id: `synthetic-source-${Math.floor(index / sourceRecords.length)}`, references: [] };
    });
  const records = rawRecords.map(recordFromMapping);
  return {
    engine: new RagEngine(records),
    vectors: vectors.record_vectors,
    vectorProfileId: vectors.profile_id,
    queryVectors: vectors.query_vectors,
    vectorDimension: vectors.dimension,
    recordCount: records.length,
    syntheticRecordCount: requestedCount ?? null,
    sources: new Map(),
    indexingReport: null,
    retrievalReport: null,
    queryReport: null,
    context: null,
  };
}

function requireRuntime(): RuntimeState {
  if (!runtime) throw new WorkerProtocolError("worker is not initialized", "not_initialized");
  return runtime;
}

function boundedDisplayText(value: unknown, fallback: string, maximum = 512): string {
  const source = String(value || fallback);
  if (source.length <= maximum) return source;
  let output = "";
  for (const scalar of source) {
    if (output.length + scalar.length + 1 > maximum) break;
    output += scalar;
  }
  return `${output}…`;
}

async function initialize(payload: InitializePayload | undefined): Promise<Record<string, unknown>> {
  runtime = fixtureState(payload);
  advanceCorpusRevision();
  disposed = false;
  return {
    status: "initialized",
    records: runtime.recordCount,
    synthetic_record_count: runtime.syntheticRecordCount,
    chunks: displayMetadata(runtime.engine.records),
    contracts: {
      indexing: contractIdentity("rag-indexing-v1"),
      retrieval: contractIdentity("rag-behavior-v2"),
    },
  };
}

function displayMetadata(records: readonly RagRecord[]): readonly BrowserDocumentChunk[] {
  return records.map((record) => {
    const compact = record.text.replaceAll(/\s+/gu, " ").trim();
    const scalars = Array.from(compact);
    const excerpt = scalars.length > MAX_BROWSER_EXCERPT_SCALARS
      ? `${scalars.slice(0, MAX_BROWSER_EXCERPT_SCALARS).join("")}…`
      : compact;
    return {
      id: record.id,
      source_id: record.source_id,
      path: record.path || record.source_name,
      excerpt,
      heading: boundedDisplayText(record.metadata.heading, "Overview"),
      heading_level: Number(record.metadata.heading_level ?? 0),
    };
  });
}

async function loadDocuments(requestId: string, payload: LoadDocumentsPayload): Promise<LoadDocumentsResult> {
  const records: RagRecord[] = [];
  const sources = new Map<string, RuntimeSourceDocument>();
  let sourceBytes = 0;
  for (let documentIndex = 0; documentIndex < payload.documents.length; documentIndex += 1) {
    const document = payload.documents[documentIndex]!;
    await workerYield(requestId);
    let indexed;
    try {
      indexed = await indexDocument(document.content, {
        format: document.format,
        path: document.path,
        pocket: "browser",
        scopes: ["browser:local"],
        authority: "workspace_record",
        priority: 0,
        checkpoint: () => checkCancellation(requestId),
      });
    } catch (error) {
      if (error instanceof WorkerCancelledError) throw error;
      throw new WorkerProtocolError(`could not index ${document.path}: ${error instanceof Error ? error.message : String(error)}`, "invalid_payload");
    }
    if (records.length + indexed.records.length > MAX_BROWSER_RECORDS) {
      throw new WorkerProtocolError(`documents exceed the ${MAX_BROWSER_RECORDS} record browser limit`, "invalid_payload");
    }
    sourceBytes += indexed.source_utf8_bytes;
    records.push(...indexed.records);
    sources.set(indexed.source_id, {
      sourceId: indexed.source_id,
      path: indexed.path,
      content: document.content,
      metadata: document.metadata ?? {},
    });
    if ((documentIndex + 1) % 10 === 0 || documentIndex + 1 === payload.documents.length) publishProgress(progressResponse(requestId, { phase: "indexing", completed: documentIndex + 1, total: payload.documents.length }));
  }
  if (!records.length) throw new WorkerProtocolError("documents produced no searchable records", "invalid_payload");
  checkCancellation(requestId);
  publishProgress(progressResponse(requestId, { phase: "resolving", completed: payload.documents.length, total: payload.documents.length }));
  let engine: RagEngine;
  try { engine = new RagEngine(resolveDocumentReferences(records)); }
  catch (error) { throw new WorkerProtocolError(error instanceof Error ? error.message : "documents could not be loaded", "invalid_payload"); }
  const next: RuntimeState = {
    engine,
    vectors: {},
    vectorProfileId: "browser-local-none",
    queryVectors: {},
    vectorDimension: 0,
    recordCount: engine.records.length,
    syntheticRecordCount: null,
    sources,
    indexingReport: null,
    retrievalReport: null,
    queryReport: null,
    context: null,
  };
  await workerYield(requestId, true);
  runtime = next;
  advanceCorpusRevision();
  return {
    status: "loaded",
    documents: payload.documents.length,
    records: engine.records.length,
    source_utf8_bytes: sourceBytes,
    chunks: displayMetadata(engine.records),
  };
}

function getSource(payload: GetSourcePayload): GetSourceResult {
  const state = requireRuntime();
  const record = payload.record_id === undefined ? undefined : state.engine.records.find((candidate) => candidate.id === payload.record_id);
  const sourceId = record?.source_id ?? payload.source_id!;
  const source = state.sources.get(sourceId);
  if (!source) throw new WorkerProtocolError("source is unavailable for the active corpus", "invalid_payload");
  const metadata = source.metadata;
  return {
    source_id: sourceId,
    record_id: record?.id ?? null,
    path: source.path,
    title: metadata.title ?? source.path.split("/").at(-1)?.replace(/\.(?:md|markdown|txt)$/iu, "") ?? source.path,
    heading: record ? boundedDisplayText(record.metadata.heading, "Overview") : null,
    heading_level: record ? Number(record.metadata.heading_level ?? 0) : null,
    content: source.content,
    source_url: metadata.source_url ?? null,
    original_path: metadata.original_path ?? null,
    content_sha256: metadata.content_sha256 ?? null,
  };
}

function indexingOptions(fixture: IndexingFixture, requestId: string): Parameters<typeof indexDocument>[1] {
  return {
    format: fixture.format,
    path: fixture.path,
    pocket: fixture.pocket,
    scopes: fixture.scopes,
    authority: fixture.authority,
    priority: fixture.priority,
    ...(fixture.limits === undefined ? {} : { limits: fixture.limits }),
    checkpoint: () => checkCancellation(requestId),
  };
}

async function runIndexing(requestId: string): Promise<WorkerActualReport> {
  const state = requireRuntime();
  const fixtures = runtimeFile<{ readonly cases: readonly IndexingFixture[] }>("rag-indexing-v1", "fixture-documents.json");
  const results: WorkerActualCase[] = [];
  for (const fixture of fixtures.cases) {
    checkCancellation(requestId);
    try {
      const document = await indexDocument(fixture.content, indexingOptions(fixture, requestId));
      results.push({ id: fixture.id, actual: { status: "ok", document: indexingObservation(document) } });
    } catch (error) {
      if (error instanceof WorkerCancelledError) throw error;
      const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "unknown";
      results.push({ id: fixture.id, actual: { status: "error", error: { code } } });
    }
  }
  const report = workerActualReport("indexing", contractIdentity("rag-indexing-v1"), MODULE_VERSION, results);
  state.indexingReport = report;
  return report;
}

function fixtureSearchOptions(fixture: RetrievalFixture, state: RuntimeState, requestId: string): SearchOptions {
  const vector = fixture.query_vector_id === undefined ? undefined : state.queryVectors[fixture.query_vector_id];
  return {
    mode: fixture.mode,
    top_k: fixture.top_k,
    ...(fixture.include_scopes === undefined ? {} : { include_scopes: fixture.include_scopes }),
    ...(fixture.exclude_scopes === undefined ? {} : { exclude_scopes: fixture.exclude_scopes }),
    ...(fixture.scope_priorities === undefined ? {} : { scope_priorities: fixture.scope_priorities }),
    ...(fixture.authority_policy === undefined ? {} : { authority_policy: fixture.authority_policy }),
    ...(vector === undefined ? {} : { vectors: state.vectors, query_vector: vector, query_embedding_profile_id: state.vectorProfileId }),
    ...(fixture.semantic_enabled === undefined ? {} : { semantic_enabled: fixture.semantic_enabled }),
    ...(fixture.semantic_fallback_reason === undefined ? {} : { semantic_fallback_reason: fixture.semantic_fallback_reason }),
    ...(fixture.expand === undefined ? {} : { expand: fixture.expand }),
    ...(fixture.max_context_tokens === undefined ? {} : { max_context_tokens: fixture.max_context_tokens }),
    checkpoint: () => checkCancellation(requestId),
  };
}

async function runRetrieval(requestId: string): Promise<WorkerActualReport> {
  const state = requireRuntime();
  const proofRuntime = fixtureState(undefined);
  const fixtures = runtimeFile<{ readonly cases: readonly RetrievalFixture[] }>("rag-behavior-v2", "cases.json");
  const results: WorkerActualCase[] = [];
  for (const fixture of fixtures.cases) {
    checkCancellation(requestId);
    const response = await proofRuntime.engine.searchAsync(fixture.query, fixtureSearchOptions(fixture, proofRuntime, requestId), () => workerYield(requestId));
    results.push({ id: fixture.id, mode: fixture.mode, actual: retrievalObservation(response) });
  }
  const report = workerActualReport("retrieval", contractIdentity("rag-behavior-v2"), MODULE_VERSION, results);
  state.retrievalReport = report;
  return report;
}

function runtimeSearchOptions(options: SearchOptionsPayload | undefined, state: RuntimeState, requestId: string): SearchOptions {
  const { fixture_query_vector_id: fixtureVectorId, ...direct } = options ?? {};
  if (fixtureVectorId === undefined) return { ...direct, checkpoint: () => checkCancellation(requestId) };
  const queryVector = state.queryVectors[fixtureVectorId];
  if (!queryVector || queryVector.length !== state.vectorDimension) throw new WorkerProtocolError("fixture_query_vector_id is unavailable", "contract_mismatch");
  return { ...direct, vectors: state.vectors, query_vector: queryVector, query_embedding_profile_id: state.vectorProfileId, checkpoint: () => checkCancellation(requestId) };
}

async function runSearch(requestId: string, payload: SearchPayload): Promise<RetrievalObservation> {
  const state = requireRuntime();
  const response = await state.engine.searchAsync(payload.query, runtimeSearchOptions(payload.options, state, requestId), () => workerYield(requestId));
  const observation = retrievalObservation(response);
  await workerYield(requestId, true);
  state.queryReport = workerQueryReport(contractIdentity("rag-behavior-v2"), MODULE_VERSION, payload.query, observation);
  state.context = {
    query: payload.query, query_id: requestId, estimated_tokens: response.context_tokens,
    chunks: response.results.map(({ record }) => ({
      id: record.id, source_id: record.source_id, path: record.path || record.source_name,
      heading: boundedDisplayText(record.metadata.heading, "Overview"), text: record.text,
    })),
  };
  return observation;
}

function getContext(payload: GetContextPayload): GetContextResult {
  const context = requireRuntime().context;
  if (!context || context.query_id !== payload.query_id || context.query !== payload.expected_query
    || JSON.stringify(context.chunks.map(({ id }) => id)) !== JSON.stringify(payload.expected_record_ids)) {
    throw new WorkerProtocolError("context does not match the accepted query and ordered results", "contract_mismatch");
  }
  return context;
}

function exportReport(payload: ExportReportPayload): WorkerExportReport {
  const state = requireRuntime();
  const report = payload.kind === "indexing" ? state.indexingReport : payload.kind === "retrieval" ? state.retrievalReport : state.queryReport;
  if (!report) throw new WorkerProtocolError(`${payload.kind} report has not been generated`, "not_initialized");
  if (payload.kind === "query" && report.kind === "query" && report.query !== payload.expected_query) {
    throw new WorkerProtocolError("query report does not match the submitted query", "contract_mismatch");
  }
  return report;
}

async function getGraph(requestId: string, payload: GetGraphPayload | undefined): Promise<PositionedGraph> {
  const view = payload?.view ?? "evidence";
  const preferred = payload?.preferred_record_ids ?? [];
  const requestGeneration = payload?.request_generation ?? 0;
  const cacheKey = `${corpusRevision}:${view}:${preferred.join("\u0000")}`;
  const cached = graphCache.get(cacheKey);
  if (cached) return Object.freeze({ ...cached, request_generation: requestGeneration, layout_ms: 0 });
  const checkpoint = () => checkCancellation(requestId);
  const yieldControl = () => workerYield(requestId);
  const projection = await projectRagGraphAsync(requireRuntime().engine.records, view, checkpoint, yieldControl);
  const positioned = await layoutRagGraphAsync(projection, preferred, requestGeneration, checkpoint, yieldControl);
  graphCache.set(cacheKey, positioned);
  if (graphCache.size > 8) graphCache.delete(graphCache.keys().next().value as string);
  return positioned;
}

function errorDetails(error: unknown): { readonly code: WorkerErrorCode; readonly message: string } {
  if (error instanceof WorkerProtocolError) return { code: error.code, message: error.message };
  if (error instanceof WorkerCancelledError) return { code: "cancelled", message: error.message };
  if (error instanceof Error) return { code: "worker_failed", message: error.message };
  return { code: "worker_failed", message: "worker operation failed" };
}

async function runExclusive(request: WorkerRequest, contract: WorkerContract, action: () => Promise<unknown>): Promise<WorkerResponse> {
  if (disposed && request.operation !== "initialize") return errorResponse(request.request_id, "disposed", "worker is disposed");
  const operation = beginOperation(request);
  if (!operation) return errorResponse(request.request_id, "operation_busy", "worker is busy with another operation");
  try {
    // An initial task boundary admits cancellation even for a tiny operation.
    await workerYield(request.request_id, true);
    return okResponse(request.operation, request.request_id, contract, await action());
  } catch (error) {
    const details = errorDetails(error);
    return errorResponse(request.request_id, details.code, details.message, details.code === "cancelled" ? "cancelled" : "error", contract);
  } finally {
    finishOperation(operation);
  }
}

async function dispose(requestId: string): Promise<WorkerResponse> {
  if (disposeInFlight) return errorResponse(requestId, "operation_busy", "worker disposal is already in progress");
  disposeInFlight = true;
  try {
    const current = active;
    if (current) {
      cancelled.add(current.requestId);
      await current.completion;
    }
    runtime = null;
    graphCache.clear();
    cancelled.clear();
    disposed = true;
    return okResponse("dispose", requestId, null, { disposed: true });
  } finally {
    disposeInFlight = false;
  }
}

export async function handleRequest(request: WorkerRequest): Promise<WorkerResponse> {
  if (!rememberRequest(request.request_id)) return errorResponse(request.request_id, "duplicate_request_id", "worker request_id has already been used");
  if (request.operation === "cancel") {
    const payload = request.payload;
    const accepted = active?.requestId === payload.request_id;
    if (accepted) cancelled.add(payload.request_id);
    return okResponse("cancel", request.request_id, null, { cancelled: accepted ? payload.request_id : null });
  }
  if (request.operation === "dispose") return dispose(request.request_id);
  if (request.operation === "initialize") return runExclusive(request, null, () => initialize(request.payload));
  if (request.operation === "load-documents") return runExclusive(request, null, () => loadDocuments(request.request_id, request.payload));
  // Immutable accepted-source reads may overlap a search or a replacement under construction.
  // The application also checks corpus/selection generations before showing a response.
  if (request.operation === "get-source") {
    if (disposed || disposeInFlight) return errorResponse(request.request_id, "disposed", "worker is disposed");
    try { return okResponse("get-source", request.request_id, null, getSource(request.payload)); }
    catch (error) { const details = errorDetails(error); return errorResponse(request.request_id, details.code, details.message); }
  }
  if (request.operation === "get-context") return runExclusive(request, null, () => Promise.resolve(getContext(request.payload)));
  if (request.operation === "get-graph") return runExclusive(request, null, () => getGraph(request.request_id, request.payload));
  if (request.operation === "run-indexing-contract") return runExclusive(request, "rag-indexing-v1", () => runIndexing(request.request_id));
  if (request.operation === "run-retrieval-contract") return runExclusive(request, "rag-behavior-v2", () => runRetrieval(request.request_id));
  if (request.operation === "search") return runExclusive(request, "rag-behavior-v2", () => runSearch(request.request_id, request.payload));
  if (request.operation === "export-report") return runExclusive(request, null, () => Promise.resolve(exportReport(request.payload)));
  throw new Error("unreachable worker operation");
}

const workerGlobal = globalThis as unknown as { onmessage: ((event: MessageEvent<unknown>) => void) | null; postMessage: (value: WorkerResponse) => void };
publishProgress = (response) => {
  if (typeof workerGlobal.postMessage === "function") workerGlobal.postMessage(response);
};
workerGlobal.onmessage = (event) => {
  let request: WorkerRequest;
  try { request = validateRequest(event.data); }
  catch (error) {
    const details = errorDetails(error);
    workerGlobal.postMessage(errorResponse("invalid-request", details.code, details.message));
    return;
  }
  void handleRequest(request).then((response) => workerGlobal.postMessage(response));
};
