import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../../src/worker/rag.worker.js";
import { BrowserRagWorkerClient, WorkerRequestTimeoutError } from "../../src/worker/client.js";
import { WorkerProtocolError, WorkerRequest, validateRequest } from "../../src/worker/protocol.js";

function request(value: Record<string, unknown>): WorkerRequest {
  return validateRequest({ version: 1, ...value });
}

function okResult(response: Awaited<ReturnType<typeof handleRequest>>): unknown {
  assert.equal(response.status, "ok");
  if (response.status !== "ok") throw new Error("expected worker success");
  return response.result;
}

test("Worker searches admit prototype-like scope priority keys and preserve query reports", async () => {
  okResult(await handleRequest(request({ request_id: "scope-keys-load", operation: "load-documents", payload: {
    documents: [{ path: "scope.md", format: "text", content: "scope priority beacon" }],
  } })));
  const searched = await handleRequest(request({ request_id: "scope-keys-search", operation: "search", payload: {
    query: "scope priority beacon", options: { mode: "exact_only", scope_priorities: Object.fromEntries([
      ["constructor", 1], ["toString", 2], ["__proto__", 3], ["browser:local", 23],
    ]) },
  } }));
  const observation = okResult(searched) as { scores: Array<{ score_micro: number; components: { priority_micro: number } }> };
  assert.equal(observation.scores.length, 1);
  assert.equal(observation.scores[0]?.components.priority_micro, 230_000);
  assert.ok(Number.isFinite(observation.scores[0]?.score_micro));
  const report = okResult(await handleRequest(request({ request_id: "scope-keys-report", operation: "export-report", payload: {
    kind: "query", expected_query: "scope priority beacon",
  } }))) as { observation: unknown };
  assert.deepEqual(report.observation, observation);
});

function initializationResult(): Record<string, unknown> {
  const identity = (id: "rag-indexing-v1" | "rag-behavior-v2") => ({
    id,
    version: id === "rag-indexing-v1" ? 1 : 2,
    runtime_snapshot_digest: "a".repeat(64),
    input_digests: { "fixture.json": "b".repeat(64) },
  });
  return {
    status: "initialized",
    records: 3,
    synthetic_record_count: null,
    contracts: { indexing: identity("rag-indexing-v1"), retrieval: identity("rag-behavior-v2") },
    chunks: [0, 1, 2].map((index) => ({ id: `record-${index}`, source_id: `source-${index}`, path: `fixture-${index}.md`, excerpt: `fixture ${index}`, heading: "Overview", heading_level: 0 })),
  };
}

test("worker protocol rejects malformed envelopes and untyped search values", () => {
  assert.throws(() => validateRequest({ version: 1, request_id: "valid", operation: "initialize", unexpected: true }), WorkerProtocolError);
  assert.throws(() => validateRequest({ version: 1, request_id: "", operation: "initialize" }), WorkerProtocolError);
  assert.throws(() => validateRequest({ version: 1, request_id: "valid", operation: "search", payload: { query: "ok", options: { top_k: "1" } } }), WorkerProtocolError);
  assert.throws(() => validateRequest({ version: 1, request_id: "valid", operation: "search", payload: { query: "ok", options: { query_vector: ["1"], vectors: { one: [1] }, query_embedding_profile_id: "fixture" } } }), WorkerProtocolError);
  assert.throws(() => validateRequest({ version: 1, request_id: "valid", operation: "cancel", payload: { request_id: "bad id" } }), WorkerProtocolError);
  assert.throws(() => validateRequest({ version: 1, request_id: "valid", operation: "get-graph", payload: { view: "tags" } }), WorkerProtocolError);
  assert.throws(() => validateRequest({ version: 1, request_id: "valid", operation: "export-report", payload: { kind: "query" } }), WorkerProtocolError);
  assert.throws(() => validateRequest({ version: 1, request_id: "valid", operation: "export-report", payload: { kind: "indexing", expected_query: "wrong owner" } }), WorkerProtocolError);
  const documents = validateRequest({ version: 1, request_id: "documents", operation: "load-documents", payload: { documents: [{ path: "notes\\local.md", format: "markdown", content: "# Local\nMarker" }] } });
  assert.deepEqual(documents.payload, { documents: [{ path: "notes/local.md", format: "markdown", content: "# Local\nMarker" }] });
  assert.throws(() => validateRequest({ version: 1, request_id: "empty-documents", operation: "load-documents", payload: { documents: [] } }), WorkerProtocolError);
  assert.throws(() => validateRequest({ version: 1, request_id: "duplicate-documents", operation: "load-documents", payload: { documents: [{ path: "notes/local.md", format: "markdown", content: "one" }, { path: "notes\\local.md", format: "text", content: "two" }] } }), WorkerProtocolError);
});

