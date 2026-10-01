import { CancelResult, DisposeResult, WORKER_PROTOCOL_VERSION, WorkerOperation, WorkerOperationResult, WorkerProgress, WorkerRequest, WorkerResponse, validateRequest, validateResponse } from "./protocol.js";

export interface BrowserRagWorkerClientOptions {
  readonly requestTimeoutMs?: number;
  readonly maxPendingRequests?: number;
  readonly onFailure?: (error: Error) => void;
}

export interface WorkerRequestHandle<O extends WorkerOperation = WorkerOperation> {
  readonly requestId: string;
  readonly promise: Promise<WorkerOperationResult<O>>;
  cancel(): void;
}

export class WorkerRequestTimeoutError extends Error {
  constructor(readonly requestId: string, readonly operation: WorkerOperation, readonly timeoutMs: number) {
    super(`worker ${operation} request ${requestId} timed out after ${timeoutMs}ms`);
    this.name = "WorkerRequestTimeoutError";
  }
}

type ClientState = "active" | "disposed" | "failed";
type PendingRequest = {
  readonly operation: WorkerOperation;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
  deadline: ReturnType<typeof setTimeout>;
  readonly onProgress?: (progress: WorkerProgress) => void;
  progressCompleted: number;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_PENDING_REQUESTS = 32;
const MAX_REQUEST_TIMEOUT_MS = 120_000;
const MAX_PENDING_REQUESTS = 128;

function boundedOption(value: number | undefined, fallback: number, label: string, maximum: number): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > maximum) throw new Error(`${label} must be an integer between 1 and ${maximum}`);
  return resolved;
}

export class BrowserRagWorkerClient {
  private readonly worker: Worker;
  private readonly requestTimeoutMs: number;
  private readonly maxPendingRequests: number;
  private readonly onFailure: ((error: Error) => void) | undefined;
  private sequence = 0;
  private state: ClientState = "active";
  private readonly pending = new Map<string, PendingRequest>();

  constructor(worker: Worker, options: BrowserRagWorkerClientOptions = {}) {
    this.requestTimeoutMs = boundedOption(options.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, "requestTimeoutMs", MAX_REQUEST_TIMEOUT_MS);
    this.maxPendingRequests = boundedOption(options.maxPendingRequests, DEFAULT_MAX_PENDING_REQUESTS, "maxPendingRequests", MAX_PENDING_REQUESTS);
    this.onFailure = options.onFailure;
    this.worker = worker;
    this.worker.onmessage = (event: MessageEvent<unknown>) => this.receive(event.data);
    this.worker.onerror = (event) => this.fail(new Error(event.message || "worker failed"));
    this.worker.onmessageerror = () => this.fail(new Error("worker message could not be deserialized"));
  }

  get isActive(): boolean { return this.state === "active"; }

  request<O extends WorkerOperation>(operation: O, payload?: unknown): Promise<WorkerOperationResult<O>> {
    return this.requestHandle(operation, payload).promise;
  }

  requestHandle<O extends WorkerOperation>(operation: O, payload?: unknown, onProgress?: (progress: WorkerProgress) => void): WorkerRequestHandle<O> {
    if (this.state !== "active") return this.rejectedHandle<O>(`worker client is ${this.state}`);
    if (this.pending.size >= this.maxPendingRequests) return this.rejectedHandle<O>(`worker client has reached its ${this.maxPendingRequests} pending-request limit`);
    const requestId = `request-${++this.sequence}`;
    let request: WorkerRequest;
    try {
      request = validateRequest({ version: WORKER_PROTOCOL_VERSION, request_id: requestId, operation, ...(payload === undefined ? {} : { payload }) });
    } catch (error) {
      return this.rejectedHandle<O>(error instanceof Error ? error.message : "worker request is invalid");
    }
    let resolvePromise: (value: WorkerOperationResult<O>) => void = () => undefined;
    let rejectPromise: (reason: unknown) => void = () => undefined;
    const promise = new Promise<WorkerOperationResult<O>>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const deadline = setTimeout(() => this.expire(requestId), this.requestTimeoutMs);
    this.pending.set(requestId, {
      operation,
      resolve: (value) => resolvePromise(value as WorkerOperationResult<O>),
      reject: rejectPromise,
      deadline,
      progressCompleted: -1,
      ...(onProgress === undefined ? {} : { onProgress }),
    });
    try {
      this.worker.postMessage(request);
    } catch (error) {
      this.rejectPending(requestId, error);
      this.fail(error);
    }
    return { requestId, promise, cancel: () => { void this.cancel(requestId).catch(() => undefined); } };
  }

