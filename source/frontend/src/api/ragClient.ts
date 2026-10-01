import type {
  CompanionsResponse,
  GraphData,
  ImportResponse,
  PocketName,
  RagBehaviorMode,
  SearchResponse,
} from "../types/rag";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function apiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

type ApiErrorPayload = {
  detail?: string | Array<{ message?: string }>;
  error?: string;
};

type RequestInitWithSignal = RequestInit & { signal?: AbortSignal };
export type UploadEntry = { file: File; relativePath: string };
export type SearchRequest = {
  query: string;
  companionId: string;
  pockets: readonly PocketName[];
  mode: RagBehaviorMode;
  topK: number;
  maxContextTokens: number;
  debug: boolean;
  signal?: AbortSignal;
};
const REQUEST_TIMEOUT_MS = 180_000;
const MUTATION_REQUEST_HEADER = "X-RAG-Method-Request";
const MUTATION_REQUEST_VALUE = "1";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function uploadEntriesFromFiles(files: readonly File[]): UploadEntry[] {
  return files.map((file) => ({
    file,
    relativePath:
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
  }));
}

async function request<T>(path: string, init: RequestInitWithSignal = {}): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const removeAbortListener = (() => {
    if (!init.signal) return () => undefined;
    const abort = () => controller.abort();
    if (init.signal.aborted) {
      controller.abort();
      return () => undefined;
    }
    init.signal.addEventListener("abort", abort, { once: true });
    return () => init.signal?.removeEventListener("abort", abort);
  })();

  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!SAFE_METHODS.has((init.method || "GET").toUpperCase())) {
    headers.set(MUTATION_REQUEST_HEADER, MUTATION_REQUEST_VALUE);
  }

  try {
    const response = await fetch(path, {
      ...init,
      headers,
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") || "";
    const payload: unknown = contentType.includes("application/json")
      ? await response.json().catch(() => ({}))
      : await response.text();

    if (!response.ok) {
      const errorPayload =
        typeof payload === "object" && payload !== null
          ? (payload as ApiErrorPayload)
          : undefined;
      const detail =
        typeof errorPayload?.detail === "string"
          ? errorPayload.detail
          : errorPayload?.detail?.[0]?.message || errorPayload?.error;
      throw new ApiError(detail || `Request failed with HTTP ${response.status}`, response.status);
    }

    return payload as T;
  } catch (error) {
    if (timedOut) {
      throw new ApiError("Request timed out while the backend was working.", 408);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    removeAbortListener();
  }
}

export const ragClient = {
  listCompanions(): Promise<CompanionsResponse> {
    return request<CompanionsResponse>("/api/companions");
  },

  getGraph(
    companionId: string,
    pockets: readonly PocketName[],
    force = false,
    signal?: AbortSignal,
  ): Promise<GraphData> {
    const params = new URLSearchParams({ companion_id: companionId });
    if (pockets.length) params.set("pockets", pockets.join(","));
    if (force) params.set("force", "1");
    return request<GraphData>(`/rag/graph?${params.toString()}`, { signal });
  },

  search(options: SearchRequest): Promise<SearchResponse> {
    const params = new URLSearchParams({
      query: options.query,
      companion_id: options.companionId,
      mode: options.mode,
      top_k: String(options.topK),
      max_context_tokens: String(options.maxContextTokens),
      debug: options.debug ? "1" : "0",
    });
    const pockets = options.pockets;
    if (pockets.length) params.set("pockets", pockets.join(","));
    return request<SearchResponse>(`/rag/search?${params.toString()}`, {
      signal: options.signal,
    });
  },

  uploadZip(file: File, companionId: string): Promise<ImportResponse> {
    const form = new FormData();
    form.append("file", file);
    if (companionId) form.append("companion_id", companionId);
    return request<ImportResponse>("/rag/import/vault-zip", { method: "POST", body: form });
  },

  uploadFolder(entries: readonly UploadEntry[], companionId: string): Promise<ImportResponse> {
    const form = new FormData();
    for (const { file, relativePath } of entries) {
      form.append("files", file, relativePath);
    }
    if (companionId) form.append("companion_id", companionId);
    return request<ImportResponse>("/rag/import/folder-upload", {
      method: "POST",
      body: form,
    });
  },
};
