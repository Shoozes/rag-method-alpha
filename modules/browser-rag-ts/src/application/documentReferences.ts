import { resolveApplicationReferences } from "../core/indexing/references.js";
import { compareUnicodeScalars } from "../core/shared/scalarOrder.js";
import type { RagRecord } from "../core/shared/types.js";

const MARKDOWN_LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu;

function fragmentKey(value: string): string {
  return value.normalize("NFKC").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/gu, "");
}

function decodeLinkPart(value: string): string | null {
  try { return decodeURIComponent(value); }
  catch { return null; }
}

function resolvePath(ownerPath: string, target: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/iu.test(target) || target.startsWith("//")) return null;
  const decoded = decodeLinkPart(target.replaceAll("\\", "/"));
  if (decoded === null) return null;
  const base = decoded.startsWith("/") ? [] : ownerPath.split("/").slice(0, -1);
  for (const part of decoded.replace(/^\/+/, "").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!base.length) return null;
      base.pop();
    } else base.push(part.replace(/\.html$/iu, ".md"));
  }
  return base.join("/");
}

/** Add application-only Markdown relationships without changing frozen indexing. */
export function resolveDocumentReferences(records: readonly RagRecord[]): readonly RagRecord[] {
  const wikiResolved = resolveApplicationReferences(records);
  const ordered = [...wikiResolved].sort((left, right) => compareUnicodeScalars(left.id, right.id));
  const byPath = new Map<string, RagRecord[]>();
  for (const record of ordered) {
    const values = byPath.get(record.path);
    if (values) values.push(record);
    else byPath.set(record.path, [record]);
  }
  return wikiResolved.map((record) => {
    const references = [...record.references];
    for (const match of record.text.matchAll(MARKDOWN_LINK)) {
      const raw = match[1]!;
      const hash = raw.indexOf("#");
      const rawTarget = hash < 0 ? raw : raw.slice(0, hash);
      const targetPath = rawTarget ? resolvePath(record.path, rawTarget) : record.path;
      if (!targetPath) continue;
      const candidates = byPath.get(targetPath) ?? [];
      const decodedFragment = hash < 0 ? "" : decodeLinkPart(raw.slice(hash + 1));
      if (decodedFragment === null) continue;
      const fragment = fragmentKey(decodedFragment);
      const target = (fragment
        ? candidates.find((candidate) => fragmentKey(String(candidate.metadata.heading ?? "")) === fragment)
        : undefined) ?? candidates[0];
      if (target && target.id !== record.id && !references.includes(target.id)) references.push(target.id);
    }
    return references.length === record.references.length ? record : { ...record, references };
  });
}