  async cancel(requestId: string): Promise<CancelResult> {
    if (this.state !== "active") throw new Error(`worker client is ${this.state}`);
    return this.request("cancel", { request_id: requestId });
  }

  async dispose(): Promise<void> {
    if (this.state !== "active") throw new Error(`worker client is ${this.state}`);
    const result: DisposeResult = await this.request("dispose");
    if (result.disposed !== true) {
      const error = new Error("worker disposal response is invalid");
      this.fail(error);
      throw error;
    }
    this.state = "disposed";
    this.rejectAll(new Error("worker client is disposed"));
    this.worker.terminate();
  }

  terminate(): void {
    if (this.state === "disposed") return;
    this.state = "disposed";
    this.rejectAll(new Error("worker terminated"));
    this.worker.terminate();
  }

  private rejectedHandle<O extends WorkerOperation>(message: string): WorkerRequestHandle<O> {
    return { requestId: "unavailable", promise: Promise.reject(new Error(message)), cancel: () => undefined };
  }

  private receive(value: unknown): void {
    if (this.state !== "active") return;
    let envelope: WorkerResponse;
    try { envelope = validateResponse(value); }
    catch (error) {
      this.fail(new Error(`worker response is invalid: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }
    const pending = this.pending.get(envelope.request_id);
    if (!pending) return;
    let response: WorkerResponse;
    try { response = validateResponse(value, pending.operation); }
    catch (error) {
      this.fail(new Error(`worker response is invalid: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }
    if (response.status === "progress") {
      if (pending.operation !== "load-documents") {
        this.fail(new Error(`worker response is invalid: ${pending.operation} cannot report indexing progress`));
        return;
      }
      if (response.result.completed > pending.progressCompleted) {
        pending.progressCompleted = response.result.completed;
        clearTimeout(pending.deadline);
        pending.deadline = setTimeout(() => this.expire(response.request_id), this.requestTimeoutMs);
      }
      pending.onProgress?.(response.result);
      return;
    }
    this.pending.delete(response.request_id);
    clearTimeout(pending.deadline);
    if (response.status === "ok") pending.resolve(response.result);
    else pending.reject(Object.assign(new Error(response.error.message), { code: response.error.code }));
  }

  private expire(requestId: string): void {
    const pending = this.pending.get(requestId);
    if (!pending || this.state !== "active") return;
    this.pending.delete(requestId);
    clearTimeout(pending.deadline);
    const error = new WorkerRequestTimeoutError(requestId, pending.operation, this.requestTimeoutMs);
    pending.reject(error);
    if (pending.operation === "load-documents") {
      // A replacement may commit immediately before its success response is
      // discarded. End the session rather than let later reads observe a
      // corpus that the page never accepted.
      this.fail(error);
      return;
    }
    if (pending.operation === "search" || pending.operation === "get-graph") {
      void this.cancel(requestId).catch((cancelError) => this.fail(cancelError));
      return;
    }
    this.fail(error);
  }

  private rejectPending(requestId: string, reason: unknown): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    clearTimeout(pending.deadline);
    pending.reject(reason);
  }

  private fail(reason: unknown): void {
    if (this.state !== "active") return;
    this.state = "failed";
    const error = reason instanceof Error ? reason : new Error("worker failed");
    this.rejectAll(error);
    this.worker.terminate();
    this.onFailure?.(error);
  }

  private rejectAll(reason: unknown): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.deadline);
      pending.reject(reason);
    }
    this.pending.clear();
  }
}
