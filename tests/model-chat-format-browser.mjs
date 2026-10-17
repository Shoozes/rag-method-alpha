#!/usr/bin/env node
// Production bootstrap, DOM renderer, canonical stores, context and citations.
// Only runtime-adapter is replaced by the labeled deterministic UI fixture below.
// No model, native tokenizer, Worker, WASM or OS clipboard access. Explicit live
// mode fetches only the approved deployment directory and verifies published bytes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from '../examples/browser-model-chat/serve.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const memoryRoot = resolve(process.env.BROWSER_MODEL_MEMORY_ROOT || join(root, '.artifacts/memory'));
const runtimeRoot = resolve(process.env.BROWSER_MODEL_RUNTIME_ROOT || join(root, '../rag-model-onboarding/.artifacts/model-chat/runtime'));
const output = join(root, '.artifacts/proof/chat-format');
const profilePrefix = 'rag-chat-format-fixture-';
const approvedLiveUrl = 'https://shoozes.github.io/rag-method-alpha/model-chat/';
const approvedSourceHead = '71559daf0dc23ef3f9f17587564c92f68a4f03c9';
const liveUrl = process.env.FORMAT_BROWSER_BASE_URL;
const live = liveUrl !== undefined;
const coreSha256 = 'c282ebb3965c4a25b48fb66082ce18c72184449f2123633a901ffceb9939ace6';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const started = Date.now(), harnessSha256 = digest(await readFile(fileURLToPath(import.meta.url)));
const checks = [], observations = [], assets = [], forbidden = [], pageErrors = [], screenshots = [];
const cleanup = { localServerStarted: false, contextClosed: false, serverClosed: false, ownedProfileRemoved: false };
const approvedAssetBytes = new Map();
let server, context, page, profile, base, browserVersion, sourceBefore, sourceAfter, failure;
let requests = 0, assetBytes = 0, workers = 0, deadline;
const adapter = `
const f=window.__formatFixture={label:'DETERMINISTIC UI FIXTURE - no model/native tokenizer',calls:[],pending:null,meterPlans:[]};
f.token=text=>{if(!f.pending)throw Error('No pending UI fixture reply');f.pending.options.onToken?.(text);};
f.finish=(text,completion)=>{if(!f.pending)throw Error('No pending UI fixture reply');const p=f.pending;f.pending=null;if(completion!==undefined)p.options.onCompletion?.(completion);p.resolve(text);};
f.fail=message=>{if(!f.pending)throw Error('No pending UI fixture reply');const p=f.pending;f.pending=null;p.reject(Error(message));};
export function createRuntimeAdapter(){return{
 async prepare(){f.calls.push({kind:'prepare'});return{cached:false,modelId:'LABELED-UI-FIXTURE-NOT-A-MODEL',runtimeProfile:'memory64'};},
 async measure(messages){const plan=f.meterPlans.shift()??{promptTokens:300};const result={...plan,contextTokens:2048,overflow:plan.promptTokens>2048,actualNativeTokenization:false,meter:'chat-format-labeled-fixture'};f.calls.push({kind:'measure',messages:structuredClone(messages),result});return result;},
 async reply(messages,options={}){await options.beforeDispatch?.();await options.onDispatch?.();f.calls.push({kind:'reply',messages:structuredClone(messages)});return new Promise((resolve,reject)=>{if(f.pending)throw Error('Duplicate pending fixture reply');f.pending={resolve,reject,options};});},
 async dispose(){f.calls.push({kind:'dispose'});if(f.pending){const p=f.pending;f.pending=null;p.reject(new DOMException('Fixture disposed','AbortError'));}}
};}`;

