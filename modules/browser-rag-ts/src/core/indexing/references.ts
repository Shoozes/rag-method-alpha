import { compareUnicodeScalars, isPythonUnicodeAlphanumericCodepoint, lowercasePythonUnicode, normalizeNfkc } from "../shared/unicode.js";
import type { RagRecord } from "../shared/types.js";

const WIKI_LINK = /\[\[([^\]]+?)\]\]/gu;

function referenceKey(value: string): string {
  const target = value.split("|", 1)[0]!.split("#", 1)[0]!;
  const normalized = lowercasePythonUnicode(normalizeNfkc(target));
  const terms: string[] = [];
  let current = "";
  for (const scalar of normalized) {
    if (isPythonUnicodeAlphanumericCodepoint(scalar.codePointAt(0)!)) current += scalar;
    else if (current) { terms.push(current); current = ""; }
  }
  if (current) terms.push(current);
  return terms.join(" ");
}

function sourceStem(sourceName: string): string {
  const separator = Math.max(sourceName.lastIndexOf("/"), sourceName.lastIndexOf("\\"));
  const baseName = sourceName.slice(separator + 1);
  const suffix = baseName.lastIndexOf(".");
  return suffix > 0 && suffix < baseName.length - 1 ? baseName.slice(0, suffix) : baseName;
}

/** Resolve application wiki links to record IDs exactly like the Python adapter. */
export function resolveApplicationReferences(records: readonly RagRecord[]): readonly RagRecord[] {
  const ordered = [...records].sort((left, right) =>
    compareUnicodeScalars(left.source_id, right.source_id) || compareUnicodeScalars(left.id, right.id));
  const byReference = new Map<string, RagRecord[]>();
  for (const record of ordered) {
    const key = referenceKey(sourceStem(record.source_name));
    const values = byReference.get(key);
    if (values) values.push(record);
    else byReference.set(key, [record]);
  }
  return records.map((record) => {
    const references = [...record.references];
    for (const match of record.text.matchAll(WIKI_LINK)) {
      const targets = byReference.get(referenceKey(match[1]!)) ?? [];
      const target = targets.find((candidate) => candidate.source_id !== record.source_id && !references.includes(candidate.id));
      if (target) references.push(target.id);
    }
    return references.length === record.references.length ? record : { ...record, references };
  });
}
