import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launchChromium } from "./browser_runtime.mjs";
import { verifyDemoPolish } from "./browser_demo_polish.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const MODULE = resolve(ROOT, "modules", "browser-rag-ts");
const PROOF_ROOT = resolve(ROOT, ".artifacts", "proof", "browser-rag-ts");
const require = createRequire(pathToFileURL(join(MODULE, "package.json")));
const { chromium } = require("playwright");
const playwrightVersion = require("playwright/package.json").version;
const moduleManifest = JSON.parse(await readFile(join(MODULE, "module.json"), "utf8"));
const MODULE_VERSION = moduleManifest.version;
const CHECK_NAMES = Object.freeze([
  "page_ready",
  "identity_marker",
  "heading_visible",
  "worker_initialized",
  "graph_projection",
  "renderer_tsl_active",
  "renderer_webgl2_device_loss_fallback",
  "renderer_svg_opt_out",
  "default_presentation",
  "initial_worker_reports",
  "worker_actual_reports_downloaded",
  "exact_query",
  "keyword_query",
  "fixture_semantic_query",
  "scoped_query",
  "cross_reference_query",
  "result_to_graph_selection",
  "renderer_selection_diagnostics",
  "managed_canvas_selection",
  "graph_to_result_selection",
  "graph_view_switch",
  "graph_rapid_view_cancellation",
  "foreground_graph_coordination",
  "selection_reset",
  "component_scores_visible",
  "context_visible",
  "readable_evidence",
  "managed_mobile_auto_viewport",
  "managed_mobile_webgl2_viewport",
  "managed_resize_rotation",
  "svg_mobile_view_switch",
  "svg_text_zoom_rotation",
  "reduced_motion",
  "responsive_captures",
  "query_report_downloaded",
  "query_report_copy",
  "query_report_failure_isolation",
  "local_document_query",
  "selected_outside_graph_window",
  "long_heading_graph_isolation",
  "real_worker_cancellation",
  "diagnostic_preserves_collection",
  "worker_disposal",
  "session_cleanup",
]);
const SCORE_COMPONENTS = Object.freeze([
  "exact_micro", "semantic_micro", "keyword_micro", "scope_micro", "provenance_micro",
  "authority_micro", "priority_micro", "aspect_coverage_micro", "cross_reference_micro",
]);
const EXPECTED_RENDERER_WARNING = /^(?:No available adapters\.|THREE\.WebGPURenderer: WebGPU is not available, running under WebGL2 backend\.|\[\.WebGL-.*\]GL Driver Message)/u;
const EXPECTED_RENDERER_ERROR = /^THREE\.THREE\.WebGPURenderer: WebGL Device Lost:/u;

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (!process.argv[index + 1]) throw new Error(`${name} requires a value`);
  return process.argv[index + 1];
}

function proofPath(value, label) {
  const output = resolve(value);
  if (!isAbsolute(output) || relative(PROOF_ROOT, output).startsWith("..") || isAbsolute(relative(PROOF_ROOT, output))) throw new Error(`${label} must remain under ${PROOF_ROOT}`);
  return output;
}

function elapsed(start) { return Number((performance.now() - start).toFixed(3)); }

async function delayGraphRequests(page, delayMs = 500) {
  await page.addInitScript((delay) => {
    const NativeWorker = window.Worker;
    window.Worker = class DelayedGraphWorker extends NativeWorker {
      postMessage(message, transfer) {
        const send = () => {
          if (transfer === undefined) super.postMessage(message);
          else super.postMessage(message, transfer);
        };
        if (message && typeof message === "object" && message.operation === "get-graph") setTimeout(send, delay);
        else send();
      }
    };
  }, delayMs);
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`${label} must be a plain object`);
  return value;
}

function exact(value, fields, label) {
  const object = plainObject(value, label);
  const actual = Object.keys(object).sort();
  const expected = [...fields].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} fields are invalid`);
  return object;
}

function nonEmptyString(value, label, maximum = 16_384) {
  if (typeof value !== "string" || !value || value.length > maximum) throw new Error(`${label} must be a bounded non-empty string`);
  return value;
}

function integer(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${label} must be an integer between ${minimum} and ${maximum}`);
  return value;
}

function digest(value, label) {
  const result = nonEmptyString(value, label, 64);
  if (!/^[0-9a-f]{64}$/.test(result)) throw new Error(`${label} must be a SHA-256 digest`);
  return result;
}

