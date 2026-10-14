from pathlib import Path
import re
R=Path.cwd()
def edit(path, old, new):
 p=R/path;s=p.read_text();assert old in s,(path,old[:90]);p.write_text(s.replace(old,new))
edit('modules/browser-rag-ts/src/application/graphRenderer.ts','stopMotion():void {stopCamera();}', 'stopMotion():void {stopCamera();nodeMotion.cancelAll(true);}')
edit('modules/browser-rag-ts/demo/main.ts','const motionEnabled = () => !motionPreference.matches && motionStyle.value !== "quiet";', 'const motionEnabled = () => !document.hidden && !motionPreference.matches && motionStyle.value !== "quiet";')
edit('modules/browser-rag-ts/demo/main.ts','motionPreference.addEventListener("change", () => { stopTrace();graphRenderer?.setMotionEnabled(motionEnabled()); });','''motionPreference.addEventListener("change", () => { stopTrace();graphRenderer?.setMotionEnabled(motionEnabled()); });
// Returning to a tab never restarts a superseded or hidden-time replay.
document.addEventListener("visibilitychange", () => {
  graphRenderer?.setMotionEnabled(motionEnabled());
  if (document.hidden) stopTrace();
});''')
edit('modules/browser-rag-ts/src/application/tracePlayback.ts', '    this.stop();\n    if (reducedMotion || !ids.length) return true;', '    this.stop();\n    const acceptedIds = [...ids];\n    if (reducedMotion || !acceptedIds.length) return true;')
edit('modules/browser-rag-ts/src/application/tracePlayback.ts', 'index < ids.length', 'index < acceptedIds.length')
edit('modules/browser-rag-ts/src/application/tracePlayback.ts', '        step(ids.slice(0, index + 1), ids[index]!);', '''        step(acceptedIds.slice(0, index + 1), acceptedIds[index]!);
        // A synchronous callback can cancel or supersede us before a timer exists.
        if (controller.signal.aborted) return false;''')
edit('modules/browser-rag-ts/src/application/tracePlayback.ts', '2400 / ids.length', '2400 / acceptedIds.length')
p=R/'modules/browser-rag-ts/tests/application/tracePlayback.test.ts';p.write_text(p.read_text()+'''

test("reentrant stop and replacement cannot leave an old timer behind", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const trace = new TracePlayback();
  const seen: string[] = [];
  const stopped = trace.play(["one", "two"], (_, id) => { seen.push(id); trace.stop(); }, false);
  assert.equal(await stopped, false);
  let replacement: Promise<boolean> | undefined;
  const old = trace.play(["old", "obsolete"], (_, id) => {
    seen.push(id);
    replacement = trace.play(["new"], (_, id) => { seen.push(id); trace.stop(); }, false);
  }, false);
  assert.equal(await old, false);
  assert.equal(await replacement, false);
  t.mock.timers.tick(5000);
  assert.deepEqual(seen, ["one", "old", "new"]);
});

test("replay snapshots accepted IDs and callback exceptions release ownership", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const trace = new TracePlayback();
  const input = ["first", "second"];
  const seen: string[] = [];
  const playing = trace.play(input, (_, id) => { seen.push(id); input[1] = "replaced"; }, false);
  t.mock.timers.tick(360);
  await Promise.resolve();
  t.mock.timers.tick(360);
  assert.equal(await playing, true);
  assert.deepEqual(seen, ["first", "second"]);
  await assert.rejects(trace.play(["error"], () => { throw new Error("callback failed"); }, false), /callback failed/u);
  assert.equal(await trace.play(["quiet"], () => { throw new Error("quiet replay emitted"); }, true), true);
});
''')
edit('modules/browser-rag-ts/tests/node-shims.d.ts','  export default function test(name: string, callback: () => void | Promise<void>): void;', '''  interface TestContext {
    mock: { timers: {
      enable(options: { apis: readonly ["setTimeout"] }): void;
      tick(milliseconds: number): void;
    } };
  }
  export default function test(name: string, callback: (context: TestContext) => void | Promise<void>): void;''')