async function identity() {
  const paths = execFileSync('rg', ['--files', 'examples/browser-model-chat', 'modules/browser-rag-ts/src/application'], { cwd: root, encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean).map(path => path.replaceAll('\\', '/')).sort();
  paths.push('tests/model-chat-format-browser.mjs', 'modules/browser-rag-ts/scripts/static-server.mjs');
  const files = await Promise.all(paths.map(async path => ({ path, sha256: digest(await readFile(join(root, path))) })));
  return { head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), files: files.length,
    fingerprint: digest(JSON.stringify(files)), relevant: files.filter(file => /(?:app|message-renderer|style|runtime-adapter|loader-controller|engine-worker|format-browser)\.(?:mjs|css)$/.test(file.path)) };
}
async function check(name, run) {
  const at = Date.now();
  try { await run(); checks.push({ name, status: 'pass', durationMs: Date.now() - at }); }
  catch (error) { checks.push({ name, status: 'fail', durationMs: Date.now() - at, message: error.message.slice(0, 1000) }); throw error; }
}
const assistant = () => page.locator('.message.assistant').last();
const user = () => page.locator('.message.user').last();
const content = () => assistant().locator('.content');
async function settle() { await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))); }
async function ready() {
  await page.waitForFunction(() => document.getElementById('app').dataset.phase === 'ready'
    && !document.querySelector('.message.pending') && !document.getElementById('send').disabled);
  await settle();
}
async function load() {
  await page.locator('#local-file').setInputFiles({ name: 'LABELED-UI-FIXTURE-NOT-A-MODEL.gguf', mimeType: 'application/octet-stream', buffer: Buffer.from('DETERMINISTIC UI FIXTURE ONLY') });
  await ready();
}
async function fresh() {
  if (page.url().startsWith(base.origin)) await page.evaluate(() => localStorage.clear());
  await page.goto(new URL('?memory=1&graph=0', base).href);
  await page.waitForFunction(() => window.localMemoryPreview?.workspace && window.__formatFixture);
  await load();
}
async function begin(text) {
  await page.locator('#prompt').fill(text); await page.locator('#send').click();
  await page.waitForFunction(() => Boolean(window.__formatFixture.pending)); await settle();
}
async function token(text) { await page.evaluate(text => window.__formatFixture.token(text), text); await settle(); }
async function finish(text, completion = { finishReason: 'stop', maxTokens: 160 }) {
  await page.evaluate(({ text, completion }) => window.__formatFixture.finish(text, completion), { text, completion }); await ready();
}
async function exchange(question, answer, completion) { await begin(question); await token(answer); await finish(answer, completion); }
async function snapshot() {
  return page.evaluate(() => {
    const w = window.localMemoryPreview.workspace;
    return { conversation: w.conversation.snapshot(), calls: window.__formatFixture.calls,
      lastSubmitted: w.context.inspectionSnapshot().lastSubmitted,
      citations: w.conversation.snapshot().turns.filter(turn => turn.role === 'assistant').map(turn => ({ id: turn.id, sources: w.sourcesForAnswer(turn.id) })),
      controller: window.localMemoryPreview.app.controller.getState(),
      clipboard: { mode: window.__formatClipboard.mode, writes: [...window.__formatClipboard.writes], attempts: [...window.__formatClipboard.attempts] } };
  });
}
async function clipboardMode(mode) { await page.evaluate(mode => { window.__formatClipboard.mode = mode; }, mode); }
async function imagePixels(bytes) {
  return page.evaluate(async encoded => {
    const pixels = Uint8Array.from(atob(encoded), value => value.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([pixels], { type: 'image/png' }));
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(bitmap, 0, 0); bitmap.close();
    const hash = await crypto.subtle.digest('SHA-256', context.getImageData(0, 0, canvas.width, canvas.height).data);
    return { width: canvas.width, height: canvas.height, rgbaSha256: [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('') };
  }, bytes.toString('base64'));
}
async function capture() {
  const name = process.env.FORMAT_BROWSER_CAPTURE_NAME || (live ? 'chat-format-mobile-live.png' : 'chat-format-mobile.png');
  assert.match(name, /^[a-z0-9][a-z0-9-]{0,80}\.png$/, 'Capture name is one bounded PNG basename');
  await mkdir(output, { recursive: true });
  const bytes = await page.screenshot(), capturedSha256 = digest(bytes);
  if (live) {
    const originalPath = join(output, 'chat-format-mobile.png');
    let original;
    try { original = await readFile(originalPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (original) {
      const originalSha256 = digest(original);
      assert.equal(originalSha256, 'a8d55ccedecec64f10656c35521db83d32faafcd7ec51f1f8b7d364bf2d77613', 'Preserved candidate screenshot identity');
      const originalPixels = await imagePixels(original), livePixels = await imagePixels(bytes);
      if (originalPixels.rgbaSha256 === livePixels.rgbaSha256 && originalPixels.width === livePixels.width && originalPixels.height === livePixels.height) {
        screenshots.push({ path: '.artifacts/proof/chat-format/chat-format-mobile.png', bytes: original.length,
          sha256: originalSha256, width: 390, height: 844, labeledFixture: true, liveCaptured: true,
          reusedCandidatePixels: true, capturedBytes: bytes.length, capturedSha256, pixelIdentity: livePixels,
          baseUrl: approvedLiveUrl, approvedSourceHead });
        return;
      }
    }
  }
  try { await access(join(output, name)); throw Error('Refusing to overwrite an existing format proof capture: ' + name); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeFile(join(output, name), bytes, { flag: 'wx' });
  screenshots.push({ path: '.artifacts/proof/chat-format/' + name, bytes: bytes.length, sha256: capturedSha256, width: 390, height: 844,
    labeledFixture: true, ...(live ? { liveCaptured: true, reusedCandidatePixels: false, baseUrl: approvedLiveUrl, approvedSourceHead } : {}) });
}

async function expectedAsset(path) {
  if (approvedAssetBytes.has(path)) return approvedAssetBytes.get(path);
  let bytes;
  if (path === 'memory/rag-core.mjs') {
    bytes = await readFile(join(memoryRoot, 'rag-core.mjs'));
    assert.equal(digest(bytes), coreSha256, 'Exact approved generated core bytes');
  } else if (path === 'memory/graph-renderer.mjs') throw Error('The graph is disabled in this focused formatting proof');
  else {
    const source = path.startsWith('theme/') ? 'modules/browser-rag-ts/demo/' + path.slice(6) : 'examples/browser-model-chat/' + path;
    assert.match(source, /^[a-zA-Z0-9_./-]+$/, 'Ordinary source asset path');
    assert.ok(!source.split('/').some(part => part === '..' || part === '.'), 'No dot-segment source path');
    bytes = live ? execFileSync('git', ['show', approvedSourceHead + ':' + source], { cwd: root, maxBuffer: 4 * 1024 * 1024 })
      : await readFile(join(root, source));
  }
  approvedAssetBytes.set(path, bytes); return bytes;
}

async function proof() {
  await check('real bootstrap renders assistant subset while user-authored Markdown stays literal', async () => {
    await fresh();
    const question = '**User bold stays literal**\n- not a rendered list\n`user code`';
    const answer = 'A **bold** and *emphasized* paragraph with `inline code`.\n\n- first\n- second\n\n1. ordered\n2. next\n\n[safe reference](https://example.com/reference)';
    await exchange(question, answer);
    assert.equal(await user().locator('.content').textContent(), question);
    assert.equal(await user().locator('.content strong, .content em, .content li, .content code, .content a').count(), 0);
    assert.equal(await content().locator('strong').textContent(), 'bold');
    assert.equal(await content().locator('em').textContent(), 'emphasized');
    assert.equal(await content().locator('code').textContent(), 'inline code');
    assert.equal(await content().locator('ul li').count(), 2); assert.equal(await content().locator('ol li').count(), 2);
    assert.ok(await content().locator('p').count() >= 2);
    const state = await snapshot();
    assert.deepEqual(state.conversation.turns.map(turn => [turn.role, turn.content]), [['user', question], ['assistant', answer]]);
    assert.equal(await page.evaluate(() => window.localMemoryPreview.workspace.graph === undefined), true);
    observations.push({ case: 'subset-and-role-separation', rawQuestionSha256: digest(question), rawAnswerSha256: digest(answer), assistantSemanticElements: true, userLiteral: true });
  });

  await check('partial streamed fenced code and malformed markup remain stable and inert through completion', async () => {
    await fresh(); await begin('Show a basic code example.');
    const partial = 'Example:\n\n```js\nconst value = "<img src=x onerror=alert(1)>";';
    await token(partial);
    assert.equal(await content().locator('pre code').textContent(), 'const value = "<img src=x onerror=alert(1)>";');
    assert.equal(await content().locator('img, script').count(), 0);
    await token(partial + '\n```\n\nUnclosed **bold and [broken](https://example.com');
    assert.match(await content().textContent(), /Unclosed \*\*bold/);
    const final = partial + '\n```\n\nUnclosed **bold and [broken](https://example.com';
    await finish(final);
    assert.equal(await content().locator('pre code').count(), 1); assert.equal(await content().locator('a').count(), 0);
    assert.equal((await snapshot()).conversation.turns.at(-1).content, final);
    observations.push({ case: 'partial-fence-and-malformed', sourceSha256: digest(final), scriptOrImageElements: 0 });
  });

  await check('HTML and dangerous URL payloads stay inert while allowed HTTP links have safe attributes', async () => {
    await fresh();
    const attack = '<script>window.__formatAttack=1</script>\n<img src="https://example.com/pixel" onerror="window.__formatAttack=2">\n<svg onload="window.__formatAttack=3"></svg>\n\n[js](javascript:alert(1)) [mixed](JaVaScRiPt:alert(2)) [data](data:text/html,attack) [file](file:///secret) [relative](/private) [protocol](//example.com)\n\n[HTTPS](https://example.com/path?q=1&x=2) [HTTP](http://example.com/path)';
    await exchange('Render these quoted strings safely.', attack);
    assert.equal(await page.evaluate(() => window.__formatAttack), undefined);
    assert.equal(await content().locator('script, img, svg, iframe, object, embed, style').count(), 0);
    const links = await content().locator('a').evaluateAll(nodes => nodes.map(node => ({ href: node.getAttribute('href'), target: node.target, rel: node.rel })));
    assert.equal(links.length, 2);
    for (const link of links) {
      assert.match(link.href, /^https?:\/\//i); assert.equal(link.target, '_blank');
      assert.ok(link.rel.split(/\s+/).includes('noopener')); assert.ok(link.rel.split(/\s+/).includes('noreferrer'));
    }
    assert.match(await content().textContent(), /<script>/); assert.match(await content().textContent(), /\[js\]\(javascript:/);
    observations.push({ case: 'hostile-markup', sourceSha256: digest(attack), executableElements: 0, allowedLinks: links });
  });

  await check('active selection survives streamed and final paints then flushes the latest raw answer on release', async () => {
    await fresh(); await begin('Explain selection stability.');
    const first = 'First **bold** paragraph.'; await token(first);
    const initial = await content().textContent();
    const selected = await content().evaluate(node => {
      const text = node.querySelector('p')?.firstChild;
      if (!text || text.nodeType !== Node.TEXT_NODE) throw Error('Expected a real paragraph text node');
      const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, Math.min(5, text.length));
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); return selection.toString();
    });
    assert.equal(selected, 'First');
    await token(first + ' Streamed words.');
    assert.equal(await page.evaluate(() => getSelection().toString()), selected);
    assert.equal(await content().textContent(), initial);
    const final = first + ' Streamed words. Final **addition**.'; await finish(final);
    assert.equal(await page.evaluate(() => getSelection().toString()), selected);
    assert.equal(await content().textContent(), initial);
    assert.equal((await snapshot()).conversation.turns.at(-1).content, final);
    await page.evaluate(() => getSelection().removeAllRanges());
    await page.waitForFunction(() => document.querySelector('.message.assistant:last-child .content')?.textContent.includes('Final addition.'));
    assert.equal(await content().locator('strong').count(), 2);
    observations.push({ case: 'selection-and-final-flush', selectedText: selected, latestRawSha256: digest(final), selectionKeptUntilRelease: true });
  });

  await check('keyboard Copy returns exact original assistant and user text without citation or status text', async () => {
    await fresh();
    const question = '**Raw user**\n`literal`';
    const answer = '**Original**\n\n```text\n<raw>& exact\n```\n\n[safe](https://example.com)';
    await exchange(question, answer);
    for (const [node, expected, label] of [[assistant(), answer, 'Copy model reply'], [user(), question, 'Copy your message']]) {
      const button = node.locator('.copy-message'); assert.equal(await button.getAttribute('aria-label'), label);
      await button.focus(); await page.keyboard.press('Enter');
      await node.locator('.message-copy-status').filter({ hasText: 'Message copied.' }).waitFor();
      assert.equal((await snapshot()).clipboard.writes.at(-1), expected);
      assert.equal(await node.locator('.message-copy-status').getAttribute('role'), 'status');
      assert.equal(await node.locator('.message-copy-status').getAttribute('aria-live'), 'polite');
      assert.equal(await node.locator('.message-copy-fallback').isVisible(), false);
    }
    observations.push({ case: 'exact-copy', writes: 2, assistantRawSha256: digest(answer), userRawSha256: digest(question), osClipboardTouched: false });
  });

  await check('clipboard refusal has keyboard recovery; streaming and teardown cannot race a pending Copy', async () => {
    const raw = (await snapshot()).conversation.turns.at(-1).content;
    for (const mode of ['reject', 'unavailable']) {
      await clipboardMode(mode); await assistant().locator('.copy-message').focus(); await page.keyboard.press('Enter');
      const fallback = assistant().locator('.message-copy-fallback'), field = fallback.locator('textarea');
      await fallback.waitFor({ state: 'visible' }); assert.equal(await field.inputValue(), raw);
      const state = await field.evaluate(node => ({ active: document.activeElement === node, readonly: node.readOnly,
        from: node.selectionStart, to: node.selectionEnd, label: node.getAttribute('aria-label') }));
      assert.deepEqual(state, { active: true, readonly: true, from: 0, to: raw.length, label: 'Original message text to copy' });
      assert.match(await assistant().locator('.message-copy-status').textContent(), /Clipboard unavailable.*original text/);
      await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
      assert.equal(await fallback.isVisible(), false);
      assert.equal(await assistant().locator('.copy-message').evaluate(node => document.activeElement === node), true);
    }
    await clipboardMode('success');
    await fresh(); await begin('Exercise a delayed clipboard promise while streaming.');
    const first = 'Initial **streamed** text.'; await token(first); await clipboardMode('pending');
    await assistant().locator('.copy-message').click();
    await page.waitForFunction(() => window.__formatClipboard.pending.length === 1);
    assert.equal(await assistant().locator('.copy-message').isDisabled(), true);
    await token(first + ' A new streamed token.');
    assert.equal(await assistant().locator('.copy-message').isDisabled(), true, 'Streaming cannot re-enable an active Copy');
    await assistant().locator('.copy-message').dispatchEvent('click');
    assert.equal((await snapshot()).clipboard.attempts.length, 1, 'Even a duplicate synthetic click cannot start a second clipboard write');
    await page.evaluate(() => window.__formatClipboard.release('reject'));
    await assistant().locator('.message-copy-fallback').waitFor({ state: 'visible' });
    assert.equal(await assistant().locator('.message-copy-fallback textarea').inputValue(), first, 'Fallback preserves the exact text captured by that click');
    await assistant().locator('.message-copy-fallback button').click();
    const final = first + ' A new streamed token. Completed.'; await finish(final);
    await assistant().locator('.copy-message').click();
    await page.waitForFunction(() => window.__formatClipboard.pending.length === 1);
    const teardown = await page.evaluate(() => {
      const node = [...document.querySelectorAll('.message.assistant')].at(-1);
      const status = node.querySelector('.message-copy-status'), fallback = node.querySelector('.message-copy-fallback');
      const focus = document.createElement('button'); focus.id = 'fixture-after-pagehide-focus'; focus.textContent = 'UI fixture teardown focus'; document.body.append(focus);
      window.dispatchEvent(new PageTransitionEvent('pagehide')); focus.focus();
      const before = { status: status.textContent, hidden: fallback.hidden };
      window.__formatClipboard.release('reject'); return before;
    });
    await settle();
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'fixture-after-pagehide-focus');
    assert.equal(await assistant().locator('.message-copy-fallback').evaluate(node => node.hidden), teardown.hidden);
    assert.equal(await assistant().locator('.message-copy-status').textContent(), teardown.status);
    observations.push({ case: 'clipboard-recovery', modes: ['reject', 'unavailable'], manualRawSelection: true, closeRestoresCopyFocus: true });
    observations.push({ case: 'clipboard-race', streamingRetainsInFlightDisable: true, duplicateEventWrites: 1,
      fallbackUsesClickTimeRawText: true, rejectedAfterPagehideCannotRevealFallbackOrChangeStatusOrFocus: true });
  });

  await check('390 by 844 viewport contains long code and exposes keyboard horizontal scrolling', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await fresh();
    const answer = 'A long code example stays inside its own scroll area.\n\n```text\n' + 'column_0123456789_'.repeat(35) + '\n```\n\n- Copy retains the original formatting.\n- This is a labeled UI fixture.';
    await exchange('Show a wide code line.', answer);
    const pre = content().locator('pre');
    const dimensions = await pre.evaluate(node => {
      const bounds = node.getBoundingClientRect(); return { clientWidth: node.clientWidth, scrollWidth: node.scrollWidth,
        viewport: innerWidth, right: bounds.right, tabIndex: node.tabIndex, overflow: getComputedStyle(node).overflowX,
        documentWidth: document.documentElement.scrollWidth, documentClientWidth: document.documentElement.clientWidth };
    });
    assert.ok(dimensions.scrollWidth > dimensions.clientWidth); assert.ok(dimensions.right <= 391);
    assert.ok(dimensions.documentWidth <= dimensions.documentClientWidth + 1); assert.ok(dimensions.tabIndex >= 0);
    assert.match(dimensions.overflow, /auto|scroll/);
    await pre.focus(); await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('.message.assistant:last-child pre')?.scrollLeft > 0);
    const scrollLeft = await pre.evaluate(node => node.scrollLeft); assert.ok(scrollLeft > 0);
    await capture(); observations.push({ case: 'narrow-code', ...dimensions, keyboardScrollLeft: scrollLeft, physicalDevice: false });
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  await check('canonical raw request history and exact saved messages survive formatted display and reload', async () => {
    await fresh();
    const question = 'Keep **this raw question** and `its syntax`.';
    const answer = 'Stored **raw answer**.\n\n- alpha\n- beta\n\n```js\nconst x = "<safe>";\n```';
    await exchange(question, answer); await exchange('Continue using the original text.', 'Second **reply**.');
    const before = await snapshot(), dispatch = before.calls.findLast(call => call.kind === 'reply');
    assert.deepEqual(dispatch.messages.filter(message => message.role !== 'system'), [
      { role: 'user', content: question }, { role: 'assistant', content: answer }, { role: 'user', content: 'Continue using the original text.' }]);
    assert.deepEqual(before.lastSubmitted.exactMessages, dispatch.messages);
    assert.equal(before.lastSubmitted.requestSha256, digest(JSON.stringify(dispatch.messages)));
    await page.reload(); await page.waitForFunction(() => window.localMemoryPreview?.workspace); await load();
    const after = await snapshot(); assert.deepEqual(after.conversation, before.conversation);
    assert.equal(await page.locator('.message.assistant').first().locator('.content strong').textContent(), 'raw answer');
    await page.locator('.message.assistant').first().locator('.copy-message').click();
    assert.equal((await snapshot()).clipboard.writes.at(-1), answer);
    observations.push({ case: 'raw-history-reload', turnCount: after.conversation.turns.length,
      requestSha256: before.lastSubmitted.requestSha256, conversationSha256: digest(JSON.stringify(before.conversation)), reloadCalls: after.calls.map(call => call.kind) });
  });

  await check('real compaction source annotations remain distinct from Markdown links and survive reload', async () => {
    await fresh();
    for (const fact of ['Fact[harbor]: The harbor access code is CEDAR-731.', 'Constraint[access]: Harbor access is allowed only after sunrise.',
      'Fact[room]: The review room is Copper.', 'Correction[harbor]: The harbor access code is MAPLE-946.']) await exchange(fact, 'Fixture **acknowledgement**.');
    await page.evaluate(() => window.__formatFixture.meterPlans.push({ promptTokens: 2300 }, { promptTokens: 300 }));
    const answer = '**Harbor answer** with a [separate link](https://example.com).';
    await exchange('What are the harbor access code, access constraint, and review room?', answer);
    const before = await snapshot(), last = before.conversation.turns.at(-1), sources = before.citations.at(-1).sources;
    assert.equal(sources.length, 3); assert.ok(sources.every(source => source.kind === 'structured'));
    for (const source of sources) assert.equal(source.turnHash, digest(before.conversation.turns.find(turn => turn.id === source.turnId).content));
    const readFooter = () => page.locator('#turn-' + last.id + ' .memory-sources a').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, href: node.getAttribute('href') })));
    const footer = await readFooter(); assert.deepEqual(footer.map(link => link.href), sources.map(source => '#turn-' + source.turnId));
    assert.equal(await content().locator('a').count(), 1); assert.equal(await assistant().locator('.memory-sources a').count(), 3);
    await assistant().locator('.copy-message').click(); assert.equal((await snapshot()).clipboard.writes.at(-1), answer);
    await page.reload(); await page.waitForFunction(() => window.localMemoryPreview?.workspace); await load();
    assert.deepEqual((await snapshot()).citations, before.citations); assert.deepEqual(await readFooter(), footer);
    const sourceLink = page.locator('#turn-' + last.id + ' .memory-sources a').first();
    const target = (await sourceLink.getAttribute('href')).slice(1); await sourceLink.click();
    assert.equal(await page.locator('#' + target).evaluate(node => document.activeElement === node), true);
    observations.push({ case: 'citation-boundary', sources: sources.map(source => ({ kind: source.kind, turnId: source.turnId, turnHash: source.turnHash })),
      rawReplySha256: digest(answer), separateMarkdownLinks: 1, historicalCitationLinks: 3, reloadExact: true, sourceKeyboardTargetFocused: true });
  });

  await check('only trusted 160-token length completion shows a limit notice; stop and unknown stay distinct', async () => {
    await fresh();
    for (const [label, completion, expected] of [
      ['length', { finishReason: 'length', maxTokens: 160 }, 'length'],
      ['stop', { finishReason: 'stop', maxTokens: 160 }, 'stop'],
      ['untrusted', { finishReason: 'length', maxTokens: 42 }, 'unknown'],
      ['absent', null, 'unknown']]) {
      await begin('Completion case ' + label + '.'); const answer = '**Reply** for ' + label + '.'; await token(answer);
      await finish(answer, completion);
      assert.equal(await assistant().getAttribute('data-finish-reason'), expected);
      const notice = assistant().locator('.message-completion');
      if (expected === 'length') { assert.equal(await notice.isVisible(), true); assert.match(await notice.textContent(), /160-token limit.*ask for more/); }
      else assert.equal(await notice.isVisible(), false);
      await assistant().locator('.copy-message').click(); assert.equal((await snapshot()).clipboard.writes.at(-1), answer);
    }
    observations.push({ case: 'completion', lengthNotice: true, noInventedStopOrUnknownTruncation: true, tokenLimitUnchanged: 160 });
  });

  await check('partial failure is visible but never admitted to canonical history or a later model request', async () => {
    await fresh(); await begin('A request that will fail.');
    const partial = 'Partial **unaccepted answer**.'; await token(partial);
    await page.evaluate(() => window.__formatFixture.fail('Controlled deterministic UI fixture reply failure.'));
    await page.waitForFunction(() => !document.querySelector('.message.pending') && document.getElementById('app').dataset.phase === 'error');
    assert.equal(await assistant().evaluate(node => node.classList.contains('interrupted')), true);
    assert.equal(await content().textContent(), 'Partial unaccepted answer.');
    let current = await snapshot(); assert.deepEqual(current.conversation.turns.map(turn => turn.role), ['user']);
    assert.equal(current.conversation.turns.some(turn => turn.content === partial), false);
    assert.equal(await assistant().locator('.message-completion').isVisible(), false);
    await load(); await exchange('Continue after the controlled error.', 'A completed **replacement** reply.');
    current = await snapshot(); const dispatch = current.calls.findLast(call => call.kind === 'reply');
    assert.equal(dispatch.messages.some(message => message.content === partial), false);
    await page.reload(); await page.waitForFunction(() => window.localMemoryPreview?.workspace); await load();
    assert.equal(await page.locator('.message.interrupted').count(), 0);
    assert.equal((await snapshot()).conversation.turns.some(turn => turn.content === partial), false);
    observations.push({ case: 'partial-failure', partialSha256: digest(partial), visibleAttemptKeptUntilReload: true,
      admittedAssistantTurnsFromFailedAttempt: 0, partialInNextRequest: false, partialRestoredAsCanonical: false });
  });

  await check('source identities, served production bytes and finite no-model boundaries remain intact', async () => {
    sourceAfter = await identity(); assert.deepEqual(sourceAfter, sourceBefore);
    assert.deepEqual(forbidden, []); assert.deepEqual(pageErrors, []); assert.equal(workers, 0);
    assert.equal(await page.evaluate(() => window.__formatWorkerAttempts), 0);
    assert.ok(assets.some(asset => asset.path === 'app.mjs')); assert.ok(assets.some(asset => asset.path === 'message-renderer.mjs'));
    assert.ok(assets.some(asset => asset.path === 'memory/rag-core.mjs'));
    assert.equal(assets.some(asset => asset.path === 'memory/graph-renderer.mjs'), false);
    assert.ok(Date.now() - started < 60_000);
  });
}