function stringArray(value, label, maximum = 50_000) {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${label} must be a bounded string array`);
  return value.map((item, index) => nonEmptyString(item, `${label}[${index}]`, 16_384));
}

function contractIdentity(value, expectedId, label) {
  const identity = exact(value, ["id", "version", "runtime_snapshot_digest", "input_digests"], label);
  if (identity.id !== expectedId) throw new Error(`${label} has the wrong contract ID`);
  integer(identity.version, `${label} version`, 1, 1_000);
  digest(identity.runtime_snapshot_digest, `${label} snapshot digest`);
  const inputs = plainObject(identity.input_digests, `${label} input digests`);
  if (!Object.keys(inputs).length) throw new Error(`${label} has no input digests`);
  for (const [path, value] of Object.entries(inputs)) {
    nonEmptyString(path, `${label} input path`, 512);
    digest(value, `${label} input digest`);
  }
}

function observation(value, label) {
  const report = exact(value, ["eligible_ids", "candidate_ids", "ordered_ids", "scores", "context_selected_ids", "context_tokens", "truncated", "semantic_state", "semantic_fallback_reason", "errors"], label);
  const ordered = stringArray(report.ordered_ids, `${label} ordered_ids`, 100);
  const scores = report.scores;
  if (!Array.isArray(scores) || scores.length > 100) throw new Error(`${label} scores are invalid`);
  const scoreIds = scores.map((entry, index) => {
    const score = exact(entry, ["id", "score_micro", "components", "cross_reference_from_id"], `${label} score ${index}`);
    const id = nonEmptyString(score.id, `${label} score ${index} ID`, 128);
    integer(score.score_micro, `${label} score ${index}`, 0, 1_000_000);
    const components = exact(score.components, SCORE_COMPONENTS, `${label} score ${index} components`);
    for (const name of SCORE_COMPONENTS) integer(components[name], `${label} score ${index} ${name}`, -1_000_000, 1_000_000);
    if (score.cross_reference_from_id !== null) nonEmptyString(score.cross_reference_from_id, `${label} score ${index} reference`, 128);
    return id;
  });
  if (JSON.stringify(ordered) !== JSON.stringify(scoreIds)) throw new Error(`${label} ordered IDs do not match scores`);
  stringArray(report.eligible_ids, `${label} eligible IDs`);
  stringArray(report.candidate_ids, `${label} candidate IDs`);
  stringArray(report.context_selected_ids, `${label} context IDs`, 100);
  integer(report.context_tokens, `${label} context tokens`, 0, 1_800);
  if (typeof report.truncated !== "boolean") throw new Error(`${label} truncated is invalid`);
  if (!["not_requested", "ready", "disabled_by_settings", "lexical_fallback"].includes(report.semantic_state)) throw new Error(`${label} semantic state is invalid`);
  if (report.semantic_fallback_reason !== null && !["disabled_by_settings", "no_compatible_vectors", "embedding_failed"].includes(report.semantic_fallback_reason)) throw new Error(`${label} fallback reason is invalid`);
  stringArray(report.errors, `${label} errors`, 1_000);
}

function indexingActual(value, label) {
  const envelope = plainObject(value, label);
  if (envelope.status === "error") {
    const failed = exact(envelope, ["status", "error"], label);
    const details = exact(failed.error, ["code"], `${label} error`);
    nonEmptyString(details.code, `${label} error code`, 128);
    return;
  }
  const success = exact(envelope, ["status", "document"], label);
  if (success.status !== "ok") throw new Error(`${label} status is invalid`);
  const document = exact(success.document, ["format", "path", "pocket", "scopes", "authority", "priority", "source_id", "source_content_id", "source_utf8_bytes", "canonical_content_id", "canonical_scalar_count", "normalization", "limits", "records"], `${label} document`);
  if (!["markdown", "text"].includes(document.format)) throw new Error(`${label} format is invalid`);
  for (const field of ["path", "pocket", "authority"]) nonEmptyString(document[field], `${label} ${field}`, 256);
  stringArray(document.scopes, `${label} scopes`, 16);
  integer(document.priority, `${label} priority`, -100, 100);
  for (const field of ["source_id", "source_content_id", "canonical_content_id"]) digest(document[field], `${label} ${field}`);
  integer(document.source_utf8_bytes, `${label} source bytes`, 0, 10 * 1024 * 1024);
  integer(document.canonical_scalar_count, `${label} scalar count`, 0, 10 * 1024 * 1024);
  const normalization = exact(document.normalization, ["bom_removed", "line_endings_changed", "frontmatter_removed"], `${label} normalization`);
  if (Object.values(normalization).some((item) => typeof item !== "boolean")) throw new Error(`${label} normalization is invalid`);
  const limits = exact(document.limits, ["max_chars", "max_tokens"], `${label} limits`);
  integer(limits.max_chars, `${label} max chars`, 1, 1_000_000);
  integer(limits.max_tokens, `${label} max tokens`, 1, 1_000_000);
  if (!Array.isArray(document.records) || document.records.length > 50_000) throw new Error(`${label} records are invalid`);
  for (const [index, entry] of document.records.entries()) {
    const record = exact(entry, ["id", "text", "source_id", "source_name", "path", "pocket", "scope", "scopes", "authority", "priority", "provenance", "references", "embedding_profile_id", "metadata"], `${label} record ${index}`);
    for (const field of ["id", "text", "source_id", "source_name", "path", "pocket", "scope", "authority"]) nonEmptyString(record[field], `${label} record ${index} ${field}`, 16_384);
    stringArray(record.scopes, `${label} record ${index} scopes`, 16);
    integer(record.priority, `${label} record ${index} priority`, -100, 100);
    const provenance = exact(record.provenance, ["file_source", "chunk_source"], `${label} record ${index} provenance`);
    if (typeof provenance.file_source !== "boolean" || typeof provenance.chunk_source !== "boolean") throw new Error(`${label} record ${index} provenance is invalid`);
    stringArray(record.references, `${label} record ${index} references`, 1_024);
    if (record.embedding_profile_id !== null) nonEmptyString(record.embedding_profile_id, `${label} record ${index} embedding profile`, 128);
    plainObject(record.metadata, `${label} record ${index} metadata`);
  }
}

function actualReport(value, kind) {
  const report = exact(value, ["schema", "protocol_version", "kind", "identity", "contract", "summary", "results"], `${kind} report`);
  if (report.schema !== "browser-rag-ts-worker-actual-report-v1" || report.protocol_version !== 1 || report.kind !== kind) throw new Error(`${kind} report identity is invalid`);
  const identity = exact(report.identity, ["implementation", "language", "module_version"], `${kind} report identity`);
  if (identity.implementation !== "rag-method-browser-ts-worker" || identity.language !== "typescript" || identity.module_version !== MODULE_VERSION) throw new Error(`${kind} report implementation identity is invalid`);
  contractIdentity(report.contract, kind === "indexing" ? "rag-indexing-v1" : "rag-behavior-v2", `${kind} contract`);
  const summary = exact(report.summary, ["cases", "errors"], `${kind} summary`);
  if (!Array.isArray(report.results) || report.results.length !== integer(summary.cases, `${kind} case count`, 0, 50_000)) throw new Error(`${kind} report cases are invalid`);
  let errors = 0;
  for (const [index, value] of report.results.entries()) {
    const item = plainObject(value, `${kind} case ${index}`);
    const fields = Object.keys(item).sort();
    const expected = kind === "indexing" ? ["actual", "id"] : ["actual", "id", "mode"];
    if (JSON.stringify(fields) !== JSON.stringify(expected)) throw new Error(`${kind} case ${index} fields are invalid`);
    nonEmptyString(item.id, `${kind} case ${index} ID`, 256);
    if (kind === "retrieval") nonEmptyString(item.mode, `${kind} case ${index} mode`, 128);
    const actual = plainObject(item.actual, `${kind} case ${index} actual`);
    if ("expected" in actual || "passed" in actual) throw new Error(`${kind} case ${index} leaks proof-only data`);
    if (kind === "retrieval") observation(actual, `${kind} case ${index} observation`);
    else indexingActual(actual, `${kind} case ${index} observation`);
    if (actual.status === "error") errors += 1;
  }
  if (integer(summary.errors, `${kind} error count`, 0, report.results.length) !== errors) throw new Error(`${kind} error count is inconsistent`);
  return report;
}

function queryReport(value) {
  const report = exact(value, ["schema", "protocol_version", "kind", "identity", "contract", "query", "observation"], "query report");
  if (report.schema !== "browser-rag-ts-worker-query-report-v1" || report.protocol_version !== 1 || report.kind !== "query") throw new Error("query report identity is invalid");
  const identity = exact(report.identity, ["implementation", "language", "module_version"], "query report identity");
  if (identity.implementation !== "rag-method-browser-ts-worker" || identity.language !== "typescript" || identity.module_version !== MODULE_VERSION) throw new Error("query report implementation identity is invalid");
  contractIdentity(report.contract, "rag-behavior-v2", "query report contract");
  nonEmptyString(report.query, "query report query", 16_384);
  observation(report.observation, "query report observation");
  return report;
}

if (process.env.BROWSER_RAG_UPDATE_PUBLIC_MEDIA === "1") throw new Error("Use node scripts/atlas_presentation.mjs --update-media after building the static app.");

const port = Number(argument("--port", "5174"));
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("--port must be an integer from 1024 through 65535");
const baseUrl = new URL(argument("--base-url", `http://127.0.0.1:${port}/`));
if (baseUrl.protocol !== "http:" || baseUrl.hostname !== "127.0.0.1" || Number(baseUrl.port) !== port) throw new Error("--base-url must use the declared loopback port");
const applicationUrl = (search = "") => {
  const target = new URL("browser/", baseUrl);
  target.search = search;
  target.searchParams.set("corpus", "contract");
  return target.href;
};
const publicApplicationUrl = (search = "") => {
  const target = new URL("browser/", baseUrl);
  target.search = search;
  target.searchParams.set("vault", "threejs");
  return target.href;
};
const output = proofPath(argument("--output", join(PROOF_ROOT, "browser.json")), "--output");
const reportDir = proofPath(argument("--report-dir", PROOF_ROOT), "--report-dir");
await mkdir(reportDir, { recursive: true });
await mkdir(resolve(output, ".."), { recursive: true });

const checks = [];
const consoleErrors = [];
const consoleWarnings = [];
const pageErrors = [];
const requestFailures = [];
const responseFailures = [];
const workerErrors = [];
const expectedDiagnostics = [];
const timings = {};
const started = performance.now();
let browser;
let context;
let page;
let browserVersion = "not-launched";
let browserLaunch;
let rawReports = {};
let checkIndex = 0;
let failure = "";
let collectionBeforeDiagnostic = null;
const mobileJourneys = {};
const termination = {
  worker_disposal_acknowledged: false,
  page_closed: false,
  browser_context_closed: false,
  browser_closed: false,
  vite_process_tree_terminated: false,
  port_released: false,
};

function recordCheck(name, passed, startedAt, detail = "") {
  if (CHECK_NAMES[checkIndex] !== name) throw new Error(`browser check order mismatch: expected ${CHECK_NAMES[checkIndex] ?? "end"}, got ${name}`);
  checks.push({ name, status: passed ? "pass" : "fail", elapsed_ms: elapsed(startedAt), ...(detail ? { detail } : {}) });
  checkIndex += 1;
}

async function verify(name, action) {
  const stepStarted = performance.now();
  console.log(`browser check: ${name}`);
  try {
    const result = await action();
    recordCheck(name, result === true, stepStarted, result === true ? "" : String(result ?? "condition was false"));
    if (result !== true) throw new Error(`${name} failed`);
  } catch (error) {
    console.error(error instanceof Error ? error.stack : error);
    if (CHECK_NAMES[checkIndex] === name) recordCheck(name, false, stepStarted, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function managedViewportState(targetPage) {
  const canvas = targetPage.locator("#graph-tsl-canvas");
  const box = await canvas.boundingBox();
  const value = await canvas.evaluate((element) => {
    const parse = (name, fallback) => {
      try { return JSON.parse(element.getAttribute(name) ?? fallback); }
      catch { return JSON.parse(fallback); }
    };
    return {
      runtime: parse("data-renderer-diagnostics", "{}"),
      viewport: parse("data-viewport", "{}"),
      targets: parse("data-node-targets", "[]"),
      selected: element.getAttribute("data-selected-node-id") ?? "",
      hits: parse("data-hit-node-ids", "[]"),
    };
  });
  return { box, ...value };
}

function assertManagedGraphFits(state, label, minimumNodes = 1) {
  if (!state.box || !state.viewport || !Array.isArray(state.targets) || state.targets.length < minimumNodes) {
    throw new Error(`${label} diagnostics are incomplete: ${JSON.stringify(state)}`);
  }
  const { width, height, lifecycle, frame_pending: framePending } = state.viewport;
  if (lifecycle !== "ready" || framePending !== false || width <= 0 || height <= 0) {
    throw new Error(`${label} viewport is not ready: ${JSON.stringify(state.viewport)}`);
  }
  const outside = state.targets.filter((target) => !target?.visible || !Number.isFinite(target.x) || !Number.isFinite(target.y)
    || target.x < 1 || target.x > width - 1 || target.y < 1 || target.y > height - 1);
  if (outside.length) throw new Error(`${label} has projected nodes outside the managed viewport: ${JSON.stringify(outside.slice(0, 4))}`);
  const xs = state.targets.map((target) => target.x);
  const span = Math.max(...xs) - Math.min(...xs);
  if (minimumNodes > 4 && span < Math.min(96, width * 0.3)) throw new Error(`${label} graph is too compressed to inspect: span=${span}, width=${width}`);
}

async function clickManagedTarget(targetPage, target) {
  const canvas = targetPage.locator("#graph-tsl-canvas");
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) return false;
  for (const offsetX of [-3, 0, 3]) {
    for (const offsetY of [-3, 0, 3]) {
      await canvas.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
      await targetPage.mouse.click(box.x + target.x + offsetX, box.y + target.y + offsetY);
      try {
        await targetPage.waitForFunction((nodeId) => {
          const element = document.querySelector("#graph-tsl-canvas");
          return element?.getAttribute("data-selected-node-id") === nodeId;
        }, target.node_id, { timeout: 500, polling: "raf" });
        await canvas.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        return true;
      } catch {
        // Try the next bounded offset only after the prior input had a chance to settle.
      }
    }
  }
  return false;
}

async function exerciseManagedMobileViewport(targetPage, requestedBackend) {
  await targetPage.emulateMedia({ reducedMotion: "reduce" });
  await targetPage.setViewportSize({ width: 390, height: 844 });
  await targetPage.goto(applicationUrl(requestedBackend === "webgl2" ? "?backend=webgl2" : ""), { waitUntil: "networkidle", timeout: 30_000 });
  await targetPage.getByText("Worker ready.").waitFor({ state: "attached", timeout: 30_000 });
  await targetPage.waitForFunction((backend) => {
    const state = document.querySelector("#renderer-state")?.textContent ?? "";
    return backend === "webgl2" ? state.includes("TSL renderer ready using webgl2") : /TSL renderer ready using (?:webgpu|webgl2)/u.test(state);
  }, requestedBackend, { timeout: 30_000 });
  await targetPage.locator("details.collection-disclosure").evaluate((element) => { if (element instanceof HTMLDetailsElement) element.open = true; });
  const sections = Array.from({ length: 36 }, (_, index) => `# Viewport node ${index}\nWide managed viewport marker ${index}. [[Viewport node ${(index + 1) % 36}]]`);
  await targetPage.locator("#local-files").setInputFiles([{ name: "managed-viewport.md", mimeType: "text/markdown", buffer: Buffer.from(sections.join("\n\n"), "utf8") }]);
  await targetPage.locator("#load-local-files").click();
  await targetPage.waitForFunction(() => document.querySelector("#document-state")?.textContent?.includes("Indexed 1 document(s)"), undefined, { timeout: 30_000 });
  await targetPage.waitForFunction(() => document.querySelector("#graph-state")?.textContent?.includes("Folder graph ready:"), undefined, { timeout: 30_000 });
  await targetPage.locator("#graph-view").evaluate((element) => {
    if (!(element instanceof HTMLSelectElement)) throw new Error("graph view control is unavailable");
    element.value = "evidence";
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await targetPage.waitForFunction(() => document.querySelector("#graph-state")?.textContent?.includes("Evidence graph ready:"), undefined, { timeout: 30_000 });
  await targetPage.locator("details.retrieval-options").evaluate((element) => { if (element instanceof HTMLDetailsElement) element.open = true; });
  await targetPage.locator("#query-text").fill("wide managed viewport marker");
  await targetPage.selectOption("#query-mode", "keyword_only");
  await targetPage.locator("#query-top-k").fill("8");
  await targetPage.locator("#query-scopes").fill("browser:local");
  await targetPage.locator("#run-query").click();
  await targetPage.getByText("Query complete:").waitFor({ state: "attached", timeout: 30_000 });
  // Close setup surfaces before exercising actual, unobstructed canvas input.
  for (const selector of ["details.collection-disclosure", "details.retrieval-options"]) {
    const disclosure = targetPage.locator(selector);
    if (await disclosure.evaluate(element => element.open)) await disclosure.locator(":scope > summary").click();
  }
  // Mobile Atlas keeps the graph visible while evidence stacks below Search.
  const resultOrder = await targetPage.locator("#result-list button[data-record-id]").evaluateAll((items) => items.map((item) => item.getAttribute("data-record-id")));
  if (await targetPage.locator("#close-inspector").isVisible()) await targetPage.locator("#close-inspector").click();
  await targetPage.locator("#fit-graph").click();
  await targetPage.waitForFunction(() => {
    const canvas = document.querySelector("#graph-tsl-canvas");
    if (!(canvas instanceof HTMLCanvasElement)) return false;
    try {
      const viewport = JSON.parse(canvas.dataset.viewport ?? "{}");
      const targets = JSON.parse(canvas.dataset.nodeTargets ?? "[]");
      return viewport.lifecycle === "ready" && viewport.frame_pending === false && viewport.automatic_frame_count >= 1 && targets.length >= 30;
    } catch { return false; }
  }, undefined, { timeout: 15_000 });
  const revealed = await managedViewportState(targetPage);
  assertManagedGraphFits(revealed, `${requestedBackend} mobile reveal`, 30);
  const orderedTargets = [...revealed.targets].sort((left, right) => left.x - right.x);
  const left = orderedTargets[0];
  const right = orderedTargets.at(-1);
  if (!left || !right || left.node_id === right.node_id || !(await clickManagedTarget(targetPage, left))) {
    throw new Error(`${requestedBackend} managed edge-node picking failed: ${JSON.stringify({ left, right, diagnostics: revealed })}`);
  }
  const refreshed = await managedViewportState(targetPage);
  const refreshedRight = refreshed.targets.find((target) => target.node_id === right.node_id);
  if (!refreshedRight || !(await clickManagedTarget(targetPage, refreshedRight))) {
    throw new Error(`${requestedBackend} managed edge-node picking failed after projection refresh: ${JSON.stringify({ left, right, refreshedRight, diagnostics: refreshed })}`);
  }
  const selected = await targetPage.locator("#graph-tsl-canvas").getAttribute("data-selected-node-id");
  const completed = await managedViewportState(targetPage);
  if (await targetPage.locator(".evidence-pane").isHidden()) await targetPage.locator("#toggle-inspector").click();
  await targetPage.locator("details.query-export").evaluate((element) => { if (element instanceof HTMLDetailsElement) element.open = true; });
  const [download] = await Promise.all([targetPage.waitForEvent("download"), targetPage.locator("#download-query-report").click()]);
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error(`${requestedBackend} managed viewport query report did not produce a temporary download`);
  const report = queryReport(JSON.parse(await readFile(downloadPath, "utf8")));
  const runtime = completed.runtime;
  const runtimeValid = runtime.requested_backend === requestedBackend
    && (runtime.selected_backend === "webgpu" || runtime.selected_backend === "webgl2")
    && (requestedBackend !== "webgl2" || runtime.selected_backend === "webgl2")
    && Number.isFinite(runtime.device_pixel_ratio) && runtime.device_pixel_ratio > 0
    && Number.isInteger(runtime.graph_revision) && runtime.graph_revision > 0
    && Number.isInteger(runtime.topology_revision) && runtime.topology_revision > 0
    && Number.isInteger(runtime.camera_revision) && runtime.camera_revision > 0
    && Number.isInteger(runtime.picking_revision) && runtime.picking_revision > 0
    && ["raycast", "spatial", "gpu-id"].includes(runtime.picking_mode);
  if (selected !== right.node_id || JSON.stringify(report.observation.ordered_ids) !== JSON.stringify(resultOrder) || !runtimeValid) {
    throw new Error(`${requestedBackend} managed mobile evidence is inconsistent: ${JSON.stringify({ selected, right, runtime, viewport: completed.viewport })}`);
  }
  return Object.freeze({
    requested_backend: runtime.requested_backend,
    selected_backend: runtime.selected_backend,
    device_pixel_ratio: runtime.device_pixel_ratio,
    viewport: Object.freeze({ width: completed.viewport.width, height: completed.viewport.height }),
    graph_revision: runtime.graph_revision,
    topology_revision: runtime.topology_revision,
    camera_revision: runtime.camera_revision,
    picking_revision: runtime.picking_revision,
    picking_mode: runtime.picking_mode,
    selected_node_ids: Object.freeze([left.node_id, right.node_id]),
  });
}

try {
  browserLaunch = await launchChromium(chromium, { headless: true }, "BROWSER_RAG_CHROMIUM_PATH");
  browser = browserLaunch.browser;
  browserVersion = browser.version();
  context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const monitoredPages = new WeakSet();
  const monitorPage = (targetPage) => {
    if (monitoredPages.has(targetPage)) return;
    monitoredPages.add(targetPage);
    targetPage.on("console", (message) => {
      if (message.type() === "error" && EXPECTED_RENDERER_ERROR.test(message.text())) expectedDiagnostics.push(message.text());
      else if (message.type() === "error") consoleErrors.push(message.text());
      if (message.type() === "warning" && !EXPECTED_RENDERER_WARNING.test(message.text())) consoleWarnings.push(message.text());
    });
    targetPage.on("pageerror", (error) => pageErrors.push(error.message));
    targetPage.on("requestfailed", (request) => {
      const failure = request.failure()?.errorText ?? "unknown";
      // Optional availability checks are explicitly aborted on import/disposal.
      if (new URL(request.url()).pathname.endsWith("/corpora/threejs-docs.manifest.json") && failure === "net::ERR_ABORTED") {
        expectedDiagnostics.push(`Cancelled optional example availability: ${request.url()}`);
      } else requestFailures.push({ url: request.url(), failure });
    });
    targetPage.on("response", (response) => {
      if (response.status() >= 400) responseFailures.push({ url: response.url(), status: response.status() });
    });
    targetPage.on("worker", (worker) => worker.on("close", () => undefined));
  };
  context.on("page", monitorPage);
  page = await context.newPage();
  monitorPage(page);

  await verify("page_ready", async () => {
    const navigationStarted = performance.now();
    await page.goto(applicationUrl(), { waitUntil: "networkidle", timeout: 30_000 });
    timings.navigation_ms = elapsed(navigationStarted);
    return true;
  });
  await verify("identity_marker", async () => (await page.locator(`[data-browser-rag-ts="${MODULE_VERSION}"]`).count()) >= 1);
  await verify("heading_visible", async () => await page.title() === "Explorer | RAG Method" && (await page.getByRole("heading", { name: "Knowledge Atlas" }).count()) === 1);
  await verify("worker_initialized", async () => {
    await page.getByText("Worker ready.").waitFor({ state: "attached", timeout: 30_000 });
    return (await page.locator("#worker-state").textContent())?.includes("Worker ready.") ?? false;
  });
  await verify("graph_projection", async () => {
    await page.getByText("Evidence graph ready:").waitFor({ state: "attached", timeout: 15_000 });
    return (await page.locator("#graph-inspector-list button[data-graph-node-id]").count()) > 0
      && ((await page.locator("#graph-state").textContent())?.includes("nodes") ?? false);
  });
  await verify("renderer_tsl_active", async () => {
    await page.getByText(/TSL renderer ready using (?:webgpu|webgl2)/u).waitFor({ state: "attached", timeout: 30_000 });
    return await page.locator('#graph-surface[data-renderer="tsl"] #graph-tsl-canvas').isVisible();
  });
  await verify("renderer_webgl2_device_loss_fallback", async () => {
    const fallbackPage = await context.newPage();
    try {
      await fallbackPage.goto(applicationUrl("?backend=webgl2"), { waitUntil: "networkidle", timeout: 30_000 });
      await fallbackPage.getByText("TSL renderer ready using webgl2").waitFor({ state: "attached", timeout: 30_000 });
      const lossRequested = await fallbackPage.locator("#graph-tsl-canvas").evaluate((canvas) => {
        if (!(canvas instanceof HTMLCanvasElement)) return false;
        const context = canvas.getContext("webgl2");
        const extension = context?.getExtension("WEBGL_lose_context");
        if (!extension) return false;
        extension.loseContext();
        return true;
      });
      if (!lossRequested) return false;
      await fallbackPage.locator('#graph-surface[data-renderer="svg"]').waitFor({ timeout: 15_000 });
      return (await fallbackPage.locator("#renderer-state").textContent())?.includes("device lost") ?? false;
    } finally {
      await fallbackPage.close();
    }
  });
  await verify("renderer_svg_opt_out", async () => {
    const fallbackPage = await context.newPage();
    try {
      await fallbackPage.goto(applicationUrl("?renderer=svg"), { waitUntil: "networkidle", timeout: 30_000 });
      await fallbackPage.getByText("SVG renderer was explicitly requested.").waitFor({ state: "attached", timeout: 15_000 });
      return await fallbackPage.locator('#graph-surface[data-renderer="svg"] #graph-canvas').isVisible();
    } finally {
      await fallbackPage.close();
    }
  });
  await verify("default_presentation", async () => {
    const advanced = page.locator("details.advanced");
    const closed = !(await advanced.getAttribute("open"));
    const optionsClosed = !(await page.locator("details.retrieval-options").getAttribute("open"));
    const collectionClosed = !(await page.locator("details.collection-disclosure").getAttribute("open"));
    const cancelHidden = await page.locator("#cancel-query").isHidden();
    const diagnosticsHidden = !(await page.getByRole("heading", { name: "Complete score diagnostics" }).isVisible());
    await advanced.evaluate((element) => { if (element instanceof HTMLDetailsElement) element.open = true; });
    const landingPage = await context.newPage();
    let landingReady = false;
    try {
      await landingPage.goto(baseUrl.href, { waitUntil: "networkidle", timeout: 30_000 });
      landingReady = await landingPage.getByRole("heading", { name: "Knowledge, in motion." }).isVisible()
        && await landingPage.getByRole("link", { name: "Open Atlas" }).isVisible()
        && await landingPage.locator("canvas").count() === 0;
      await landingPage.goto(new URL("browser/", baseUrl).href, { waitUntil: "networkidle", timeout: 30_000 });
      await landingPage.locator("#open-local-vault:enabled").waitFor({ timeout: 30_000 });
      landingReady = landingReady
        && await landingPage.getByRole("button", { name: /Explore demo vault/u }).isVisible()
        && await landingPage.getByRole("button", { name: /Open your vault/u }).isVisible()
        && await landingPage.getByText("Markdown and text. Processed locally in this tab.").isVisible()
        && await landingPage.locator('#graph-surface[data-renderer="none"]').count() === 1;
    } finally { await landingPage.close(); }
    return landingReady && closed && optionsClosed && collectionClosed && cancelHidden && diagnosticsHidden
      && await page.getByRole("button", { name: /^Search$/u }).isVisible()
      && (await page.locator("#active-collection").textContent()).includes("Sample collection");
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await verify("initial_worker_reports", async () => (await page.locator("#proof-state").textContent())?.includes("indexing 12 cases; retrieval 15 cases") ?? false);

  await verify("worker_actual_reports_downloaded", async () => {
    const downloadPaths = [];
    for (const [buttonId, name, kind] of [
      ["#download-indexing-report", "indexing-worker-actual.json", "indexing"],
      ["#download-retrieval-report", "retrieval-worker-actual.json", "retrieval"],
    ]) {
      const [download] = await Promise.all([page.waitForEvent("download"), page.locator(buttonId).click()]);
      const destination = proofPath(join(reportDir, name), `download ${name}`);
      await download.saveAs(destination);
      const payload = actualReport(JSON.parse(await readFile(destination, "utf8")), kind);
      rawReports[kind] = { path: destination, sha256: await sha256(destination), bytes: (await readFile(destination)).byteLength, cases: payload.summary.cases };
      downloadPaths.push(destination);
    }
    return downloadPaths.length === 2;
  });

  await page.selectOption("#query-preset", "exact-release", { force: true });
  await verify("exact_query", async () => {
    await page.locator("#run-query").click();
    await page.getByText("Query complete:").waitFor({ state: "attached", timeout: 15_000 });
    return (await page.locator("#result-list button[data-record-id]").count()) >= 1 && ((await page.locator("#query-context").textContent())?.includes("estimated tokens") ?? false);
  });
  await page.selectOption("#query-preset", "scoped-evidence", { force: true });
  await verify("keyword_query", async () => {
    await page.locator("#run-query").click();
    await page.getByText("Query complete:").waitFor({ state: "attached", timeout: 15_000 });
    return (await page.locator("#diagnostic-result-rows").textContent())?.includes("workspace-plan") ?? false;
  });
  await page.selectOption("#query-preset", "semantic-threshold", { force: true });
  await verify("fixture_semantic_query", async () => {
    await page.locator("#run-query").click();
    await page.getByText("Query complete:").waitFor({ state: "attached", timeout: 15_000 });
    return (await page.locator("#query-diagnostics").textContent())?.includes("ready") ?? false;
  });
  await page.selectOption("#query-preset", "private-exclusion", { force: true });
  await verify("scoped_query", async () => {
    await page.locator("#run-query").click();
    await page.getByText("Query complete:").waitFor({ state: "attached", timeout: 15_000 });
    return !((await page.locator("#diagnostic-result-rows").textContent())?.includes("private-persona-note") ?? true);
  });
  await page.selectOption("#query-preset", "linked-source", { force: true });
  let crossReferenceText = "";
  let crossReferenceDiagnostics = "";
  await verify("cross_reference_query", async () => {
    await page.locator("#run-query").click();
    await page.getByText("Query complete:").waitFor({ state: "attached", timeout: 15_000 });
    crossReferenceText = (await page.locator("#result-list").textContent()) ?? "";
    crossReferenceDiagnostics = (await page.locator("#diagnostic-result-rows").textContent()) ?? "";
    return crossReferenceDiagnostics.includes("release-checklist");
  });
  await verify("result_to_graph_selection", async () => {
    if (await page.locator(".evidence-pane").isHidden()) await page.locator("#toggle-inspector").click();
    const rows = page.locator("#result-list button[data-record-id]");
    if (await rows.count() < 2 || await page.locator('#graph-inspector-list button[aria-pressed="true"]').count() !== 0) return false;
    const row = rows.nth(1);
    const recordId = await row.getAttribute("data-record-id");
    await row.focus();
    await row.press("Enter");
    return recordId !== null
      && await row.getAttribute("data-selected") === "true"
      && await page.locator(`#graph-inspector-list button[data-record-id="${recordId}"][aria-pressed="true"]`).count() === 1
      && ((await page.locator("#graph-detail").textContent())?.length ?? 0) > 10;
  });
  await verify("renderer_selection_diagnostics", async () => {
    const recordId = await page.locator('#result-list button[data-selected="true"]').getAttribute("data-record-id");
    const nodeId = await page.locator('#graph-inspector-list button[aria-pressed="true"]').getAttribute("data-graph-node-id");
    const rendererNodeId = await page.locator("#graph-tsl-canvas").getAttribute("data-selected-node-id");
    const rendererHits = JSON.parse((await page.locator("#graph-tsl-canvas").getAttribute("data-hit-node-ids")) ?? "[]");
    return recordId !== null && nodeId !== null && rendererNodeId === nodeId && Array.isArray(rendererHits) && rendererHits.length > 0;
  });
  await verify("managed_canvas_selection", async () => {
    const canvas = page.locator("#graph-tsl-canvas");
    const selectedNodeId = await canvas.getAttribute("data-selected-node-id");
    const values = JSON.parse((await canvas.getAttribute("data-hit-targets")) ?? "[]");
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    if (!box || !Array.isArray(values)) {
      throw new Error(`managed canvas diagnostics unavailable: box=${JSON.stringify(box)} targets=${JSON.stringify(values)}`);
    }
    const attempts = [];
    for (const target of values) {
      if (!target || typeof target !== "object" || typeof target.node_id !== "string" || target.node_id === selectedNodeId || !Number.isFinite(target.x) || !Number.isFinite(target.y)) continue;
      const recordId = await page.locator(`#graph-canvas circle[data-graph-node-id="${target.node_id}"]`).getAttribute("data-record-id");
      if (!recordId) continue;
      for (const offsetX of [-4, 0, 4]) {
        for (const offsetY of [-4, 0, 4]) {
          await page.mouse.click(box.x + target.x + offsetX, box.y + target.y + offsetY);
          await page.waitForTimeout(80);
          const rendererNodeId = await page.locator("#graph-tsl-canvas").getAttribute("data-selected-node-id");
          attempts.push({ target: target.node_id, x: target.x + offsetX, y: target.y + offsetY, selected: rendererNodeId });
          if (rendererNodeId !== target.node_id) continue;
          return await page.locator(`#result-list button[data-record-id="${recordId}"][data-selected="true"]`).count() === 1;
        }
      }
    }
    throw new Error(`managed canvas selection mismatch: selected=${selectedNodeId} box=${JSON.stringify(box)} targets=${JSON.stringify(values)} attempts=${JSON.stringify(attempts)}`);
  });
  await verify("graph_to_result_selection", async () => {
    await page.locator("details.visible-records").evaluate((element) => { if (element instanceof HTMLDetailsElement) element.open = true; });
    const selectedId = await page.locator('#result-list button[data-selected="true"]').getAttribute("data-record-id");
    const hits = page.locator('#graph-inspector-list button[data-hit="true"][data-record-id]');
    let target = hits.first();
    for (let index = 0; index < await hits.count(); index += 1) {
      const candidate = hits.nth(index);
      if (await candidate.getAttribute("data-record-id") !== selectedId) { target = candidate; break; }
    }
    if (await target.count() !== 1 || await target.getAttribute("data-record-id") === selectedId) return false;
    const recordId = await target.getAttribute("data-record-id");
    const nodeId = await target.getAttribute("data-graph-node-id");
    await target.focus();
    await target.press("Enter");
    const state = {
      recordId,
      selectedEvidence: recordId === null ? 0 : await page.locator(`#result-list button[data-record-id="${recordId}"][data-selected="true"]`).count(),
      detail: await page.locator("#graph-detail").textContent(),
      nodeId,
      focusedNodeId: await page.evaluate(() => document.activeElement?.getAttribute("data-graph-node-id")),
    };
    if (state.recordId === null || state.selectedEvidence !== 1 || (state.detail?.length ?? 0) <= 10 || state.nodeId === null || state.focusedNodeId !== state.nodeId) {
      throw new Error(`graph-to-evidence selection mismatch: ${JSON.stringify(state)}`);
    }
    return true;
  });
  await verify("graph_view_switch", async () => {
    await page.selectOption("#graph-view", "folders");
    await page.getByText("Folder graph ready:").waitFor({ state: "attached", timeout: 15_000 });
    const folders = await page.locator('#graph-inspector-list button[data-folder-path]').count();
    const preservedSource = await page.locator('#graph-inspector-list button[data-source-id][aria-pressed="true"]').count();
    await page.selectOption("#graph-view", "evidence");
    await page.getByText("Evidence graph ready:").waitFor({ state: "attached", timeout: 15_000 });
    return folders > 0 && preservedSource === 1 && await page.locator('#graph-inspector-list button[data-record-id][aria-pressed="true"]').count() === 1;
  });
  await verify("graph_rapid_view_cancellation", async () => {
    await page.evaluate(() => {
      const select = document.querySelector("#graph-view");
      if (!(select instanceof HTMLSelectElement)) throw new Error("graph view selector missing");
      select.value = "folders";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      select.value = "evidence";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.getByText("Evidence graph ready:").waitFor({ state: "attached", timeout: 15_000 });
    return !((await page.locator("#graph-state").textContent())?.includes("unavailable") ?? true);
  });
  await verify("foreground_graph_coordination", async () => {
    const coordinationPage = await context.newPage();
    try {
      await delayGraphRequests(coordinationPage);
      await coordinationPage.goto(applicationUrl("?renderer=svg"), { waitUntil: "networkidle", timeout: 30_000 });
      await coordinationPage.getByText("Worker ready.").waitFor({ state: "attached", timeout: 30_000 });
      await coordinationPage.selectOption("#graph-view", "folders");
      await coordinationPage.locator("#run-query").click();
      await coordinationPage.getByText("Query complete:").waitFor({ state: "attached", timeout: 15_000 });
      await coordinationPage.locator("details.collection-disclosure").evaluate((element) => { if (element instanceof HTMLDetailsElement) element.open = true; });
      await coordinationPage.locator("#local-files").setInputFiles([{ name: "coordination.md", mimeType: "text/markdown", buffer: Buffer.from("# Coordination\nForeground import owns this marker.", "utf8") }]);
      await coordinationPage.selectOption("#graph-view", "evidence");
      await coordinationPage.locator("#load-local-files").click();
      await coordinationPage.waitForFunction(() => document.querySelector("#document-state")?.textContent?.includes("Indexed 1 document(s)"), undefined, { timeout: 15_000 });
      await coordinationPage.selectOption("#graph-view", "folders");
      await coordinationPage.locator("details.collection-disclosure").evaluate((element) => { if (element instanceof HTMLDetailsElement) element.open = true; });
      await coordinationPage.locator("#restore-fixture").click();
      await coordinationPage.getByText("Fixture corpus restored.").waitFor({ state: "attached", timeout: 15_000 });
      await coordinationPage.locator("details.advanced").evaluate((element) => { if (element instanceof HTMLDetailsElement) element.open = true; });
      await coordinationPage.selectOption("#graph-view", "evidence");
      await coordinationPage.locator("#run-contracts").click();
      await coordinationPage.getByText(/Worker actual reports ready:/u).waitFor({ state: "attached", timeout: 30_000 });
      const body = (await coordinationPage.locator("body").textContent()) ?? "";
      return !body.includes("operation_busy") && await coordinationPage.locator('#app[data-operation-owner="idle"]').count() === 1;
    } finally {
      await coordinationPage.close();
    }
  });
  await verify("selection_reset", async () => {
    if (await page.locator('#result-list button[data-selected="true"]').count() !== 1) return false;
    await page.locator("#run-query").click();
    await page.getByText("Query complete:").waitFor({ state: "attached", timeout: 15_000 });
    return await page.locator('#result-list button[data-selected="true"]').count() === 0
      && await page.locator('#graph-inspector-list button[aria-pressed="true"]').count() === 0;
  });
  await verify("component_scores_visible", async () => crossReferenceDiagnostics.includes("1000000"));
  await verify("context_visible", async () => (await page.locator("#query-context").textContent())?.includes("included") ?? false);
  await verify("readable_evidence", async () => {
    const evidence = (await page.locator("#result-list").textContent()) ?? "";
    const defaultWorkspace = (await page.locator(".workspace-panel").textContent()) ?? "";
    const metrics = await page.evaluate(() => {
      const rgb = (value) => (value.match(/[\d.]+/gu) ?? []).slice(0, 3).map(Number);
      const luminance = (value) => rgb(value).map((channel) => channel / 255).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
      const contrast = (foreground, background) => {
        const values = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
        return (values[0] + 0.05) / (values[1] + 0.05);
      };
      const retrieve = document.querySelector("#run-query");
      const evidenceButton = document.querySelector("#result-list button[data-record-id]");
      if (!(retrieve instanceof HTMLElement) || !(evidenceButton instanceof HTMLElement)) return null;
      const rootStyle = getComputedStyle(document.documentElement);
      const retrieveStyle = getComputedStyle(retrieve);
      evidenceButton.focus();
      const focusStyle = getComputedStyle(evidenceButton);
      const visibleButtons = [...document.querySelectorAll("button")].filter((button) => button.getClientRects().length > 0);
      return {
        actionContrast: contrast(retrieveStyle.color, retrieveStyle.backgroundColor),
        minimumTargetHeight: Math.min(...visibleButtons.map((button) => button.getBoundingClientRect().height)),
        focusOutlineWidth: Number.parseFloat(focusStyle.outlineWidth),
        palette: {
          colorScheme: rootStyle.colorScheme,
          theme: document.documentElement.dataset.aurelTheme,
          page: rootStyle.getPropertyValue("--paper").trim(),
          action: rootStyle.getPropertyValue("--action").trim(),
          signal: rootStyle.getPropertyValue("--signal").trim(),
          graphSource: getComputedStyle(document.querySelector(".shell")).getPropertyValue("--rag-graph-source").trim(),
        },
      };
    });
    return metrics !== null && metrics.actionContrast >= 4.5 && metrics.minimumTargetHeight >= 44 && metrics.focusOutlineWidth >= 3
      && metrics.palette.colorScheme === "dark" && metrics.palette.theme === "gold" && metrics.palette.page === "#080807"
      && metrics.palette.action === "#e8c991" && metrics.palette.signal === "#c2cfa9" && metrics.palette.graphSource === "#e8c991"
      && evidence.includes("Retrieval score") && evidence.includes("Included in context")
      && !defaultWorkspace.includes("Context-selected IDs") && !/\b\d{6}\b/u.test(evidence)
      && await page.locator("#result-list tr[role=button]").count() === 0;
  });
  for (const requestedBackend of ["auto", "webgl2"]) {
    const checkName = `managed_mobile_${requestedBackend}_viewport`;
    await verify(checkName, async () => {
      const mobilePage = await context.newPage();
      try {
        mobileJourneys[requestedBackend] = await exerciseManagedMobileViewport(mobilePage, requestedBackend);
        return true;
      } catch (error) {
        await mobilePage.screenshot({ path: join(reportDir, `failed-mobile-${requestedBackend}.png`), fullPage: true }).catch(() => undefined);
        throw error;
      } finally {
        await mobilePage.close();
      }
    });
  }
  await verify("managed_resize_rotation", async () => {
    const managedPage = await context.newPage();
    try {
      await managedPage.emulateMedia({ reducedMotion: "reduce" });
      await managedPage.setViewportSize({ width: 1440, height: 1000 });
      await managedPage.goto(applicationUrl("?backend=webgl2"), { waitUntil: "networkidle", timeout: 30_000 });
      await managedPage.getByText("Worker ready.").waitFor({ state: "attached", timeout: 30_000 });
      await managedPage.getByText("TSL renderer ready using webgl2").waitFor({ state: "attached", timeout: 30_000 });
      await managedPage.getByText("Evidence graph ready:").waitFor({ state: "attached", timeout: 30_000 });
      await managedPage.locator("#query-preset").selectOption("exact-release", { force: true });
      await managedPage.locator("#run-query").click();
      await managedPage.getByText("Query complete:").waitFor({ state: "attached", timeout: 30_000 });
      const resultOrder = await managedPage.locator("#result-list button[data-record-id]").evaluateAll((items) => items.map((item) => item.getAttribute("data-record-id")));
      await managedPage.locator("#toggle-inspector").click();
      await managedPage.locator("details.visible-records").evaluate((element) => { if (element instanceof HTMLDetailsElement) element.open = true; });
      const selectedButton = managedPage.locator("#graph-inspector-list button[data-record-id]").first();
      await selectedButton.click();
      const selected = await selectedButton.getAttribute("data-graph-node-id");
      const hits = JSON.parse((await managedPage.locator("#graph-tsl-canvas").getAttribute("data-hit-node-ids")) ?? "[]");
      await managedPage.setViewportSize({ width: 390, height: 844 });
      await managedPage.locator("#close-inspector").click();
      await managedPage.waitForTimeout(200);
      const portrait = await managedViewportState(managedPage);
      assertManagedGraphFits(portrait, "portrait resize");
      await managedPage.setViewportSize({ width: 844, height: 390 });
      await managedPage.waitForTimeout(200);
      const landscape = await managedViewportState(managedPage);
      assertManagedGraphFits(landscape, "landscape rotation");
      await managedPage.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
      await managedPage.waitForTimeout(200);
      const enlarged = await managedViewportState(managedPage);
      assertManagedGraphFits(enlarged, "200% text enlargement");
      await managedPage.evaluate(() => { document.documentElement.style.fontSize = ""; });
      await managedPage.waitForTimeout(200);
      const beforeNavigation = await managedViewportState(managedPage);
      if (!beforeNavigation.box) return false;
      await managedPage.locator("#graph-tsl-canvas").dispatchEvent("wheel", { deltaY: 240, bubbles: true });
      await managedPage.waitForTimeout(100);
      const navigated = await managedViewportState(managedPage);
      await managedPage.setViewportSize({ width: 820, height: 390 });
      await managedPage.waitForTimeout(200);
      const preserved = await managedViewportState(managedPage);
      const preservedOrder = await managedPage.locator("#result-list button[data-record-id]").evaluateAll((items) => items.map((item) => item.getAttribute("data-record-id")));
      const lossRequested = await managedPage.locator("#graph-tsl-canvas").evaluate((canvas) => {
        if (!(canvas instanceof HTMLCanvasElement)) return false;
        const context = canvas.getContext("webgl2");
        const extension = context?.getExtension("WEBGL_lose_context");
        if (!extension) return false;
        extension.loseContext();
        return true;
      });
      if (!lossRequested) return false;
      await managedPage.locator('#graph-surface[data-renderer="svg"]').waitFor({ timeout: 15_000 });
      const disposed = await managedViewportState(managedPage);
      const state = {
        userAdjusted: navigated.viewport.user_adjusted,
        frameCountBeforeResize: navigated.viewport.automatic_frame_count,
        frameCountAfterResize: preserved.viewport.automatic_frame_count,
        updateCountBeforeResize: navigated.viewport.update_count,
        updateCountAfterResize: preserved.viewport.update_count,
        selected,
        selectedAfterResize: preserved.selected,
        hits,
        hitsAfterResize: preserved.hits,
        resultOrder,
        resultOrderAfterResize: preservedOrder,
        disposedLifecycle: disposed.viewport.lifecycle,
        disposedTargets: disposed.targets.length,
      };
      const passed = navigated.viewport.user_adjusted === true
        && preserved.viewport.automatic_frame_count === navigated.viewport.automatic_frame_count
        && preserved.viewport.update_count > navigated.viewport.update_count
        && preserved.selected === selected
        && JSON.stringify(preserved.hits) === JSON.stringify(hits)
        && JSON.stringify(preservedOrder) === JSON.stringify(resultOrder)
        && disposed.viewport.lifecycle === "disposed"
        && disposed.targets.length === 0;
      if (!passed) throw new Error(`managed resize state continuity mismatch: ${JSON.stringify(state)}`);
      return true;
    } finally {
      await managedPage.close();
    }
  });
  await verify("svg_mobile_view_switch", async () => {
    const mobilePage = await context.newPage();
    try {
      await mobilePage.setViewportSize({ width: 390, height: 844 });
      await mobilePage.goto(applicationUrl("?renderer=svg"), { waitUntil: "networkidle", timeout: 30_000 });
      await mobilePage.getByText("Worker ready.").waitFor({ state: "attached", timeout: 30_000 });
      const startsWithGraph = await mobilePage.locator(".graph-pane").isVisible() && await mobilePage.locator(".evidence-pane").isHidden();
      await mobilePage.locator("#toggle-inspector").click();
      const bothVisible = await mobilePage.locator(".graph-pane").isVisible() && await mobilePage.locator(".evidence-pane").isVisible();
      const overlap = await mobilePage.evaluate(() => {
        const a = document.querySelector('.graph-pane').getBoundingClientRect();
        const b = document.querySelector('.evidence-pane').getBoundingClientRect();
        return a.bottom > b.top && b.bottom > a.top;
      });
      await mobilePage.locator("#close-inspector").click();
      return startsWithGraph && bothVisible && !overlap && await mobilePage.locator(".evidence-pane").isHidden()
        && await mobilePage.locator('#toggle-inspector[aria-expanded="false"]').count() === 1;
    } finally {
      await mobilePage.close();
    }
  });
  await verify("svg_text_zoom_rotation", async () => {
    const zoomPage = await context.newPage();
    try {
      await zoomPage.setViewportSize({ width: 1440, height: 1000 });
      await zoomPage.goto(applicationUrl("?renderer=svg"), { waitUntil: "networkidle", timeout: 30_000 });
      await zoomPage.getByText("Worker ready.").waitFor({ state: "attached", timeout: 30_000 });
      await zoomPage.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
      const textZoom = await zoomPage.evaluate(() => ({ fits: document.documentElement.scrollWidth <= window.innerWidth + 1, scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
      await zoomPage.evaluate(() => { document.documentElement.style.fontSize = ""; });
      await zoomPage.setViewportSize({ width: 390, height: 844 });
      const portrait = await zoomPage.evaluate(() => ({ fits: document.documentElement.scrollWidth <= window.innerWidth + 1, scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
      await zoomPage.setViewportSize({ width: 844, height: 390 });
      const landscape = await zoomPage.evaluate(() => ({ fits: document.documentElement.scrollWidth <= window.innerWidth + 1, scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
      const retrieveVisible = await zoomPage.getByRole("button", { name: /^Search$/u }).isVisible();
      if (!textZoom.fits || !portrait.fits || !landscape.fits || !retrieveVisible) throw new Error(`text zoom or rotation reflow mismatch: ${JSON.stringify({ textZoom, portrait, landscape, retrieveVisible })}`);
      return true;
    } finally {
      await zoomPage.close();
    }
  });
  await verify("reduced_motion", async () => {
    const reducedPage = await context.newPage();
    try {
      await reducedPage.emulateMedia({ reducedMotion: "reduce" });
      await reducedPage.goto(applicationUrl("?renderer=svg"), { waitUntil: "networkidle", timeout: 30_000 });
      await reducedPage.getByText("Worker ready.").waitFor({ state: "attached", timeout: 30_000 });
      const duration = await reducedPage.locator("#graph-canvas circle").first().evaluate((node) => getComputedStyle(node).transitionDuration);
      await reducedPage.locator("#run-query").click();
      await reducedPage.getByText("Query complete:").waitFor({ state: "attached", timeout: 15_000 });
      const results = await reducedPage.locator("#result-list button[data-record-id]").count();
      if (!["0s", "0.001ms", "1e-06s"].includes(duration) || results === 0) throw new Error(`reduced-motion mismatch: ${JSON.stringify({ duration, results })}`);
      return true;
    } finally {
      await reducedPage.close();
    }
  });
  await verify("responsive_captures", async () => {
    await verifyDemoPolish(context, publicApplicationUrl());
    const captureDir = proofPath(join(reportDir, "presentation-current"), "presentation capture directory");
    await mkdir(captureDir, { recursive: true });
    const publicPage = await context.newPage();
    try {
      await publicPage.emulateMedia({ reducedMotion: "reduce" });
      await publicPage.goto(publicApplicationUrl("?backend=webgl2"));
      await publicPage.locator('#copy-context:enabled').waitFor({ state: 'attached', timeout: 120000 });
      await publicPage.waitForFunction(() => /graph ready:/u.test(document.querySelector('#graph-state')?.textContent ?? ''));
      const matrix = [];
      for (const size of [{ width: 1440, height: 1000 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
        await publicPage.setViewportSize(size);
        await publicPage.locator('#fit-graph').click();
        await publicPage.evaluate(() => new Promise(ok => requestAnimationFrame(() => requestAnimationFrame(ok))));
        const fits = await publicPage.evaluate(() => {
          const graph = document.querySelector('.graph-pane').getBoundingClientRect();
          const query = document.querySelector('.command-panel').getBoundingClientRect();
          return document.documentElement.scrollWidth <= innerWidth + 1 && graph.bottom <= query.top + 1 && graph.height >= 250;
        });
        if (!fits) throw new Error(`Atlas layout failed at ${size.width}x${size.height}`);
        const name = `atlas-${size.width}.png`;
        await publicPage.screenshot({ path: join(captureDir, name), fullPage: true });
        matrix.push({ ...size, path: name, sha256: await sha256(join(captureDir, name)) });
      }
      await writeFile(join(captureDir, 'manifest.json'), JSON.stringify({ schema: 'rag-method-smoke-captures-v1', captures: matrix }) + '\n');
    } finally { await publicPage.close(); }
    return true;
  });

  await verify("query_report_downloaded", async () => {
    await page.locator("details.query-export").evaluate((element) => { if (element instanceof HTMLDetailsElement) element.open = true; });
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#download-query-report").click()]);
    const queryPath = proofPath(join(reportDir, "query-worker-actual.json"), "query report download");
    await download.saveAs(queryPath);
    const payload = queryReport(JSON.parse(await readFile(queryPath, "utf8")));
    rawReports.query = { path: queryPath, sha256: await sha256(queryPath), bytes: (await readFile(queryPath)).byteLength, query: payload.query };
    return true;
  });
  await verify("query_report_copy", async () => {
    await page.locator("#copy-query-report").click();
    await page.getByText("Current query report copied to the clipboard.").waitFor({ state: "attached", timeout: 10_000 });
    queryReport(JSON.parse(await page.evaluate(() => navigator.clipboard.readText())));
    return true;
  });
  await verify("query_report_failure_isolation", async () => {
    const faultPage = await context.newPage();
    let recoverableFailureStayedLocal = false;
    try {
      await faultPage.addInitScript(() => {
        const NativeWorker = window.Worker;
        let faultPending = true;
        window.Worker = class ProofWorker extends NativeWorker {
          postMessage(message, transfer) {
            let outgoing = message;
            if (faultPending && message && typeof message === "object" && message.operation === "export-report" && message.payload?.kind === "query") {
              faultPending = false;
              outgoing = { ...message, payload: { ...message.payload, expected_query: `${message.payload.expected_query} proof-mismatch` } };
            }
            if (transfer === undefined) super.postMessage(outgoing);
            else super.postMessage(outgoing, transfer);
          }
        };
      });
      await faultPage.goto(applicationUrl("?renderer=svg"), { waitUntil: "networkidle", timeout: 30_000 });
      await faultPage.getByText("Worker ready.").waitFor({ state: "attached", timeout: 30_000 });
      await faultPage.locator("#run-query").click();
      await faultPage.getByText("Query failed: query report does not match the submitted query").waitFor({ state: "attached", timeout: 15_000 });
      const isolated = await faultPage.locator("#result-list button[data-record-id]").count() === 0
        && await faultPage.locator("#download-query-report").isDisabled();
      await faultPage.locator("#run-query").click();
      await faultPage.getByText("Query complete:").waitFor({ state: "attached", timeout: 15_000 });
      recoverableFailureStayedLocal = isolated
        && await faultPage.locator("#result-list button[data-record-id]").count() > 0
        && !(await faultPage.locator("#download-query-report").isDisabled());
    } finally {
      await faultPage.close();
    }

    const startupPage = await context.newPage();
    try {
      await startupPage.addInitScript(() => {
        const NativeWorker = window.Worker;
        window.__startupWorkerTerminations = 0;
        window.Worker = class StartupFailureWorker {
          constructor(...args) {
            this.native = new NativeWorker(...args);
            this.onmessage = null;
            this.onerror = null;
            this.onmessageerror = null;
            this.failureRequestId = null;
            this.native.addEventListener("message", (event) => {
              const data = event.data?.request_id === this.failureRequestId
                ? {
                    version: 1,
                    request_id: this.failureRequestId,
                    status: "error",
                    contract: "rag-indexing-v1",
                    error: { code: "worker_failed", message: "injected initial report failure" },
                  }
                : event.data;
              this.onmessage?.(new MessageEvent("message", { data }));
            });
            this.native.addEventListener("error", (event) => this.onerror?.(event));
            this.native.addEventListener("messageerror", (event) => this.onmessageerror?.(event));
          }

          postMessage(message, transfer) {
            if (message?.operation === "run-indexing-contract") this.failureRequestId = message.request_id;
            if (transfer === undefined) this.native.postMessage(message);
            else this.native.postMessage(message, transfer);
          }

          terminate() {
            window.__startupWorkerTerminations += 1;
            this.native.terminate();
          }
        };
      });
      await startupPage.route(/graphRenderer|graph-renderer/iu, async (route) => {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 750));
        await route.continue();
      });
      await startupPage.goto(applicationUrl(), { waitUntil: "networkidle", timeout: 30_000 });
      await startupPage.getByText("Worker failed: injected initial report failure").waitFor({ state: "attached", timeout: 15_000 });
      await startupPage.waitForTimeout(1_000);
      const terminalState = await startupPage.evaluate(() => ({
        terminations: window.__startupWorkerTerminations,
        renderer: document.querySelector("#graph-surface")?.getAttribute("data-renderer"),
        rendererState: document.querySelector("#renderer-state")?.textContent ?? "",
        queryDisabled: document.querySelector("#run-query")?.disabled === true,
      }));
      return recoverableFailureStayedLocal
        && terminalState.terminations === 1
        && terminalState.renderer === "svg"
        && terminalState.rendererState.includes("disposed with the session")
        && terminalState.queryDisabled;
    } finally {
      await startupPage.close();
    }
  });
  await verify("local_document_query", async () => {
    const pythonUnicodeRecordId = "85a367f0f69a6a71b7a5a83ebde236884d9474c32cef5b742f97bb40ca405aa9";
    await page.locator("details.collection-disclosure").evaluate((element) => { if (element instanceof HTMLDetailsElement) element.open = true; });
    await page.locator("details.retrieval-options").evaluate((element) => { if (element instanceof HTMLDetailsElement) element.open = true; });
    await page.locator("#local-files").setInputFiles([
      { name: "local-\uA7CB.md", mimeType: "text/markdown", buffer: Buffer.from("# Local proof\nCopper\u001Ccompass browser marker belongs to the local document corpus. [[local-second]]", "utf8") },
      { name: "local-second.txt", mimeType: "text/plain", buffer: Buffer.from("A second browser document contains a silver sextant.", "utf8") },
    ]);
    await page.locator("#load-local-files").click();
    await page.waitForFunction(() => document.querySelector("#document-state")?.textContent?.includes("Indexed 2 document(s)"), undefined, { timeout: 15_000 });
    await page.locator("#query-text").fill("copper compass browser marker");
    await page.selectOption("#query-mode", "exact_only");
    await page.locator("#query-top-k").fill("2");
    await page.locator("#query-scopes").fill("browser:local");
    await page.locator("#run-query").click();
    await page.waitForFunction((expectedId) => {
      const cells = document.querySelector("#diagnostic-result-rows tr")?.querySelectorAll("td");
      const referenceCells = document.querySelectorAll("#diagnostic-result-rows tr")[1]?.querySelectorAll("td");
      return cells?.[1]?.textContent === expectedId
        && cells?.[2]?.textContent === "local-\uA7CB.md"
        && referenceCells?.[2]?.textContent === "local-second.txt"
        && referenceCells?.[13]?.textContent === "1000000";
    }, pythonUnicodeRecordId, { timeout: 15_000 });
    await page.locator("#query-text").fill("copper compass browser marker \u1C89");
    await page.selectOption("#query-mode", "keyword_only");
    await page.locator("#run-query").click();
    await page.waitForFunction(() => document.querySelector("#diagnostic-result-rows tr")?.querySelectorAll("td")?.[6]?.textContent === "1000000", undefined, { timeout: 15_000 });
    const rows = (await page.locator("#result-list").textContent()) ?? "";
    const diagnostics = (await page.locator("#diagnostic-result-rows").textContent()) ?? "";
    const activeCollection = (await page.locator("#active-collection").textContent()) ?? "";
    return await page.locator("#query-preset").inputValue() === "custom"
      && activeCollection.includes("Your vault") && activeCollection.includes("2 notes")
      && diagnostics.includes(pythonUnicodeRecordId)
      && rows.includes("local-\uA7CB.md")
      && rows.includes("Copper\u001Ccompass browser marker");
  });
  await verify("selected_outside_graph_window", async () => {
    const sections = Array.from({ length: 521 }, (_, index) => `# Entry ${index}\nBounded-window-needle-${index} belongs only to this record.`);
    await page.locator("details.collection-disclosure").evaluate((element) => { if (element instanceof HTMLDetailsElement) element.open = true; });
    await page.locator("#local-files").setInputFiles([
      { name: "bounded-window.md", mimeType: "text/markdown", buffer: Buffer.from(sections.join("\n\n"), "utf8") },
    ]);
    await page.locator("#load-local-files").click();
    await page.waitForFunction(() => document.querySelector("#document-state")?.textContent?.includes("Indexed 1 document(s)"), undefined, { timeout: 30_000 });
    await page.getByText("Folder graph ready:").waitFor({ state: "attached", timeout: 30_000 });
    await page.selectOption("#graph-view", "evidence");
    await page.getByText("Evidence graph ready:").waitFor({ state: "attached", timeout: 30_000 });
    const omittedIndex = await page.locator("#graph-canvas").evaluate((canvas) => {
      const labels = new Set(Array.from(canvas.querySelectorAll("circle[aria-label]")).map((node) => node.getAttribute("aria-label")));
      return Array.from({ length: 521 }, (_, index) => index).find((index) => !labels.has(`chunk: Entry ${index}`)) ?? -1;
    });
    if (omittedIndex < 0) throw new Error("the bounded graph did not omit a generated record");
    await page.locator("#query-text").fill(`bounded-window-needle-${omittedIndex}`);
    await page.selectOption("#query-mode", "exact_only");
    await page.locator("#query-top-k").fill("1");
    await page.locator("#run-query").click();
    await page.getByText("Query complete: 1 ranked result(s).").waitFor({ state: "attached", timeout: 30_000 });
    const row = page.locator("#result-list button[data-record-id]").first();
    const recordId = await row.getAttribute("data-record-id");
    await row.focus();
    await row.press("Enter");
    if (!recordId) return false;
    const selectedGraphItem = page.locator(`#graph-inspector-list button[data-record-id="${recordId}"][aria-pressed="true"], #graph-canvas circle[data-record-id="${recordId}"][data-selected="true"]`);
    await selectedGraphItem.first().waitFor({ state: "attached", timeout: 45_000 });
    const inspectorCount = await page.locator(`#graph-inspector-list button[data-record-id="${recordId}"][aria-pressed="true"]`).count();
    const inspectorRecordCount = await page.locator(`#graph-inspector-list button[data-record-id="${recordId}"]`).count();
    const canvasCount = await page.locator(`#graph-canvas circle[data-record-id="${recordId}"]`).count();
    const canvasSelectedCount = await page.locator(`#graph-canvas circle[data-record-id="${recordId}"][data-selected="true"]`).count();
    const inspectorIds = await page.locator("#graph-inspector-list button[data-record-id]").evaluateAll((buttons) => buttons.slice(0, 5).map((button) => button.getAttribute("data-record-id")));
    const graphStatus = (await page.locator("#graph-state").textContent()) ?? "";
    if (inspectorCount !== 1 || !graphStatus.includes("omitted")) {
      throw new Error(`bounded graph selection mismatch: record_id=${recordId}, omitted_index=${omittedIndex}, inspector_record_count=${inspectorRecordCount}, selected_inspector_count=${inspectorCount}, canvas_record_count=${canvasCount}, selected_canvas_count=${canvasSelectedCount}, inspector_ids=${JSON.stringify(inspectorIds)}, graph_status=${JSON.stringify(graphStatus)}`);
    }
    await page.selectOption("#graph-view", "folders");
    await page.getByText("Folder graph ready:").waitFor({ state: "attached", timeout: 30_000 });
    const folderSourceSelected = await page.locator('#graph-inspector-list button[data-source-id][aria-pressed="true"]').count() === 1;
    await page.selectOption("#graph-view", "evidence");
    await page.getByText("Evidence graph ready:").waitFor({ state: "attached", timeout: 30_000 });
    const evidenceRecordSelected = await page.locator(`#graph-inspector-list button[data-record-id="${recordId}"][aria-pressed="true"]`).count() === 1;
    return folderSourceSelected && evidenceRecordSelected;
  });
  await verify("long_heading_graph_isolation", async () => {
    const heading = "H".repeat(1_025);
    await page.locator("details.collection-disclosure").evaluate((element) => { if (element instanceof HTMLDetailsElement) element.open = true; });
    await page.locator("#local-files").setInputFiles([
      { name: "long-heading.md", mimeType: "text/markdown", buffer: Buffer.from(`# ${heading}\nLong heading searchable marker.`, "utf8") },
    ]);
    await page.locator("#load-local-files").click();
    await page.waitForFunction(() => document.querySelector("#document-state")?.textContent?.includes("Indexed 1 document(s)"), undefined, { timeout: 30_000 });
    await page.getByText("Folder graph ready:").waitFor({ state: "attached", timeout: 30_000 });
    await page.selectOption("#graph-view", "evidence");
    await page.getByText("Evidence graph ready:").waitFor({ state: "attached", timeout: 30_000 });
    await page.locator("#query-text").fill("long heading searchable marker");
    await page.selectOption("#query-mode", "exact_only");
    await page.locator("#run-query").click();
    await page.getByText("Query complete: 1 ranked result(s).").waitFor({ state: "attached", timeout: 30_000 });
    const label = await page.locator('#graph-canvas circle[data-kind="chunk"] title').first().textContent();
    collectionBeforeDiagnostic = {
      results: (await page.locator("#result-list").textContent()) ?? "",
      document: (await page.locator("#document-state").textContent()) ?? "",
      graph: (await page.locator("#graph-state").textContent()) ?? "",
      recordId: (await page.locator("#result-list button[data-record-id]").first().getAttribute("data-record-id")) ?? "",
      reportEnabled: !(await page.locator("#download-query-report").isDisabled()),
    };
    return Array.from((label ?? "").split(" — ")[0]).length <= 160;
  });
  await verify("real_worker_cancellation", async () => {
    await page.locator("#run-cancellation-probe").click();
    await page.getByText("Cancellation passed:").waitFor({ state: "attached", timeout: 30_000 });
    return (await page.locator("#query-state").textContent())?.includes("Cancellation passed") ?? false;
  });
  await verify("diagnostic_preserves_collection", async () => {
    if (!collectionBeforeDiagnostic) return false;
    return collectionBeforeDiagnostic.reportEnabled
      && ((await page.locator("#result-list").textContent()) ?? "") === collectionBeforeDiagnostic.results
      && ((await page.locator("#document-state").textContent()) ?? "") === collectionBeforeDiagnostic.document
      && ((await page.locator("#graph-state").textContent()) ?? "") === collectionBeforeDiagnostic.graph
      && !(await page.locator("#download-query-report").isDisabled()) === collectionBeforeDiagnostic.reportEnabled;
  });
  await verify("worker_disposal", async () => {
    await page.locator("#dispose-worker").click();
    await page.getByText("Worker disposed.").waitFor({ state: "attached", timeout: 10_000 });
    termination.worker_disposal_acknowledged = (await page.locator("#worker-state").textContent())?.includes("Worker disposed.") ?? false;
    return termination.worker_disposal_acknowledged;
  });
  await verify("session_cleanup", async () => {
    const body = (await page.locator("body").textContent()) ?? "";
    return collectionBeforeDiagnostic !== null
      && !body.includes(collectionBeforeDiagnostic.recordId)
      && await page.locator("#graph-canvas [data-graph-node-id]").count() === 0
      && await page.locator("#result-list button[data-record-id]").count() === 0
      && await page.locator("#download-query-report").isDisabled()
      && await page.locator("#download-indexing-report").isDisabled();
  });
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  while (checkIndex < CHECK_NAMES.length) {
    const name = CHECK_NAMES[checkIndex];
    recordCheck(name, false, performance.now(), failure || "browser driver did not reach this check");
  }
} finally {
  try {
    if (page) {
      await page.close();
      termination.page_closed = page.isClosed();
    }
  } catch (error) { workerErrors.push(`page close failed: ${error instanceof Error ? error.message : String(error)}`); }
  try {
    if (context) {
      await context.close();
      termination.browser_context_closed = true;
    }
  } catch (error) { workerErrors.push(`context close failed: ${error instanceof Error ? error.message : String(error)}`); }
  try {
    if (browser) {
      await browser.close();
      termination.browser_closed = true;
    }
  } catch (error) { workerErrors.push(`browser close failed: ${error instanceof Error ? error.message : String(error)}`); }
}

timings.total_ms = elapsed(started);
const status = checks.length === CHECK_NAMES.length
  && checks.every((entry, index) => entry.name === CHECK_NAMES[index] && entry.status === "pass" && Number.isFinite(entry.elapsed_ms) && entry.elapsed_ms >= 0)
  && !consoleErrors.length && !consoleWarnings.length && !pageErrors.length && !requestFailures.length && !responseFailures.length && !workerErrors.length
  && termination.worker_disposal_acknowledged && termination.page_closed && termination.browser_context_closed && termination.browser_closed
  ? "pass"
  : "fail";
const report = {
  schema: "browser-rag-ts-smoke-v10",
  status,
  target: { url: baseUrl.href, port },
  runtime: { node: process.version, playwright: playwrightVersion, browser: browserVersion, browser_executable: browserLaunch?.executable ?? "not-launched", module_version: MODULE_VERSION },
  timings,
  checks,
  mobile_journeys: mobileJourneys,
  reports: Object.fromEntries(Object.entries(rawReports).map(([kind, value]) => [kind, { ...value, path: relative(ROOT, value.path).replaceAll("\\", "/") }])),
  errors: { console: consoleErrors, warnings: consoleWarnings, page: pageErrors, requests: requestFailures, responses: responseFailures, workers: workerErrors, expected: expectedDiagnostics },
  termination,
  ...(failure ? { failure } : {}),
};
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`browser-rag-ts smoke: ${checks.filter((entry) => entry.status === "pass").length}/${CHECK_NAMES.length} checks passed`);
console.log(`Report: ${output}`);
process.exitCode = status === "pass" ? 0 : 1;