test("worker exports complete actual-only indexing and retrieval reports", async () => {
  const initialized = await handleRequest(request({ request_id: "actual-init", operation: "initialize" }));
  assert.deepEqual(okResult(initialized) && (okResult(initialized) as { status: string }).status, "initialized");
  const indexing = await handleRequest(request({ request_id: "actual-indexing", operation: "run-indexing-contract" }));
  const retrieval = await handleRequest(request({ request_id: "actual-retrieval", operation: "run-retrieval-contract" }));
  const indexingReport = okResult(indexing) as { schema: string; summary: { cases: number }; results: Array<Record<string, unknown>> };
  const retrievalReport = okResult(retrieval) as { schema: string; summary: { cases: number }; results: Array<Record<string, unknown>> };
  assert.equal(indexingReport.schema, "browser-rag-ts-worker-actual-report-v1");
  assert.equal(retrievalReport.schema, "browser-rag-ts-worker-actual-report-v1");
  assert.equal(indexingReport.summary.cases, 12);
  assert.equal(retrievalReport.summary.cases, 15);
  assert.equal("expected" in indexingReport.results[0]!, false);
  assert.equal("passed" in retrievalReport.results[0]!, false);
  const exported = await handleRequest(request({ request_id: "actual-export", operation: "export-report", payload: { kind: "retrieval" } }));
  assert.deepEqual(okResult(exported), retrievalReport);
});

test("worker transactionally indexes and searches bounded browser documents", async () => {
  await handleRequest(request({ request_id: "documents-init", operation: "initialize" }));
  const loaded = await handleRequest(request({
    request_id: "documents-load",
    operation: "load-documents",
    payload: {
      documents: [
        { path: "notes/local.md", format: "markdown", content: "# Local note\nBrowser-only copper compass marker." },
        { path: "notes/second.txt", format: "text", content: "A separate source describes a silver sextant." },
      ],
    },
  }));
  const result = okResult(loaded) as { status: string; documents: number; records: number; source_utf8_bytes: number; chunks: Array<{ id: string; path: string; excerpt: string }> };
  assert.equal(result.status, "loaded");
  assert.equal(result.documents, 2);
  assert.equal(result.records, result.chunks.length);
  assert.ok(result.source_utf8_bytes > 0);
  const localChunk = result.chunks.find((chunk) => chunk.path === "notes/local.md");
  if (!localChunk) throw new Error("local document chunk was not returned");
  assert.equal(localChunk.excerpt, "# Local note Browser-only copper compass marker.");
  const source = await handleRequest(request({ request_id: "documents-source", operation: "get-source", payload: { record_id: localChunk.id } }));
  assert.equal((okResult(source) as { content: string }).content, "# Local note\nBrowser-only copper compass marker.");

  const searched = await handleRequest(request({ request_id: "documents-search", operation: "search", payload: { query: "copper compass", options: { mode: "keyword_only", include_scopes: ["browser:local"], top_k: 3 } } }));
  const observation = okResult(searched) as { ordered_ids: string[] };
  assert.equal(observation.ordered_ids[0], localChunk.id);
  const queryReport = await handleRequest(request({ request_id: "documents-query-report", operation: "export-report", payload: { kind: "query", expected_query: "copper compass" } }));
  assert.deepEqual((okResult(queryReport) as { observation: unknown }).observation, observation);
  const mismatchedReport = await handleRequest(request({ request_id: "documents-query-report-mismatch", operation: "export-report", payload: { kind: "query", expected_query: "different query" } }));
  assert.equal(mismatchedReport.status, "error");
  if (mismatchedReport.status === "error" || mismatchedReport.status === "cancelled") assert.equal(mismatchedReport.error.code, "contract_mismatch");

  const proof = await handleRequest(request({ request_id: "documents-proof", operation: "run-retrieval-contract" }));
  assert.equal((okResult(proof) as { summary: { cases: number } }).summary.cases, 15);
  const stillLocal = await handleRequest(request({ request_id: "documents-search-after-proof", operation: "search", payload: { query: "copper compass", options: { mode: "keyword_only", include_scopes: ["browser:local"], top_k: 3 } } }));
  assert.equal((okResult(stillLocal) as { ordered_ids: string[] }).ordered_ids[0], localChunk.id);

  const rejected = await handleRequest(request({ request_id: "documents-rejected", operation: "load-documents", payload: { documents: [{ path: "empty.txt", format: "text", content: "   " }] } }));
  assert.equal(rejected.status, "error");
  if (rejected.status === "error" || rejected.status === "cancelled") assert.equal(rejected.error.code, "invalid_payload");
  const afterFailure = await handleRequest(request({ request_id: "documents-search-after-failure", operation: "search", payload: { query: "copper compass", options: { mode: "keyword_only", include_scopes: ["browser:local"], top_k: 3 } } }));
  assert.equal((okResult(afterFailure) as { ordered_ids: string[] }).ordered_ids[0], localChunk.id);
});

