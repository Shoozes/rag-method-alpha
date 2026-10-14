import assert from 'node:assert/strict';

/** Shared development/copied-production acceptance for the application-only demo batch. */
export async function verifyDemoPolish(context, applicationUrl) {
  const page = await context.newPage();
  try {
    await page.goto(new URL('../', applicationUrl).href);
    for (const name of ['Documentation', 'Attribution']) {
      await page.getByRole('link', { name, exact: true }).click();
      const target = await page.evaluate(() => document.querySelector(location.hash)?.textContent);
      assert.ok(target?.length > 150, `${name} must reach real static content`);
    }
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('polish-owner')) {
        sessionStorage.removeItem('rag-method:first-trace');
        sessionStorage.setItem('polish-owner', 'true');
      }
      window.polish = { searches: [], context: null, graph: [], violations: [], holdSource: false, held: [], copied: '' };
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value) => { window.polish.copied = value; } } });
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        requests = new Map();
        appListener = null;
        set onmessage(listener) { this.appListener = listener; }
        get onmessage() { return this.appListener; }
        constructor(...args) {
          super(...args);
          this.addEventListener('message', (event) => {
            const request = this.requests.get(event.data.request_id);
            if (request?.operation === 'search' && event.data.status === 'ok' && window.polish.holdSearch) {
              window.polish.holdSearch = false;
              window.polish.finishSearch = () => this.appListener?.(event);
              return;
            }
            if (event.data.status === 'ok') {
              if (request?.operation === 'get-context') window.polish.context = event.data.result;
              if (request?.operation === 'get-graph') {
                window.polish.graph = event.data.result.nodes.map(({ id, kind, record_id, source_id }) => ({ id, kind, record_id, source_id }));
                window.polish.graphRevision = (window.polish.graphRevision ?? 0) + 1;
              }
            }
            if (request?.operation === 'get-source' && window.polish.holdSource) {
              window.polish.holdSource = false;
              window.polish.held.push((fail) => this.appListener?.(fail ? { data: { version: 1, request_id: event.data.request_id, status: 'error', contract: null, error: { code: 'worker_failed', message: 'injected old source failure' } } } : event));
            } else this.appListener?.(event);
          });
        }
        postMessage(message, ...args) {
          this.requests.set(message.request_id, message);
          if (message.operation === 'search') window.polish.searches.push(message.payload.query);
          const send = () => super.postMessage(message, ...args);
          if (message.operation === 'get-graph') setTimeout(send, 250);
          else send();
        }
      };
      const watch = () => new MutationObserver(() => {
        if (document.querySelector('#graph-surface')?.dataset.traceActive !== 'true') return;
        const state = window.polish;
        // The vault view represents chunks through their actual source nodes.
        // Check both the Worker projection and the currently rendered identities.
        const rendered = [...document.querySelectorAll('#graph-canvas circle[data-graph-node-id]')].map(node => ({
          kind: node.dataset.kind, record_id: node.dataset.recordId, source_id: node.dataset.sourceId
        }));
        const represents = (nodes, chunk) => nodes.some(node => node.record_id === chunk.id ||
          (node.kind === 'source' && node.source_id === chunk.source_id));
        const missing = state.context?.chunks.filter(chunk => !represents(state.graph, chunk) || !represents(rendered, chunk));
        if (!state.context || missing.length) state.violations.push({ issue: 'trace before matching graph',
          view: document.querySelector('#graph-view')?.value, missing: missing?.map(chunk => chunk.id) });
        if (document.querySelector('#app')?.dataset.operationOwner !== 'idle') state.violations.push('trace holds foreground');
      }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-trace-active'] });
      if (document.body) watch(); else addEventListener('DOMContentLoaded', watch, { once: true });
    });
    const url = new URL(applicationUrl);
    url.search = '?renderer=svg';
    await page.goto(url.href);
    await page.locator('#open-demo-vault:enabled').waitFor();
    await page.locator('#open-demo-vault').click();
    await page.locator('#graph-surface[data-trace-active="true"]').waitFor({ timeout: 120000 });
    assert.equal(await page.locator('#query-text').inputValue(), 'TextureLoader loadAsync');
    assert.deepEqual(await page.evaluate(() => window.polish.searches), ['TextureLoader loadAsync']);
    assert.equal(await page.locator('#run-query').isEnabled(), true);
    await page.locator('#skip-trace').click();
    await page.locator('#toggle-inspector').click();
    await page.locator('#context-packet summary').click();
    await page.locator('#copy-context').click();
    const packet = await page.evaluate(() => ({ packet: window.polish.context, displayed: document.querySelector('#context-content').textContent, copied: window.polish.copied }));
    assert.equal(packet.copied, packet.displayed);
    assert.equal(packet.displayed, [`Query: ${packet.packet.query}`, ...packet.packet.chunks.map((chunk, index) => `[${index + 1}] ${chunk.path} · ${chunk.heading}\nRecord: ${chunk.id}\nSource: ${chunk.source_id}\n\n${chunk.text}`)].join('\n\n'));
    await page.locator('#context-packet summary').click();
    await page.locator('#replay-trace').click();
    await page.locator('#graph-surface[data-trace-active="true"]').waitFor();
    await page.locator('#result-list button').first().click();
    assert.equal(await page.locator('#skip-trace').isVisible(), false);
    assert.equal(await page.locator('#result-list button').first().getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await page.evaluate(() => window.polish.violations), []);

    // Read errors and successes from old selections must never reopen or overwrite a reader.
    for (const fail of [false, true]) {
      await page.evaluate(() => { window.polish.holdSource = true; });
      await page.locator('#result-list button').first().click();
      await page.waitForFunction(() => window.polish.held.length > 0);
      assert.equal(await page.locator('#copy-source').isDisabled(), true);
      assert.equal(await page.locator('#source-origin').getAttribute('href'), null);
      await page.locator('#result-list button').nth(1).click();
      await page.locator('#copy-source:enabled').waitFor();
      const current = await page.locator('#source-content').textContent();
      await page.evaluate((fail) => window.polish.held.shift()(fail), fail);
      assert.equal(await page.locator('#source-content').textContent(), current);
    }
    await page.evaluate(() => { window.polish.holdSource = true; });
    await page.locator('#result-list button').first().click();
    await page.waitForFunction(() => window.polish.held.length > 0);
    await page.locator('#close-source-reader').click();
    await page.evaluate(() => window.polish.held.shift()(true));
    assert.equal(await page.locator('#source-reader').isVisible(), false);

    await page.locator('#replay-trace').click();
    await page.locator('#graph-surface[data-trace-active="true"]').waitFor();
    await page.locator('#query-text').fill('resize renderer canvas without stretching the scene');
    assert.equal(await page.locator('#skip-trace').isVisible(), false);
    await page.locator('#run-query').click();
    await page.locator('#graph-surface[data-trace-active="true"]').waitFor();
    assert.equal(await page.evaluate(() => window.polish.context.query), 'resize renderer canvas without stretching the scene');
    await page.locator('#skip-trace').click();
    assert.deepEqual(await page.evaluate(() => window.polish.violations), []);
    // Deliberate interaction while retrieval is finishing also owns presentation.
    await page.evaluate(() => { window.polish.holdSearch = true; });
    await page.locator('#run-query').click();
    await page.waitForFunction(() => typeof window.polish.finishSearch === 'function');
    const chosenNode = page.locator('#graph-canvas circle[data-record-id]').first();
    const chosenId = await chosenNode.getAttribute('data-graph-node-id');
    await chosenNode.focus();
    await chosenNode.press('Enter');
    const graphRevision = await page.evaluate(() => window.polish.graphRevision);
    await page.evaluate(() => window.polish.finishSearch());
    await page.locator('#copy-context:enabled').waitFor({ state: 'attached' });
    await page.waitForFunction((revision) => window.polish.graphRevision > revision && document.querySelector('#graph-state')?.textContent.includes('Evidence graph ready:'), graphRevision);
    assert.equal(await page.locator('#skip-trace').isVisible(), false);
    assert.equal(await page.locator('#graph-canvas circle[data-selected="true"]').getAttribute('data-graph-node-id'), chosenId);
    await page.reload();
    await page.locator('#open-demo-vault:enabled').waitFor();
    await page.locator('#open-demo-vault').click();
    await page.waitForFunction(() => document.querySelector('#graph-state')?.textContent.includes('Folder graph ready:'), undefined, { timeout: 120000 });
    assert.deepEqual(await page.evaluate(() => window.polish.searches), []);

    // Replacements use personal notes, never auto-query, and keep their source text inert.
    await page.locator('details.collection-disclosure summary').click();
    await page.locator('#local-files').setInputFiles([
      { name: 'one.md', mimeType: 'text/markdown', buffer: Buffer.from('# One\nLocal marker <script>window.bad=true</script>.') },
      { name: 'two.md', mimeType: 'text/markdown', buffer: Buffer.from('# Two\nLocal marker evidence, second source.') },
    ]);
    const searches = await page.evaluate(() => window.polish.searches.length);
    await page.locator('#load-local-files').click();
    await page.waitForFunction(() => document.querySelector('#active-collection')?.textContent.includes('Your vault'));
    await page.locator('#run-query:enabled').waitFor();
    assert.equal(await page.evaluate(() => window.polish.searches.length), searches);
    assert.equal(await page.locator('#copy-context').isDisabled(), true);
    assert.equal(await page.locator('#source-reader').isVisible(), false);
    const acceptedVault = await page.locator('#active-collection').textContent();
    await page.evaluate(() => {
      const read = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = function () {
        if (this.name !== 'delayed.md') return read.call(this);
        return new Promise((resolve) => { window.finishOldFile = () => resolve(new TextEncoder().encode('Obsolete replacement').buffer); });
      };
    });
    if (!await page.locator('#local-files').isVisible()) await page.locator('details.collection-disclosure summary').click();
    await page.locator('#local-files').setInputFiles({ name: 'delayed.md', mimeType: 'text/markdown', buffer: Buffer.from('Obsolete replacement') });
    await page.locator('#load-local-files').click();
    await page.waitForFunction(() => typeof window.finishOldFile === 'function');
    await page.locator('#cancel-query').click();
    await page.waitForFunction(() => /Loading cancelled.*previous accepted vault/u.test(document.querySelector('#query-state')?.textContent ?? ''));
    const cancelledStatus = await page.locator('#query-state').textContent();
    await page.evaluate(() => window.finishOldFile());
    assert.equal(await page.locator('#query-state').textContent(), cancelledStatus);
    assert.equal(await page.locator('#active-collection').textContent(), acceptedVault);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('#graph-view').selectOption('evidence');
    await page.locator('#query-text').fill('Local marker');
    await page.locator('#run-query').click();
    await page.locator('#copy-query-report:enabled').waitFor({ state: 'attached' });
    await page.waitForFunction(() => document.querySelector('#graph-state')?.textContent.includes('Evidence graph ready:'));
    assert.equal(await page.locator('#skip-trace').isVisible(), false);
    assert.equal(await page.evaluate(() => window.bad === true), false);
    await page.locator('details.advanced summary').click();
    await page.locator('#dispose-worker').click();
    await page.getByText('Worker disposed. Local document references were released.').waitFor();
    assert.equal(await page.locator('#copy-context').isDisabled(), true);
    assert.equal(await page.locator('#source-content').textContent(), '');
  } finally { await page.close(); }

  // Fault injection has its own monitored context; expected network faults must
  // not contaminate the healthy journey's zero-error receipt.
  const recoveryContext = await context.browser().newContext();
  const recovery = await recoveryContext.newPage();
  const recoveryErrors = [];
  const missingResponses = [];
  recovery.on('pageerror', (error) => recoveryErrors.push(error.message));
  recovery.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('404 (Not Found)')) recoveryErrors.push(message.text());
  });
  recovery.on('requestfailed', (request) => {
    const path = new URL(request.url()).pathname;
    if (!/\/threejs-docs\.(manifest|pack)\.json$/u.test(path) || request.failure()?.errorText !== 'net::ERR_ABORTED') recoveryErrors.push(`${path}: ${request.failure()?.errorText}`);
  });
  recovery.on('response', (response) => {
    if (response.status() >= 400) missingResponses.push({ path: new URL(response.url()).pathname, status: response.status() });
  });
  try {
    await recovery.route('**/threejs-docs.manifest.json', (route) => route.fulfill({ status: 404, body: 'Missing example' }));
    const url = new URL(applicationUrl); url.search = '?renderer=svg';
    await recovery.goto(url.href);
    await recovery.locator('#retry-example:not([hidden])').waitFor();
    assert.deepEqual(missingResponses, [{ path: new URL('corpora/threejs-docs.manifest.json', new URL('../', applicationUrl)).pathname, status: 404 }]);
    assert.equal(await recovery.locator('#open-local-vault').isEnabled(), true);
    await recovery.unroute('**/threejs-docs.manifest.json');
    await recovery.locator('#retry-example').click();
    await recovery.locator('#retry-example').waitFor({ state: 'hidden' });
    assert.match(await recovery.locator('#demo-document-count').textContent(), /921/u);
    // A stalled download remains cancellable without terminating the ready Worker.
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    await recovery.route('**/threejs-docs.manifest.json', async (route) => { await gate; await route.abort().catch(() => undefined); });
    await recovery.route('**/threejs-docs.pack.json', async (route) => { await gate; await route.abort().catch(() => undefined); });
    await recovery.reload({ waitUntil: 'domcontentloaded' });
    await recovery.locator('#open-demo-vault:enabled').waitFor();
    await recovery.locator('#open-demo-vault').click();
    await recovery.locator('#cancel-welcome-import').click();
    await recovery.getByText(/Loading cancelled.*previous accepted vault/u).first().waitFor();
    release();
    assert.equal(await recovery.locator('#open-local-vault').isEnabled(), true);
    assert.equal(await recovery.locator('#retry-example').isEnabled(), true);
    await recovery.unroute('**/threejs-docs.manifest.json');
    await recovery.unroute('**/threejs-docs.pack.json');
    assert.equal(missingResponses.length, 1);
    assert.deepEqual(recoveryErrors, []);
  } finally { await recoveryContext.close(); }
}