p=R/'modules/browser-rag-ts/src/presentation/cinematicGraph.ts';s=p.read_text()
s=s.replace('if(!from?.visible||!to?.visible)continue;\n   const path=', 'if(!from||!to)continue;\n   const path=')
s=s.replace('line.classList.add(className);line.dataset.sourceNodeId', 'line.classList.add(className);line.style.visibility=from.visible&&to.visible?"visible":"hidden";line.dataset.sourceNodeId')
s=s.replace('if(!point?.visible)continue;\n   const halo=', 'if(!point)continue;\n   const halo=')
s=s.replace('halo.dataset.nodeId=id;this.layer.append(halo);', 'halo.dataset.nodeId=id;halo.style.visibility=point.visible?"visible":"hidden";this.layer.append(halo);')
s=s.replace('halo.setAttribute("cy",String(point.y));}}', 'halo.setAttribute("cy",String(point.y));halo.style.visibility=point.visible?"visible":"hidden";}else halo.style.visibility="hidden";}')
p.write_text(s)
edit('modules/browser-rag-ts/vite.config.ts', '      strict: true,\n      allow:', '      strict: true,\n      deny: [".env", ".env.*", "*.{crt,pem,key,p12,pfx}", "**/.git/**", "**/.npmrc", "**/.yarnrc*", "**/.secrets/**"],\n      allow:')
edit('modules/browser-rag-ts/package.json','node --test tests/artifact/static-artifact.test.mjs','node --test tests/artifact/capture-source.test.mjs tests/artifact/static-artifact.test.mjs')
p=R/'scripts/atlas_presentation.mjs';s=p.read_text()
s=s.replace("import { launchChromium } from './browser_runtime.mjs';", "import { launchChromium } from './browser_runtime.mjs';\nimport { assertCaptureSource } from './capture_source.mjs';")
s=s.replace('await realpath(SITE);','await realpath(SITE);\nconst sourceIdentity = await assertCaptureSource(ROOT, SITE);')
s=s.replace('source_commit: sourceCommit, runtime, checks,','source_commit: sourceCommit, source_identity: sourceIdentity, runtime, checks,')
s=s.replace('else if (updateMedia) {','else if (updateMedia) {\n  await assertCaptureSource(ROOT, SITE);')
mark="  await capture(page, 'atlas-evidence-graph', 'Accepted evidence neighborhood with curved relationship highlights.');"
s=s.replace(mark,mark+'''
  // Exercise projection changes independently of retrieval state.
  const overlays = await page.evaluate(async () => {
    const canvas = document.querySelector('#graph-tsl-canvas');
    const path = document.querySelector('.evidence-connection');
    if (!path) return false;
    const saved = canvas.dataset.nodeTargets;
    const id = path.dataset.sourceNodeId;
    const token = path.dataset.linkId;
    const wait = () => new Promise(ok => requestAnimationFrame(() => requestAnimationFrame(ok)));
    const show = async visible => {
      canvas.dataset.nodeTargets = JSON.stringify(JSON.parse(saved).map(point => point.node_id === id ? { ...point, visible } : point));
      canvas.dispatchEvent(new Event('rag-camera-frame'));
      await wait();
    };
    try {
      await show(false);
      const hidden = path.style.visibility === 'hidden';
      await show(true);
      return hidden && path.style.visibility === 'visible' && [...document.querySelectorAll('.evidence-connection')].filter(p => p.dataset.linkId === token).length === 1;
    } finally { canvas.dataset.nodeTargets = saved; canvas.dispatchEvent(new Event('rag-camera-frame')); }
  });
  check('camera visibility restores existing evidence curves without duplicate paths', overlays);
  await page.locator('.motion-disclosure summary').click();
  await page.locator('#motion-style').selectOption('full');
  await page.locator('#replay-build').click();
  await page.waitForFunction(() => Number(document.querySelector('#graph-tsl-canvas')?.dataset.spawnActive) > 0);
  await page.locator('.motion-disclosure summary').click();
  await page.locator('#fit-graph').click();
  await frames(page);
  check('Overview settles transient node growth as well as camera motion', await page.locator('#graph-tsl-canvas').getAttribute('data-spawn-active') === '0');
  await page.locator('#replay-trace').click();
  await page.locator('#graph-surface[data-trace-active="true"]').waitFor();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await frames(page);
  check('hidden-tab signal cancels replay without changing accepted context',
    await page.locator('#graph-surface').getAttribute('data-trace-active') !== 'true' && packet === await page.locator('#context-content').textContent());
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  check('returning to a tab does not auto-restart a cancelled replay', await page.locator('#graph-surface').getAttribute('data-trace-active') !== 'true');
  await quiet(page);
''')
p.write_text(s)
p=R/'scripts/browser_rag_smoke.mjs';s=p.read_text()
s=s.replace('name: "Trace the source."','name: "Knowledge Atlas"')
s=s.replace('name: "See retrieval move through knowledge."','name: "Knowledge, in motion."')
s=s.replace('name: "Open explorer"','name: "Open Atlas"')
s=s.replace('/Explore the Three.js demo vault/u','/Explore demo vault/u')
s=s.replace('/Trace retrieval/u','/^Search$/u')
s=re.sub(r'(\.getByText\([^\n]+?\)\.waitFor\(\{) timeout:',r'\1 state: "attached", timeout:',s)
s=s.replace('await page.getByText("Sample collection", { exact: false }).first().isVisible()', '(await page.locator("#active-collection").textContent()).includes("Sample collection")')
s=s.replace('  await targetPage.locator("#show-graph").click();','  if (await targetPage.locator("#close-inspector").isVisible()) await targetPage.locator("#close-inspector").click();')
s=s.replace('  await targetPage.locator("#show-evidence").click();','  if (await targetPage.locator(".evidence-pane").isHidden()) await targetPage.locator("#toggle-inspector").click();')
s=s.replace('async function exerciseManagedMobileViewport(targetPage, requestedBackend) {','async function exerciseManagedMobileViewport(targetPage, requestedBackend) {\n  await targetPage.emulateMedia({ reducedMotion: "reduce" });')
start=s.index('  const initial = await managedViewportState(targetPage);');end=s.index('  await targetPage.waitForFunction(() => {', start)
s=s[:start]+'''  // Mobile Atlas keeps the graph visible while evidence stacks below Search.
  const resultOrder = await targetPage.locator("#result-list button[data-record-id]").evaluateAll((items) => items.map((item) => item.getAttribute("data-record-id")));
  if (await targetPage.locator("#close-inspector").isVisible()) await targetPage.locator("#close-inspector").click();
  await targetPage.locator("#fit-graph").click();
'''+s[end:]
s=s.replace('  const canvas = targetPage.locator("#graph-tsl-canvas");\n  const box = await canvas.boundingBox();\n  if (!box) return false;', '  const canvas = targetPage.locator("#graph-tsl-canvas");\n  await canvas.scrollIntoViewIfNeeded();\n  const box = await canvas.boundingBox();\n  if (!box) return false;')
s=s.replace('    const rows = page.locator("#result-list button[data-record-id]");','    if (await page.locator(".evidence-pane").isHidden()) await page.locator("#toggle-inspector").click();\n    const rows = page.locator("#result-list button[data-record-id]");')
s=s.replace('  await verify("initial_worker_reports",', '  await page.emulateMedia({ reducedMotion: "reduce" });\n  await verify("initial_worker_reports",')
s=s.replace('      await managedPage.setViewportSize({ width: 1440, height: 1000 });', '      await managedPage.emulateMedia({ reducedMotion: "reduce" });\n      await managedPage.setViewportSize({ width: 1440, height: 1000 });')
s=s.replace('      await managedPage.locator("details.visible-records").evaluate', '      await managedPage.locator("#toggle-inspector").click();\n      await managedPage.locator("details.visible-records").evaluate')
s=s.replace('      await managedPage.locator("#show-graph").click();','      await managedPage.locator("#close-inspector").click();')
start=s.index('      const startsWithEvidence =');end=s.index('    } finally {',start)
s=s[:start]+'''      const startsWithGraph = await mobilePage.locator(".graph-pane").isVisible() && await mobilePage.locator(".evidence-pane").isHidden();
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
'''+s[end:]
start=s.index('  await verify("responsive_captures"');end=s.index('  await verify("query_report_downloaded"',start)
s=s[:start]+'''  await verify("responsive_captures", async () => {
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
      await writeFile(join(captureDir, 'manifest.json'), JSON.stringify({ schema: 'rag-method-smoke-captures-v1', captures: matrix }) + '\\n');
    } finally { await publicPage.close(); }
    return true;
  });

'''+s[end:]
s=s.replace('const port = Number(argument', 'if (process.env.BROWSER_RAG_UPDATE_PUBLIC_MEDIA === "1") throw new Error("Use node scripts/atlas_presentation.mjs --update-media after building the static app.");\n\nconst port = Number(argument')
p.write_text(s)
p=R/'scripts/browser_demo_polish.mjs';s=p.read_text().replace("    await page.locator('#skip-trace').click();\n    await page.locator('#context-packet summary').click();", "    await page.locator('#skip-trace').click();\n    await page.locator('#toggle-inspector').click();\n    await page.locator('#context-packet summary').click();",1);p.write_text(s)
p=R/'modules/browser-rag-ts/demo/cinematic.css';p.write_text(p.read_text().replace('min-height: 36px;', 'min-height: 44px;'))
p=R/'README.md';s=p.read_text();s=s.replace('## Graphs and the search-scan companion','''## How the browser pipeline works

![RAG Method infographic: selected files, local Worker indexing, scoped ranking, and ordered context; graph presentation is a separate consumer](docs/media/retrieval-flow.svg)

The diagram describes the default browser application, not model inference. The graph presents indexed relationships and accepted result IDs. It does not determine retrieval scores or hold back the context packet. [Text explanation and boundaries](docs/METHOD.md).

## Graphs and the search-scan companion''');p.write_text(s)
