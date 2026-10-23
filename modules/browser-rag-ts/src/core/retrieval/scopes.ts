import { RagRecord } from "../shared/types.js";

const RECORDED = new Set(["global_record", "workspace_record", "persona_vault"]);

export function allowedByScope(record: RagRecord, includeScopes: readonly string[], excludeScopes: readonly string[]): boolean {
  if (excludeScopes.includes("all") || record.scopes.some((scope) => excludeScopes.includes(scope))) return false;
  return !includeScopes.length || includeScopes.includes("all") || record.scopes.some((scope) => includeScopes.includes(scope));
}

export function allowedByAuthority(record: RagRecord, policy: string): boolean {
  return policy === "all" || (policy === "recorded_only" && RECORDED.has(record.authority));
}

export function matchingScopePriority(record: RagRecord, priorities: Readonly<Record<string, number>>): number {
  const values = record.scopes.filter((scope) => Object.hasOwn(priorities, scope)).map((scope) => priorities[scope]!);
  return values.length ? Math.max(...values) : 0;
}