try {
  if (live) assert.equal(liveUrl, approvedLiveUrl, 'Live mode is restricted to the exact approved HTTPS deployment directory');
  assert.equal(digest(await readFile(join(memoryRoot, 'rag-core.mjs'))), coreSha256, 'Existing exact core bundle required; this harness never builds');
  const pw = process.env.BROWSER_MODEL_PLAYWRIGHT_MODULE;
  assert.ok(pw, 'Set BROWSER_MODEL_PLAYWRIGHT_MODULE to an existing Playwright module; no install or private path fallback');
  const chrome = process.env.MODEL_CHAT_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe'; await access(chrome); await access(pw);
  const { chromium } = await import(pathToFileURL(resolve(pw)).href);
  sourceBefore = await identity();
  if (live) {
    assert.equal(execFileSync('git', ['rev-parse', approvedSourceHead + '^{commit}'], { cwd: root, encoding: 'utf8' }).trim(), approvedSourceHead);
    base = new URL(approvedLiveUrl);
  } else {
    server = await startServer({ port: 0, root: join(root, 'examples/browser-model-chat'), runtimeRoot, memoryCoreRoot: memoryRoot, memoryGraphRoot: memoryRoot });
    cleanup.localServerStarted = true; base = new URL(server.url);
  }
  profile = await mkdtemp(join(await realpath(tmpdir()), profilePrefix));
  context = await chromium.launchPersistentContext(profile, { executablePath: chrome, headless: true,
    viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', args: ['--no-first-run', '--disable-background-networking', '--disable-component-update'] });
  browserVersion = context.browser()?.version() || 'persistent-context';
  await context.addInitScript(() => {
    window.__formatWorkerAttempts = 0;
    window.Worker = class { constructor() { window.__formatWorkerAttempts++; throw Error('Workers forbidden by labeled UI fixture'); } };
    window.SharedWorker = class { constructor() { window.__formatWorkerAttempts++; throw Error('SharedWorkers forbidden by labeled UI fixture'); } };
    const clipboard = window.__formatClipboard = { mode: 'success', writes: [], attempts: [], pending: [] };
    clipboard.release = result => {
      const pending = clipboard.pending.shift(); if (!pending) throw Error('No pending fixture clipboard promise');
      if (result === 'reject') pending.reject(Error('Delayed controlled fixture clipboard refusal'));
      else { clipboard.writes.push(pending.text); pending.resolve(); }
    };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, get: () => clipboard.mode === 'unavailable' ? undefined : {
      writeText: async text => {
        clipboard.attempts.push(text);
        if (clipboard.mode === 'reject') throw Error('Controlled fixture clipboard refusal');
        if (clipboard.mode === 'pending') return new Promise((resolve, reject) => clipboard.pending.push({ text, resolve, reject }));
        clipboard.writes.push(text);
      },
    } });
    document.addEventListener('DOMContentLoaded', () => {
      const label = document.createElement('span'); label.id = 'chat-format-fixture-label';
      label.textContent = 'UI FIXTURE - no model or native tokenizer';
      label.style.cssText = 'position:fixed;bottom:1px;left:8px;z-index:9;font:8px/10px ui-monospace,monospace;color:#ffedc8;pointer-events:none;background:#151410';
      document.body.append(label);
    }, { once: true });
  });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    const withinBase = url.origin === base.origin && url.pathname.startsWith(base.pathname);
    const path = withinBase ? url.pathname.slice(base.pathname.length) || 'index.html' : url.pathname;
    assert.ok(++requests <= 500, 'Finite 500-request budget');
    if (!withinBase || /^(?:runtime\/|engine-worker\.mjs$)|\.(?:wasm|gguf)$/i.test(path) || route.request().resourceType() === 'worker') {
      forbidden.push(path); return route.abort();
    }
    if (path === 'runtime-adapter.mjs') return route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: adapter });
    try {
      const response = await route.fetch({ maxRedirects: 0 }); assert.equal(response.status(), 200, path);
      const responseUrl = new URL(response.url()); assert.equal(responseUrl.origin, base.origin); assert.ok(responseUrl.pathname.startsWith(base.pathname));
      const bytes = await response.body(); assetBytes += bytes.length; assert.ok(assetBytes < 32 * 1024 * 1024, 'Finite 32 MiB served-byte budget');
      if (/\.m?js$/.test(path)) assert.match(response.headers()['content-type'] || '', /^(?:application|text)\/javascript(?:;|$)/i, path + ' executable MIME');
      const hash = digest(bytes); assert.equal(hash, digest(await expectedAsset(path)), path + ' actual ' + (live ? 'approved published ' : '') + 'production bytes');
      assets.push({ path, sha256: hash, bytes: bytes.length, mime: response.headers()['content-type'] });
      return route.fulfill({ response });
    } catch (error) { pageErrors.push(error.message); return route.abort(); }
  });
  page = context.pages()[0] || await context.newPage(); page.setDefaultTimeout(4500); page.setDefaultNavigationTimeout(8000);
  page.on('pageerror', error => pageErrors.push(error.message)); page.on('worker', () => workers++);
  await Promise.race([proof(), new Promise((_, reject) => { deadline = setTimeout(() => reject(Error('Finite 60-second browser proof budget exceeded')), 60_000); })]);
} catch (error) { failure = error.stack || error.message; process.exitCode = 1; }
finally {
  clearTimeout(deadline);
  const failed = error => { failure ||= error.message; process.exitCode = 1; };
  if (context) await context.close().then(() => { cleanup.contextClosed = true; }, failed);
  if (server) await server.close().then(() => { cleanup.serverClosed = true; }, failed);
  if (profile) {
    const temp = await realpath(tmpdir()), absolute = resolve(profile);
    if (dirname(absolute) !== temp || !basename(absolute).startsWith(profilePrefix)) failed(Error('Owned Temp profile boundary check failed'));
    else await rm(absolute, { recursive: true, force: true }).then(() => { cleanup.ownedProfileRemoved = true; }, failed);
  }
  const uniqueAssets = [...new Map(assets.map(asset => [asset.path, asset])).values()].sort((a, b) => a.path.localeCompare(b.path));
  const result = { schema: 'chat-format-browser/v1', status: failure ? 'fail' : 'pass', harnessSha256, durationMs: Date.now() - started,
    mode: live ? 'approved-https-ui-fixture' : 'local-ui-fixture', ...(live ? { baseUrl: approvedLiveUrl, approvedSourceHead } : {}),
    browserVersion, sourceBefore, sourceAfter, coreSha256, fixtureAdapterSha256: digest(adapter), checks, observations, screenshots,
    assets: { requests, verified: assets.length, unique: uniqueAssets, bytes: assetBytes, identitySha256: digest(JSON.stringify(assets)) },
    boundary: { productionBootstrap: true, onlyAdapterReplaced: true, productionCanonicalStore: true, productionContextAndCitations: true,
      fixtureOnly: true, nativeModelCalls: 0, nativeTokenization: false, modelDownloads: 0, osClipboardTouched: false,
      externalRequests: 0, approvedDeploymentRequests: live ? requests : 0, workers, forbidden, pageErrors, physicalDevice: false, graphExecuted: false }, cleanup, error: failure };
  const bytes = JSON.stringify(result); assert.ok(Buffer.byteLength(bytes) <= 40 * 1024, 'Compact proof limit');
  if (process.env.FORMAT_BROWSER_STDOUT === '1') console.log('FORMAT_BROWSER_PROOF_JSON ' + bytes);
  else {
    const proofName = live ? 'live-browser-result.tmp' : 'browser-result.tmp';
    await mkdir(output, { recursive: true }); await writeFile(join(output, proofName), bytes);
    console.log(`Chat format browser: ${result.status}; ${checks.filter(check => check.status === 'pass').length}/${checks.length} groups; ${result.durationMs} ms. Proof: .artifacts/proof/chat-format/${proofName}`);
  }
}