test("worker bounds display headings without rejecting valid long source headings", async () => {
  await handleRequest(request({ request_id: "long-heading-init", operation: "initialize" }));
  const heading = "H".repeat(1_025);
  const loaded = okResult(await handleRequest(request({
    request_id: "long-heading-load",
    operation: "load-documents",
    payload: { documents: [{ path: "long-heading.md", format: "markdown", content: `# ${heading}\nLong heading marker.` }] },
  }))) as { chunks: Array<{ id: string; heading: string }> };
  assert.equal(loaded.chunks[0]?.heading.length, 512);
  assert.equal(loaded.chunks[0]?.heading.endsWith("…"), true);
  const source = okResult(await handleRequest(request({ request_id: "long-heading-source", operation: "get-source", payload: { record_id: loaded.chunks[0]?.id } }))) as { heading: string; content: string };
  assert.equal(source.heading, loaded.chunks[0]?.heading);
  assert.equal(source.content.includes(heading), true);
});

test("graph projection is additive and cannot alter retrieval ordering", async () => {
  await handleRequest(request({ request_id: "graph-init", operation: "initialize" }));
  const before = await handleRequest(request({ request_id: "graph-search-before", operation: "search", payload: { query: "stable marker", options: { mode: "exact_only", top_k: 3, expand: true } } }));
  const graph = await handleRequest(request({ request_id: "graph-projection", operation: "get-graph", payload: { view: "evidence" } }));
  const projection = okResult(graph) as { view: string; nodes: Array<{ record_id: string | null; source_id: string | null }>; links: Array<{ kind: string }> };
  assert.equal(projection.view, "evidence");
  assert.equal(projection.nodes.some((node) => node.record_id !== null && node.source_id !== null), true);
  assert.equal(projection.links.some((link) => link.kind === "reference"), true);
  const after = await handleRequest(request({ request_id: "graph-search-after", operation: "search", payload: { query: "stable marker", options: { mode: "exact_only", top_k: 3, expand: true } } }));
  assert.deepEqual(okResult(after), okResult(before));

  const folders = await handleRequest(request({ request_id: "graph-folders", operation: "get-graph", payload: { view: "folders" } }));
  assert.equal((okResult(folders) as { view: string }).view, "folders");
});

