import test from "node:test";
import assert from "node:assert/strict";
import { RagEngine } from "../../src/core/retrieval/engine.js";
import { matchingScopePriority } from "../../src/core/retrieval/scopes.js";
import { conformanceRecord } from "../conformance/fixtures.js";

const prototypeNames = ["constructor", "toString", "__proto__"];

test("prototype-like scopes have zero default priority and finite retrieval scores", () => {
  for (const scope of prototypeNames) {
    const engine = new RagEngine([conformanceRecord("note", "scope priority beacon", { scopes: [scope] })]);
    for (const options of [{}, { scope_priorities: {} }]) {
      const result = engine.search("scope priority beacon", { mode: "exact_only", ...options }).results[0]!;
      assert.equal(result.scope_priority, 0, scope);
      assert.equal(result.priority_micro, 0, scope);
      assert.ok(Number.isFinite(result.score_micro), scope);
    }
  }
});

test("prototype-like priority keys survive normalization in synchronous and cooperative retrieval", async () => {
  for (const scope of prototypeNames) {
    const engine = new RagEngine([conformanceRecord("note", "scope priority beacon", { scopes: [scope] })]);
    const options = { mode: "scoped_hybrid" as const, scope_priorities: Object.fromEntries([[`\u001c ${scope} `, 23]]) };
    const response = engine.search("scope priority beacon", options);
    assert.equal(response.results[0]?.scope_priority, 23, scope);
    assert.equal(response.results[0]?.priority_micro, 230_000, scope);
    assert.ok(Number.isFinite(response.results[0]?.score_micro), scope);
    assert.deepEqual(await engine.searchAsync("scope priority beacon", options, async () => undefined), response);
  }
});

test("scope priority lookup considers only configured own keys, including negative priorities", () => {
  const priorities = Object.create({ inherited: 99 }) as Record<string, number>;
  priorities.own = -15;
  const record = conformanceRecord("note", "scope priority beacon", { scopes: ["inherited", "own", "constructor"] });
  assert.equal(matchingScopePriority(record, priorities), -15);
  assert.equal(matchingScopePriority(record, {}), 0);
  assert.equal(matchingScopePriority(record, Object.fromEntries([["constructor", 23], ["own", -15]])), 23);
});

test("scope priorities reject non-object JSON values with a contract error", () => {
  const engine = new RagEngine([conformanceRecord("note", "scope priority beacon")]);
  for (const value of [[], [23], "", "23", 23, true, null]) {
    assert.throws(() => engine.search("beacon", { scope_priorities: value as unknown as Record<string, number> }),
      { name: "ContractError", code: "contract_error", message: "scope_priorities must be an object" });
  }
});

test("scope priority normalization still rejects duplicate keys", () => {
  const engine = new RagEngine([conformanceRecord("note", "scope priority beacon")]);
  for (const scope of ["global", ...prototypeNames]) {
    assert.throws(() => engine.search("beacon", { scope_priorities: Object.fromEntries([[scope, 1], [`\u001c${scope} `, 2]]) }),
      /duplicate normalized scopes/u);
  }
});
