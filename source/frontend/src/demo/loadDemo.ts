import type { UploadEntry } from "../api/ragClient";

export const DEMO_COLLECTION_ID = "rag-method-demo-v1";
export const DEMO_DISPLAY_NAME = "RAG Method Demo";

export type DemoManifest = {
  schema: "rag_method_demo_manifest_v1";
  fixture_version: "rag-method-demo-v1";
  collection_id: typeof DEMO_COLLECTION_ID;
  display_name: string;
  source_digest: string;
  suggested_queries: string[];
  files: Array<{ relative_path: string; content: string }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeDemoPath(value: string): boolean {
  const parts = value.split("/");
  return (
    value.length > 0 &&
    value.length <= 240 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    parts.every((part) => part.length > 0 && part !== "." && part !== "..") &&
    value.toLowerCase().endsWith(".md")
  );
}

function validateManifest(value: unknown): DemoManifest {
  if (!isRecord(value)) throw new Error("Demo manifest must be a JSON object.");
  if (
    value.schema !== "rag_method_demo_manifest_v1" ||
    value.fixture_version !== "rag-method-demo-v1" ||
    value.collection_id !== DEMO_COLLECTION_ID ||
    value.display_name !== DEMO_DISPLAY_NAME ||
    !/^[a-f0-9]{64}$/.test(String(value.source_digest || "")) ||
    !Array.isArray(value.suggested_queries) ||
    !Array.isArray(value.files)
  ) {
    throw new Error("Demo manifest identity or shape is invalid.");
  }
  if (value.files.length < 1 || value.files.length > 16) {
    throw new Error("Demo manifest file count is outside the supported range.");
  }

  const seen = new Set<string>();
  let contentBytes = 0;
  for (const item of value.files) {
    if (
      !isRecord(item) ||
      typeof item.relative_path !== "string" ||
      typeof item.content !== "string" ||
      !isSafeDemoPath(item.relative_path) ||
      seen.has(item.relative_path)
    ) {
      throw new Error("Demo manifest contains an invalid or duplicate file path.");
    }
    seen.add(item.relative_path);
    contentBytes += new TextEncoder().encode(item.content).byteLength;
  }
  if (contentBytes > 1_000_000) throw new Error("Demo manifest content is too large.");
  if (
    value.suggested_queries.length < 1 ||
    value.suggested_queries.length > 5 ||
    value.suggested_queries.some(
      (query) => typeof query !== "string" || !query.trim() || query.length > 400,
    )
  ) {
    throw new Error("Demo manifest suggested queries are invalid.");
  }
  return value as DemoManifest;
}

export async function loadDemoManifest(signal?: AbortSignal): Promise<DemoManifest> {
  const response = await fetch("/demo/manifest.json", { signal });
  if (!response.ok) throw new Error(`Demo manifest failed with HTTP ${response.status}.`);
  return validateManifest(await response.json());
}

export function demoUploadEntries(manifest: DemoManifest): UploadEntry[] {
  return manifest.files.map(({ relative_path: relativePath, content }) => {
    const segments = relativePath.split("/");
    const name = segments[segments.length - 1];
    return {
      file: new File([content], name, { type: "text/markdown" }),
      relativePath,
    };
  });
}
