import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium } from "./browser_runtime.mjs";


const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptRoot, "..");
const requireFromFrontend = createRequire(
  path.join(repoRoot, "source", "frontend", "package.json"),
);

function parseArguments(values) {
  const parsed = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (key === "--headed") {
      parsed.set(key, true);
      continue;
    }
    const value = values[index + 1];
    if (!key.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(`invalid browser-smoke argument near ${key}`);
    }
    parsed.set(key, value);
    index += 1;
  }
  for (const required of ["--url", "--folder", "--zip", "--screenshot", "--mobile-screenshot", "--report"]) {
    if (!parsed.has(required)) throw new Error(`missing ${required}`);
  }
  return parsed;
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const waitForPaint = (page) => page.evaluate(
  () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
);

async function main() {
  const args = parseArguments(process.argv.slice(2));
  let chromium;
  let playwrightVersion;
  try {
    ({ chromium } = requireFromFrontend("playwright"));
    playwrightVersion = requireFromFrontend("playwright/package.json").version;
  } catch (error) {
    throw new Error(`Playwright is not installed in source/frontend; run npm ci: ${error.message}`);
  }

  const checks = [];
  const consoleErrors = [];
  const consoleWarnings = [];
  const httpErrors = [];
  let browser;
  let browserLaunch;
  const runCheck = async (name, action) => {
    const started = performance.now();
    await action();
    checks.push({ name, status: "pass", elapsed_ms: Math.round((performance.now() - started) * 1000) / 1000 });
  };
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };

  try {
    browserLaunch = await launchChromium(
      chromium,
      { headless: !args.has("--headed") },
      "RAG_METHOD_CHROMIUM_PATH",
    );
    browser = browserLaunch.browser;
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "no-preference",
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(25_000);
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
      if (message.type() === "warning") {
        const location = message.location();
        consoleWarnings.push({
          text: message.text(),
          url: typeof location?.url === "string" ? location.url : "",
          line: Number.isInteger(location?.lineNumber) ? location.lineNumber : 0,
          column: Number.isInteger(location?.columnNumber) ? location.columnNumber : 0,
        });
      }
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400) {
        httpErrors.push({ status: response.status(), url: response.url() });
      }
    });

    let markSlowRequest;
    let markCancelledRequest;
    let countComparisonRequests = false;
    let comparisonRequestCount = 0;
    let truncateNextFolderGraph = false;
    let truncateFolderTargetId = null;
    let delayCollectionRaceGraph = false;
    let markCollectionRaceGraph;
    let staleCollectionSearchCount = 0;
    const slowRequest = new Promise((resolve) => {
      markSlowRequest = resolve;
    });
    const cancelledRequest = new Promise((resolve) => {
      markCancelledRequest = resolve;
    });
    const collectionRaceGraph = new Promise((resolve) => {
      markCollectionRaceGraph = resolve;
    });
    await page.route("**/rag/search?*", async (route) => {
      const query = new URL(route.request().url()).searchParams.get("query");
      if (countComparisonRequests) comparisonRequestCount += 1;
      if (query === "collection switch race") staleCollectionSearchCount += 1;
      if (query === "slow first request") {
        markSlowRequest();
        await delay(800);
        try {
          await route.continue();
        } catch {
          // Superseding the request is the behavior under test.
        }
        return;
      }
      if (query === "cancel this request") {
        markCancelledRequest();
        await delay(800);
        try {
          await route.continue();
        } catch {
          // Explicit cancellation is the behavior under test.
        }
        return;
      }
      await route.continue();
    });
    await page.route("**/rag/graph?*", async (route) => {
      const requestUrl = new URL(route.request().url());
      if (delayCollectionRaceGraph && requestUrl.searchParams.get("companion_id") === "rag-method-demo-v1") {
        delayCollectionRaceGraph = false;
        markCollectionRaceGraph();
        await delay(800);
        try {
          await route.continue();
        } catch {
          // Collection switching should abort the superseded graph request.
        }
        return;
      }
      if (!truncateNextFolderGraph || requestUrl.searchParams.get("companion_id") !== "folder-smoke") {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const payload = await response.json();
      const nodes = payload.nodes.filter((node) => node.id !== truncateFolderTargetId).slice(0, 24);
      const visibleIds = new Set(nodes.map((node) => node.id));
      const links = payload.links.filter(
        (link) => visibleIds.has(link.source) && visibleIds.has(link.target),
      );
      payload.nodes = nodes;
      payload.links = links;
      payload.graph_meta.returned_nodes = nodes.length;
      payload.graph_meta.returned_links = links.length;
      payload.graph_meta.truncated = true;
      truncateNextFolderGraph = false;
      await route.fulfill({ response, json: payload });
    });

    const runRetrieval = async (query, expectedStatus = 200) => {
      const [response] = await Promise.all([
        page.waitForResponse((candidate) => {
          const url = new URL(candidate.url());
          return url.pathname === "/rag/search" && url.searchParams.get("query") === query;
        }),
        page.locator("#run-search").click(),
      ]);
      assert(response.status() === expectedStatus, `query ${query.slice(0, 40)} returned HTTP ${response.status()}`);
      await page.locator("#run-search").getByText("Run retrieval", { exact: true }).waitFor();
      return response;
    };
    const controlledQuery = "Amber marks release readiness";

    await runCheck("launch and initial state", async () => {
      await page.goto(args.get("--url"), { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: "RAG Method Lab" }).waitFor();
      await page.getByRole("region", { name: "Evidence summary" }).waitFor();
      assert(!(await page.locator("#advanced-view").isChecked()), "simple view must be the default");
      assert((await page.locator("#retrieval-mode").count()) === 0, "advanced controls must be hidden by default");
      await page.getByText("No Collection selected", { exact: true }).waitFor();
      assert(await page.locator("#search").isDisabled(), "search must be disabled before selection");
    });

    await runCheck("built-in demo load and idempotent selection", async () => {
      await page.getByRole("button", { name: "Load Demo" }).click();
      await page.locator(".status-line").filter({ hasText: "Ready: rag-method-demo-v1" }).waitFor();
      await page
        .locator(".simple-collection-card > div:first-child > strong")
        .filter({ hasText: "RAG Method Demo" })
        .waitFor();
      assert(!(await page.locator("#search").isDisabled()), "search must enable after demo load");
      await page.locator("#suggested-query").selectOption({ label: "What color marks release readiness?" });
      await runRetrieval("What color marks release readiness?");
      await page.getByRole("region", { name: "Evidence summary" }).getByText(/Amber marks release readiness/i).first().waitFor();

      await page.getByRole("button", { name: "Reload Demo" }).click();
      await page.locator(".status-line").filter({ hasText: "Ready: rag-method-demo-v1" }).waitFor();
      await page.getByText("Manage Collections", { exact: true }).click();
      assert(
        (await page.getByRole("button", { name: "RAG Method Demo", exact: true }).count()) === 1,
        "loading the demo twice must not create a second collection",
      );
      await page.getByText("Manage Collections", { exact: true }).click();

      await page.locator("#advanced-view").check();
      await page.locator("#retrieval-mode").waitFor();
      const persistencePage = await context.newPage();
      await persistencePage.goto(args.get("--url"), { waitUntil: "networkidle" });
      assert(await persistencePage.locator("#advanced-view").isChecked(), "advanced preference must persist across pages");
      await persistencePage.locator("#retrieval-mode").waitFor();
      await persistencePage.evaluate(() => localStorage.clear());
      await page.waitForFunction(() => !(document.querySelector("#advanced-view")?.checked));
      await page.getByRole("region", { name: "Evidence summary" }).waitFor();
      await page.locator("#advanced-view").check();
      await page.locator("#retrieval-mode").waitFor();
      await persistencePage.close();
    });

    await runCheck("explicit controls and ranked evidence", async () => {
      await page.locator("#search").fill(controlledQuery);
      await page.locator("#retrieval-mode").selectOption("exact_only");
      await page.locator("#top-k").fill("3");
      await page.locator("#context-limit").fill("1800");
      await page.getByLabel("memories", { exact: true }).uncheck();
      const response = await runRetrieval(controlledQuery);
      const requestUrl = new URL(response.url());
      assert(requestUrl.searchParams.get("mode") === "exact_only", "mode must reach the API");
      assert(requestUrl.searchParams.get("top_k") === "3", "top-k must reach the API");
      assert(requestUrl.searchParams.get("max_context_tokens") === "1800", "context limit must reach the API");
      assert(requestUrl.searchParams.get("debug") === "1", "detailed evidence must be explicit");
      assert(!requestUrl.searchParams.get("pockets").includes("memories"), "disabled pocket must be excluded");
      await page.getByRole("region", { name: "Evidence Inspector" }).getByText("Exact", { exact: true }).waitFor();
      const detailText = await page.locator(".evidence-detail").first().innerText();
      assert(/Authority\s+[^—\s]/.test(detailText), "selected evidence must expose an authority class");
      assert(/Source ID\s+[^—\s]/.test(detailText), "selected evidence must expose a source ID");
      assert(/Primary match\s+(exact|semantic|keyword|cross_reference)/.test(detailText), "selected evidence must expose its primary match type");
      await page.getByText(/Final context order/i).waitFor();
      for (const label of ["Exact", "Keyword"]) {
        const rowText = await page.locator(".score-row").filter({ hasText: label }).innerText();
        assert(/\d+(?:\.\d)%/.test(rowText), `${label} score must expose a normalized percentage`);
        assert(/-?\d+ µ/.test(rowText), `${label} score must expose exact micro-units`);
      }

      await page.locator("#context-limit").fill("1");
      await runRetrieval(controlledQuery);
      await page.getByText("No chunks fit this query and context budget.").waitFor();
      await page.getByText("bounded selection", { exact: true }).waitFor();

      await page.locator("#context-limit").fill("1800");
      await page.locator("#retrieval-mode").selectOption("keyword_only");
      const keywordResponse = await runRetrieval(controlledQuery);
      assert(new URL(keywordResponse.url()).searchParams.get("mode") === "keyword_only", "keyword mode must reach the API");
      await page.locator(".ranked-evidence").getByText(/Amber marks release readiness/i).first().waitFor();

      await page.locator("#retrieval-mode").selectOption("semantic_only");
      await runRetrieval(controlledQuery);
      await page.getByText("No matching chunks for these settings.").waitFor();
      await page.getByText("semantic disabled_by_settings", { exact: true }).waitFor();

      await page.locator("#retrieval-mode").selectOption("hybrid");
      const hybridResponse = await runRetrieval(controlledQuery);
      assert(new URL(hybridResponse.url()).searchParams.get("mode") === "hybrid", "hybrid mode must reach the API");
      await page.locator(".ranked-evidence").getByText(/Amber marks release readiness/i).first().waitFor();

      await page.locator("#retrieval-mode").selectOption("scoped_hybrid");
      await runRetrieval(controlledQuery);
      await page.locator(".ranked-evidence").getByText(/Amber marks release readiness/i).first().waitFor();

      for (const pocket of ["global", "vault", "lore"]) {
        await page.getByLabel(pocket, { exact: true }).uncheck();
      }
      assert(await page.locator("#run-search").isDisabled(), "search must stop when every pocket is disabled");
      await page.locator("#advanced-view").uncheck();
      await page.getByText("No pockets are selected. Turn on Advanced tools to choose one.").waitFor();
      await page.locator("#advanced-view").check();
      for (const pocket of ["global", "vault", "lore", "memories"]) {
        await page.getByLabel(pocket, { exact: true }).check();
      }
    });

    await runCheck("result and graph selection", async () => {
      await page.getByRole("region", { name: "Knowledge graph", exact: true }).waitFor();
      await page.locator(".graph-stage.has-graph canvas").waitFor();
      await page.locator(".ranked-evidence button").first().click();
      await page.locator(".graph-stage.has-graph[data-camera-target-id]:not([data-camera-target-id=''])").waitFor();
      await page.getByText(/Camera focused on /).waitFor();
      await page.locator(".graph-toolbar").getByRole("button", { name: "Reset view" }).click();
      await page.waitForFunction(() => document.querySelector(".graph-stage.has-graph")?.getAttribute("data-camera-target-id") === "");
    });

    await runCheck("bounded comparison and report export", async () => {
      countComparisonRequests = true;
      await page.locator("#compare-modes").click();
      await page.locator(".comparison-grid article").nth(3).waitFor();
      countComparisonRequests = false;
      assert(comparisonRequestCount === 4, `comparison issued ${comparisonRequestCount} requests instead of four`);
      assert((await page.locator(".comparison-grid article").count()) === 4, "comparison must show four modes");
      await page.locator(".comparison-grid").getByText(/semantic only/i).waitFor();
      await page.locator(".comparison-grid").getByText(/disabled_by_settings/i).first().waitFor();

      await page.locator("#copy-report").click();
      const copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
      assert(copied.schema === "rag_method_lab_query_report_v1", "copied report schema is wrong");

      const downloadPromise = page.waitForEvent("download");
      await page.locator("#download-report").click();
      const download = await downloadPromise;
      await download.saveAs(args.get("--report"));
      const report = JSON.parse(fs.readFileSync(args.get("--report"), "utf8"));
      assert(report.schema === "rag_method_lab_query_report_v1", "downloaded report schema is wrong");
      assert(report.application.name === "RAG Method Lab", "report application name is wrong");
      assert(report.application.version === "0.1.0", "report application version is wrong");
      assert(report.collection.id === "rag-method-demo-v1", "report collection is wrong");
      assert(report.contracts.retrieval === "rag-behavior-v2", "report retrieval contract is wrong");
      assert(report.contracts.indexing === "rag-indexing-v1", "report indexing contract is wrong");
      assert(report.comparison.length === 4, "report must contain four comparison modes");
      assert(report.comparison.every((entry) => !entry.observation || entry.observation.results.length <= 3), "comparison result cap was exceeded");
      await page.locator("canvas.shader-background").evaluate((canvas) => {
        window.__ragMethodShaderContext = canvas.getContext("webgl2") || canvas.getContext("webgl");
      });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.getByRole("region", { name: "Knowledge graph summary" }).waitFor();
      await page.locator("#advanced-view").uncheck();
      await page.getByRole("region", { name: "Evidence summary" }).waitFor();
      assert((await page.locator(".mode-comparison").count()) === 0, "simple view must hide comparison tools");
      assert((await page.locator(".simple-result-detail").count()) === 1, "simple view must preserve the selected evidence");
      await page.locator(".shader-background-static").waitFor();
      assert(
        (await page.locator("canvas.shader-background").count()) === 0,
        "reduced motion must not keep the WebGL background alive",
      );
      assert(
        await page.evaluate(() => window.__ragMethodShaderContext?.isContextLost() === true),
        "reduced motion must release the WebGL background context",
      );
      await waitForPaint(page);
      await page.screenshot({ path: args.get("--screenshot"), fullPage: true });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.getByRole("region", { name: "Knowledge graph", exact: true }).waitFor();
      await page.locator("#advanced-view").check();
      await page.locator("#retrieval-mode").waitFor();
    });

    await runCheck("explicit cancellation, supersession, and recovery", async () => {
      const search = page.locator("#search");
      await search.fill("slow first request");
      await page.locator("#run-search").click();
      await Promise.race([
        slowRequest,
        delay(5_000).then(() => {
          throw new Error("delayed search request did not start");
        }),
      ]);
      await search.fill("What color marks release readiness?");
      await runRetrieval("What color marks release readiness?");
      await delay(900);
      await page.locator(".run-summary").getByText(/What color marks release readiness/i).waitFor();

      await search.fill("cancel this request");
      await page.locator("#run-search").click();
      await Promise.race([
        cancelledRequest,
        delay(5_000).then(() => {
          throw new Error("cancellable search request did not start");
        }),
      ]);
      await page.locator("#cancel-search").click();
      await page.locator(".status-line").filter({ hasText: "Retrieval cancelled." }).waitFor();
      await delay(900);
      assert((await page.locator(".run-summary").count()) === 0, "cancelled search must not publish results");

      await search.fill("e\u0301");
      assert(!(await page.locator("#run-search").isDisabled()), "combining-character query must remain runnable");
      assert((await page.locator(".query-limit").innerText()).includes("2 / 4,000 scalar values"), "combining characters must count as two scalars");
      await search.fill("😀");
      assert(!(await page.locator("#run-search").isDisabled()), "supplementary-character query must remain runnable");
      await search.fill("😀".repeat(4_000));
      assert(!(await page.locator("#run-search").isDisabled()), "the 4,000-scalar boundary must remain runnable");
      assert((await page.locator(".query-limit").innerText()).includes("4,000 / 4,000 scalar values"), "scalar count must reach the exact boundary");
      await search.fill("😀".repeat(4_001));
      assert(await page.locator("#run-search").isDisabled(), "4,001 scalar values must disable Run");
      assert(await page.locator("#compare-modes").isDisabled(), "invalid queries must disable Compare");
      await page.getByRole("alert").filter({ hasText: "4,000 Unicode scalar values" }).waitFor();
      await search.evaluate((element) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(element, "\uD800");
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await page.getByRole("alert").filter({ hasText: "invalid Unicode scalar" }).waitFor();
      assert(await page.locator("#run-search").isDisabled(), "unpaired surrogates must disable Run");

      const oversized = "x".repeat(4_001);
      const directStatus = await page.evaluate(async (value) => {
        const params = new URLSearchParams({
          companion_id: "rag-method-demo-v1",
          pockets: "global,vault,lore,memories",
          query: value,
          mode: "exact_only",
          top_k: "5",
          max_context_tokens: "1800",
          debug: "0",
        });
        const response = await fetch(`/rag/search?${params.toString()}`);
        return response.status;
      }, oversized);
      assert(directStatus === 400, "direct oversized callers must still receive HTTP 400");
      await search.fill("What color marks release readiness?");
      await runRetrieval("What color marks release readiness?");
      await page.locator(".ranked-evidence").getByText(/Amber marks release readiness/i).first().waitFor();
    });

    await runCheck("folder import and collection refresh", async () => {
      await page.locator("#collection-id").fill("folder-smoke");
      await page.locator('input[type="file"][webkitdirectory]').setInputFiles(args.get("--folder"));
      await page.locator(".status-line").filter({ hasText: "Ready: folder-smoke" }).waitFor();
      await page.getByRole("button", { name: "folder-smoke", exact: true }).waitFor();
      assert(!(await page.locator("#search").isDisabled()), "search must enable after import");
    });

    await runCheck("bounded graph fallback", async () => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.getByRole("region", { name: "Knowledge graph summary" }).waitFor();
      const summary = await page.locator(".graph-summary").innerText();
      assert(
        /Reduced motion is enabled|graph is larger than the 3D view/.test(summary),
        "bounded graph fallback must explain why the static summary is active",
      );
      assert(summary.includes("Showing 24 prioritized nodes (bounded to 24)."), "graph fallback must remain bounded and disclose priority selection");
      assert((await page.locator(".graph-summary li").count()) === 24, "graph fallback must render exactly the bounded row count");
      await page.locator(".graph-summary button").first().click();
      await page.getByText("Graph evidence", { exact: true }).waitFor();
      await page.locator(".graph-summary").getByRole("button", { name: "Reset selection" }).click();
      assert((await page.locator(".graph-summary button.selected").count()) === 0, "graph reset must clear selection");
    });

    await runCheck("folder retrieval and refresh", async () => {
      await page.getByRole("button", { name: "RAG Method Demo", exact: true }).click();
      await page.locator('.collection-option[aria-pressed="true"][aria-label="RAG Method Demo"]').waitFor();
      await page.getByLabel("memories", { exact: true }).uncheck();
      await page.locator("#search").fill("collection switch race");
      delayCollectionRaceGraph = true;
      await page.locator("#run-search").click();
      await collectionRaceGraph;
      await page.getByRole("button", { name: "folder-smoke", exact: true }).click();
      await page.locator('.collection-option[aria-pressed="true"][aria-label="folder-smoke"]').waitFor();
      await delay(900);
      assert(staleCollectionSearchCount === 0, "a superseded graph load must not start retrieval for the old Collection");
      assert(
        (await page.locator(".run-summary").filter({ hasText: "collection switch race" }).count()) === 0,
        "a superseded graph load must not publish stale evidence",
      );
      await page.getByLabel("memories", { exact: true }).check();
      const search = page.locator("#search");
      await search.fill("folder smoke beacon");
      await runRetrieval("folder smoke beacon");
      await page.locator(".ranked-evidence").getByText(/Folder smoke beacon/i).waitFor();
      await search.fill("cross-reference beacon");
      await runRetrieval("cross-reference beacon");
      const crossTarget = page.locator(".ranked-evidence button").filter({ hasText: "Destination" });
      if ((await crossTarget.count()) === 0) {
        throw new Error(`cross-reference results did not include target: ${await page.locator(".ranked-evidence").innerText()}`);
      }
      await crossTarget.click();
      const inspectorText = await page.getByRole("region", { name: "Evidence Inspector" }).innerText();
      assert(inspectorText.includes("cross_reference"), `selected target inspector did not expose cross_reference: ${inspectorText}`);
      const targetId = await crossTarget.getAttribute("data-result-id");
      assert(targetId, "cross-reference result must expose its result id");
      const selectedGraphRow = page.locator(`.graph-summary button.selected[data-node-id="${targetId}"]`);
      await selectedGraphRow.waitFor();
      truncateFolderTargetId = targetId;
      truncateNextFolderGraph = true;
      await page.getByRole("button", { name: "Refresh Index" }).click();
      await page.locator(".status-line").filter({ hasText: "Graph summarized" }).waitFor();
      await page.getByText("Selected retrieval evidence is outside the bounded graph response.", { exact: true }).waitFor();
      await page.locator("#advanced-view").uncheck();
      await page.locator(".simple-result-detail").getByText("cross_reference match", { exact: true }).waitFor();
      await page.locator("#advanced-view").check();
      await page.locator("#retrieval-mode").waitFor();
      await search.fill("folder smoke beacon");
      await runRetrieval("folder smoke beacon");
      await page.getByRole("button", { name: "Refresh Index" }).click();
      await page.locator(".status-line").filter({ hasText: "Refreshed." }).waitFor();
    });

    await runCheck("ZIP import", async () => {
      await page.locator("#collection-id").fill("zip-smoke");
      await page.locator('input[type="file"][accept*="zip"]').setInputFiles(args.get("--zip"));
      await page.locator(".status-line").filter({ hasText: "Ready: zip-smoke" }).waitFor();
      await page.getByRole("button", { name: "folder-smoke", exact: true }).waitFor();
      await page.getByRole("button", { name: "zip-smoke", exact: true }).waitFor();
    });

    await runCheck("mobile containment", async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      const sidebarButton = page.getByRole("button", { name: /sidebar/i });
      await sidebarButton.waitFor();
      if ((await sidebarButton.getAttribute("aria-expanded")) === "false") await sidebarButton.click();
      await page.getByRole("heading", { name: "Collections" }).waitFor();
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      assert(!overflows, "mobile viewport must not overflow horizontally");
      const localOverflows = await page.locator(".sidebar, .collection-list").evaluateAll(
        (elements) => elements
          .filter((element) => element.scrollWidth > element.clientWidth + 1)
          .map((element) => element.className),
      );
      assert(
        localOverflows.length === 0,
        `mobile panels must not hide horizontal overflow: ${localOverflows.join(", ")}`,
      );
      await page.waitForFunction(() => {
        const list = document.querySelector(".collection-list");
        const selected = document.querySelector('.collection-option[aria-pressed="true"]');
        if (!(list instanceof HTMLElement) || !(selected instanceof HTMLElement)) return false;
        const listBox = list.getBoundingClientRect();
        const selectedBox = selected.getBoundingClientRect();
        return selectedBox.top >= listBox.top - 1 && selectedBox.bottom <= listBox.bottom + 1;
      }, undefined, { timeout: 2_000 });
      const buttonBox = await sidebarButton.boundingBox();
      const searchBox = await page.locator("#search").boundingBox();
      assert(buttonBox && searchBox, "mobile controls must have measurable bounds");
      const controlsOverlap = !(
        buttonBox.x + buttonBox.width <= searchBox.x
        || searchBox.x + searchBox.width <= buttonBox.x
        || buttonBox.y + buttonBox.height <= searchBox.y
        || searchBox.y + searchBox.height <= buttonBox.y
      );
      assert(!controlsOverlap, "mobile sidebar toggle must not overlap search");

      await page.locator("#advanced-view").uncheck();
      await page.getByRole("region", { name: "Evidence summary" }).waitFor();
      await page.locator("#search").fill("ZIP smoke beacon");
      await runRetrieval("ZIP smoke beacon");
      await page
        .getByRole("region", { name: "Evidence summary" })
        .getByText(/ZIP smoke beacon/i)
        .first()
        .waitFor();
      if ((await sidebarButton.getAttribute("aria-expanded")) === "true") await sidebarButton.click();
      await page.waitForFunction(() => !document.querySelector(".sidebar")?.classList.contains("open"));
      await delay(250);
      await page.locator(".simple-workspace").waitFor();
      const simpleOverflows = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      assert(!simpleOverflows, "simple mobile view must not overflow horizontally");
      await page.screenshot({ path: args.get("--mobile-screenshot"), fullPage: true });

      const persistencePage = await context.newPage();
      await persistencePage.setViewportSize({ width: 800, height: 900 });
      await persistencePage.goto(args.get("--url"), { waitUntil: "networkidle" });
      assert(!(await persistencePage.locator("#advanced-view").isChecked()), "simple preference must persist across pages");
      assert(
        (await persistencePage.getByRole("button", { name: "Open sidebar" }).getAttribute("aria-expanded")) === "false",
        "the sidebar must start closed across the complete responsive breakpoint",
      );
      await persistencePage.getByRole("region", { name: "Evidence summary" }).waitFor();
      await persistencePage.close();
    });

    const expectedHttpErrors = httpErrors.filter((item) => {
      const url = new URL(item.url);
      return item.status === 400 && url.pathname === "/rag/search" && url.searchParams.get("query")?.length === 4_001;
    });
    assert(expectedHttpErrors.length === 1, "the oversized-query failure must return one HTTP 400");
    assert(httpErrors.length === expectedHttpErrors.length, `unexpected HTTP errors: ${JSON.stringify(httpErrors)}`);
    const resourceErrors = consoleErrors.filter((message) => message.startsWith("Failed to load resource:"));
    const unexpectedConsoleErrors = consoleErrors.filter((message) => !message.startsWith("Failed to load resource:"));
    assert(resourceErrors.length <= expectedHttpErrors.length, `unexpected resource errors: ${resourceErrors.join(" | ")}`);
    assert(unexpectedConsoleErrors.length === 0, `browser console errors: ${unexpectedConsoleErrors.join(" | ")}`);
    return {
      schema: "mirrorlight_browser_driver_report_v1",
      status: "pass",
      versions: {
        playwright: playwrightVersion,
        browser: browser.version(),
        browser_executable: browserLaunch.executable,
      },
      checks,
      console: {
        errors: unexpectedConsoleErrors,
        warnings: consoleWarnings,
        expected_http_errors: expectedHttpErrors.map((item) => ({ status: item.status, path: new URL(item.url).pathname })),
      },
    };
  } finally {
    await browser?.close();
  }
}

try {
  const report = await main();
  console.log(JSON.stringify(report));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(JSON.stringify({ schema: "mirrorlight_browser_driver_report_v1", status: "fail", error: message }));
  process.exitCode = 1;
}