test("cancelled document replacement preserves the active corpus", async () => {
  await handleRequest(request({ request_id: "documents-cancel-init", operation: "initialize" }));
  const baseline = await handleRequest(request({
    request_id: "documents-cancel-baseline",
    operation: "load-documents",
    payload: { documents: [{ path: "baseline.md", format: "markdown", content: "# Baseline\nPersistent amber anchor." }] },
  }));
  const baselineChunk = (okResult(baseline) as { chunks: Array<{ id: string }> }).chunks[0];
  if (!baselineChunk) throw new Error("baseline document chunk was not returned");

  const pending = handleRequest(request({
    request_id: "documents-cancel-load",
    operation: "load-documents",
    payload: {
      documents: Array.from({ length: 64 }, (_, index) => ({
        path: `replacement/${index}.txt`,
        format: "text",
        content: `Replacement document ${index} ${"bounded work ".repeat(64)}`,
      })),
    },
  }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const acknowledgement = await handleRequest(request({ request_id: "documents-cancel-control", operation: "cancel", payload: { request_id: "documents-cancel-load" } }));
  assert.deepEqual(okResult(acknowledgement), { cancelled: "documents-cancel-load" });
  assert.equal((await pending).status, "cancelled");

  const afterCancellation = await handleRequest(request({ request_id: "documents-cancel-search", operation: "search", payload: { query: "amber anchor", options: { mode: "keyword_only", include_scopes: ["browser:local"], top_k: 1 } } }));
  assert.equal((okResult(afterCancellation) as { ordered_ids: string[] }).ordered_ids[0], baselineChunk.id);
});

test("a cancellation arriving after document commit is acknowledged as too late", async () => {
  await handleRequest(request({ request_id: "documents-late-cancel-init", operation: "initialize" }));
  const loaded = await handleRequest(request({
    request_id: "documents-late-cancel-load",
    operation: "load-documents",
    payload: { documents: [{ path: "committed.txt", format: "text", content: "Committed copper marker." }] },
  }));
  assert.equal(loaded.status, "ok");
  const acknowledgement = await handleRequest(request({
    request_id: "documents-late-cancel-control",
    operation: "cancel",
    payload: { request_id: "documents-late-cancel-load" },
  }));
  assert.deepEqual(okResult(acknowledgement), { cancelled: null });
});

test("cooperative retrieval cancellation is request-scoped and a newer query completes", async () => {
  await handleRequest(request({ request_id: "cancel-init", operation: "initialize", payload: { synthetic_record_count: 4_096 } }));
  const pending = handleRequest(request({ request_id: "cancel-search", operation: "search", payload: { query: "release", options: { mode: "exact_only", top_k: 1 } } }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const overlapping = await handleRequest(request({ request_id: "cancel-overlap", operation: "search", payload: { query: "release", options: { mode: "exact_only", top_k: 1 } } }));
  assert.equal(overlapping.status, "error");
  if (overlapping.status === "error" || overlapping.status === "cancelled") assert.equal(overlapping.error.code, "operation_busy");
  const acknowledgement = await handleRequest(request({ request_id: "cancel-control", operation: "cancel", payload: { request_id: "cancel-search" } }));
  assert.deepEqual(okResult(acknowledgement), { cancelled: "cancel-search" });
  const cancelled = await pending;
  assert.equal(cancelled.status, "cancelled");
  const next = await handleRequest(request({ request_id: "cancel-next", operation: "search", payload: { query: "release", options: { mode: "exact_only", top_k: 1 } } }));
  const observation = okResult(next) as { ordered_ids: string[] };
  assert.equal(observation.ordered_ids.length, 1);
});

test("dispose cancels active retrieval and suppresses its later success response", async () => {
  await handleRequest(request({ request_id: "dispose-active-init", operation: "initialize", payload: { synthetic_record_count: 4_096 } }));
  const pending = handleRequest(request({ request_id: "dispose-active-search", operation: "search", payload: { query: "release", options: { mode: "exact_only", top_k: 1 } } }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const disposing = handleRequest(request({ request_id: "dispose-active-control", operation: "dispose" }));
  const cancelled = await pending;
  assert.equal(cancelled.status, "cancelled");
  assert.deepEqual(okResult(await disposing), { disposed: true });
});

test("worker rejects duplicate request IDs rather than replaying stale results", async () => {
  const first = await handleRequest(request({ request_id: "duplicate-id", operation: "initialize" }));
  assert.equal(first.status, "ok");
  const repeated = await handleRequest(request({ request_id: "duplicate-id", operation: "initialize" }));
  assert.equal(repeated.status, "error");
  if (repeated.status === "error" || repeated.status === "cancelled") assert.equal(repeated.error.code, "duplicate_request_id");
});

test("dispose cancels future use until an explicit reinitialization", async () => {
  await handleRequest(request({ request_id: "dispose-init", operation: "initialize" }));
  const disposed = await handleRequest(request({ request_id: "dispose-control", operation: "dispose" }));
  assert.deepEqual(okResult(disposed), { disposed: true });
  const rejected = await handleRequest(request({ request_id: "dispose-search", operation: "search", payload: { query: "release" } }));
  assert.equal(rejected.status, "error");
  if (rejected.status === "error" || rejected.status === "cancelled") assert.equal(rejected.error.code, "disposed");
  const reinitialized = await handleRequest(request({ request_id: "dispose-reinit", operation: "initialize" }));
  assert.equal((okResult(reinitialized) as { status: string }).status, "initialized");
});

test("worker client validates responses, ignores valid stale responses, and enters a terminal failed state", async () => {
  class FakeWorker {
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
    readonly posted: WorkerRequest[] = [];
    terminated = false;

    postMessage(value: WorkerRequest): void {
      this.posted.push(value);
      queueMicrotask(() => this.onmessage?.({ data: { version: 1, request_id: value.request_id, status: "ok", contract: null, result: initializationResult() } } as MessageEvent<unknown>));
    }

    terminate(): void { this.terminated = true; }
  }

  const fake = new FakeWorker();
  const failures: string[] = [];
  const client = new BrowserRagWorkerClient(fake as unknown as Worker, { onFailure: (error) => failures.push(error.message) });
  const handle = client.requestHandle("initialize");
  fake.onmessage?.({ data: { version: 1, request_id: "stale", status: "ok", contract: null, result: { ok: false } } } as MessageEvent<unknown>);
  assert.deepEqual(await handle.promise, initializationResult());
  const invalid = client.request("initialize");
  fake.onmessage?.({ data: { version: 1, request_id: "request-2", status: "ok", contract: null, result: { ok: true }, unexpected: true } } as MessageEvent<unknown>);
  await assert.rejects(invalid, /worker response is invalid/);
  assert.equal(fake.terminated, true);
  assert.equal(client.isActive, false);
  assert.deepEqual(failures, ["worker response is invalid: worker response has invalid fields"]);
  await assert.rejects(client.request("initialize"), /worker client is failed/);
});

test("worker client bounds pending cancellable work and sends cancellation on deadline", async () => {
  class TimeoutWorker {
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
    readonly posted: WorkerRequest[] = [];
    terminated = false;

    postMessage(value: WorkerRequest): void {
      this.posted.push(value);
      if (value.operation === "cancel") {
        queueMicrotask(() => this.onmessage?.({ data: { version: 1, request_id: value.request_id, status: "ok", contract: null, result: { cancelled: value.payload.request_id } } } as MessageEvent<unknown>));
      }
      if (value.operation === "initialize") {
        queueMicrotask(() => this.onmessage?.({ data: { version: 1, request_id: value.request_id, status: "ok", contract: null, result: initializationResult() } } as MessageEvent<unknown>));
      }
    }

    terminate(): void { this.terminated = true; }
  }

  const worker = new TimeoutWorker();
  const client = new BrowserRagWorkerClient(worker as unknown as Worker, { requestTimeoutMs: 5, maxPendingRequests: 2 });
  const search = client.requestHandle("search", { query: "release" });
  await assert.rejects(search.promise, WorkerRequestTimeoutError);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(worker.posted.some((request) => request.operation === "cancel" && request.payload.request_id === search.requestId), true);
  assert.equal((await client.request("initialize")).status, "initialized");
  const load = client.requestHandle("load-documents", { documents: [{ path: "slow.txt", format: "text", content: "bounded local content" }] });
  await assert.rejects(load.promise, WorkerRequestTimeoutError);
  const lateResult = {
    status: "loaded",
    documents: 1,
    records: 1,
    source_utf8_bytes: 21,
    chunks: [{ id: "late-record", source_id: "late-source", path: "slow.txt", excerpt: "bounded local content", heading: "Overview", heading_level: 0 }],
  };
  worker.onmessage?.({ data: { version: 1, request_id: load.requestId, status: "ok", contract: null, result: lateResult } } as MessageEvent<unknown>);
  assert.equal(worker.terminated, true);
  assert.equal(client.isActive, false);
  await assert.rejects(client.request("initialize"), /worker client is failed/);

  const graphWorker = new TimeoutWorker();
  const graphClient = new BrowserRagWorkerClient(graphWorker as unknown as Worker, { requestTimeoutMs: 5, maxPendingRequests: 2 });
  const graph = graphClient.requestHandle("get-graph", { view: "evidence", request_generation: 1 });
  await assert.rejects(graph.promise, WorkerRequestTimeoutError);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(graphWorker.posted.some((request) => request.operation === "cancel" && request.payload.request_id === graph.requestId), true);
  assert.equal(graphClient.isActive, true);
  assert.equal((await graphClient.request("initialize")).status, "initialized");
});

test("worker client accepts forward import progress, renews its active deadline, and rejects progress for reads", async () => {
  class ProgressWorker {
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
    terminated = false;

    postMessage(value: WorkerRequest): void {
      if (value.operation === "load-documents") {
        setTimeout(() => this.onmessage?.({ data: { version: 1, request_id: value.request_id, status: "progress", contract: null, result: { phase: "indexing", completed: 1, total: 1 } } } as MessageEvent<unknown>), 20);
        setTimeout(() => this.onmessage?.({ data: { version: 1, request_id: value.request_id, status: "ok", contract: null, result: { status: "loaded", documents: 1, records: 1, source_utf8_bytes: 7, chunks: [{ id: "record", source_id: "source", path: "note.md", excerpt: "# Note", heading: "Note", heading_level: 1 }] } } } as MessageEvent<unknown>), 40);
      }
    }

    terminate(): void { this.terminated = true; }
  }

  const worker = new ProgressWorker();
  const progress: number[] = [];
  const client = new BrowserRagWorkerClient(worker as unknown as Worker, { requestTimeoutMs: 30 });
  const loaded = await client.requestHandle("load-documents", { documents: [{ path: "note.md", format: "markdown", content: "# Note" }] }, (value) => progress.push(value.completed)).promise;
  assert.equal(loaded.status, "loaded");
  assert.deepEqual(progress, [1]);
  assert.equal(client.isActive, true);

  class InvalidProgressWorker extends ProgressWorker {
    override postMessage(value: WorkerRequest): void {
      queueMicrotask(() => this.onmessage?.({ data: { version: 1, request_id: value.request_id, status: "progress", contract: null, result: { phase: "indexing", completed: 1, total: 1 } } } as MessageEvent<unknown>));
    }
  }
  const invalidWorker = new InvalidProgressWorker();
  const invalidClient = new BrowserRagWorkerClient(invalidWorker as unknown as Worker, { requestTimeoutMs: 30 });
  await assert.rejects(invalidClient.request("search", { query: "note" }), /cannot report indexing progress/);
  assert.equal(invalidWorker.terminated, true);
  assert.equal(invalidClient.isActive, false);
});
