#!/usr/bin/env node
// Real production bootstrap, stores, retrieval, prompt assembly and graph.
// Only runtime-adapter is a labeled deterministic fixture. This is NOT inference.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from '../examples/browser-model-chat/serve.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const prepared = resolve(process.env.BROWSER_MEMORY_PREPARED_ROOT || root);
const coreRoot = join(prepared, '.artifacts/memory');
const runtimeRoot = resolve(process.env.BROWSER_MODEL_RUNTIME_ROOT || join(root, '../rag-model-onboarding/.artifacts/model-chat/runtime'));
const output = join(root, '.artifacts/proof/conversation-repair');
const profilePrefix = 'rag-conversation-repair-fixture-';
const coreSha256 = 'c282ebb3965c4a25b48fb66082ce18c72184449f2123633a901ffceb9939ace6';
const graphSha256 = '6472ea58741464fff73401c640c094acb145adcbf732025329937e48f608c651';
const digest = value => createHash('sha256').update(value).digest('hex');
const pause = ms => new Promise(done => setTimeout(done, ms));
const checks = [], observations = [], screenshots = [], assets = [], forbidden = [], pageErrors = [], ports = [], barriers = [];
const cleanup = { contextClosed: false, serverClosed: false, ownedProfileRemoved: false };
let server, context, page, profile, base, error, sourceBefore, sourceAfter, browserVersion;
let requests = 0, assetBytes = 0, workers = 0;
const started = Date.now(), harnessSha256 = digest(await readFile(fileURLToPath(import.meta.url)));
const reported = [
  ['hello', 'hello! How can I assist you today?'],
  ["whats your name?", "I don't have a personal name..."],
  ['Your new name is Fred', 'Fred is a name that could be used for various purposes, such as a person, place, or concept...'],
  ['Just conversation is fine', 'No older user passage selected.'],
  ['what does that mean?', 'No evidence or context provided. Please provide the relevant information or context so I can assist you.'],
];
const adapter = `
const f=window.__repairFixture={label:'DETERMINISTIC UI FIXTURE - no model or native tokenizer',plans:[],replies:[],pending:[],calls:[],replyPause:false,disposePause:false};
const record=async value=>{f.calls.push(value);await window.__repairPort(value.kind);};
const wait=(kind,result)=>new Promise((resolve,reject)=>f.pending.push({kind,result,resolve,reject}));
f.release=(kind,error)=>{const index=f.pending.findIndex(item=>item.kind===kind);if(index<0)throw Error('No pending fixture '+kind);const item=f.pending.splice(index,1)[0];error?item.reject(Error(error)):item.resolve(item.result);};
export function createRuntimeAdapter(){return{
 async prepare(){await record({kind:'prepare'});return{cached:false,modelId:'LABELED-FIXTURE-NOT-MODEL',runtimeProfile:'memory64'};},
 async measure(messages){const plan=f.plans.shift();if(!plan)throw Error('Unplanned fixture meter call.');const result={promptTokens:plan.promptTokens,contextTokens:2048,overflow:plan.promptTokens>2048,actualNativeTokenization:false,meter:'conversation-repair-labeled-fixture'};await record({kind:'measure',messages:structuredClone(messages),result});if(plan.pause)return wait('measure',result);if(plan.error)throw Error(plan.error);return result;},
 async reply(messages,options={}){await options.beforeDispatch?.();await options.onDispatch?.();const result=f.replies.shift()??'Deterministic UI fixture acknowledgement; not a model answer.';await record({kind:'reply',messages:structuredClone(messages),result});if(f.replyPause)return wait('reply',result);return result;},
 async dispose(){await record({kind:'dispose'});if(f.disposePause)await wait('dispose');}
};}`;

async function check(name, run) {
  try { await run(); checks.push({ name, status: 'pass' }); console.log('PASS conversation repair: ' + name); }
  catch (cause) { checks.push({ name, status: 'fail', message: cause.message.slice(0, 800) }); throw cause; }
}
async function sourceIdentity() {
  const paths = execFileSync('rg', ['--files', 'examples/browser-model-chat', 'modules/browser-rag-ts/src/application'], { cwd: root, encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean).map(path => path.replaceAll('\\', '/')).sort();
  const files = await Promise.all(paths.map(async path => ({ path, sha256: digest(await readFile(join(root, path))) })));
  return { head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), files: files.length, fingerprint: digest(JSON.stringify(files)) };
}
async function settle() { await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))); }
async function ready() { await page.waitForFunction(() => document.getElementById('app').dataset.phase === 'ready' && !document.querySelector('.message.pending') && !document.getElementById('send').disabled); await settle(); }
async function loadFixture() {
  await page.locator('#local-file').setInputFiles({ name: 'LABELED-UI-FIXTURE-NOT-A-MODEL.gguf', mimeType: 'application/octet-stream', buffer: Buffer.from('DETERMINISTIC UI FIXTURE ONLY') });
  await ready();
}
async function fresh({ memory = true, loaded = true } = {}) {
  // This origin exists only inside our newly-created disposable profile.
  if (page.url().startsWith(base.origin)) await page.evaluate(() => localStorage.clear());
  await page.goto(new URL(memory ? '?memory=1' : '.', base).href);
  await page.waitForFunction(memory ? () => window.localMemoryPreview?.workspace && document.getElementById('memory-dialog') : () => window.__repairFixture);
  if (loaded) await loadFixture();
  await settle();
}
async function plans(...values) { await page.evaluate(values => window.__repairFixture.plans.push(...values), values); }
async function openMemory() {
  await page.locator('#memory-open').click();
  await page.waitForFunction(() => document.getElementById('memory-graph').dataset.renderer === 'tsl', null, { timeout: 25000 });
  await settle();
}
async function settings() { if (!await page.locator('#chat-options').evaluate(node => node.open)) await page.locator('#chat-options > summary').click(); }
async function beginClear() { await settings(); await page.locator('#clear').click(); await page.waitForFunction(() => document.getElementById('clear-confirmation').open); }
async function confirmClear() {
  await Promise.all([page.waitForEvent('domcontentloaded'), page.locator('#clear-confirm').click()]);
  await page.waitForFunction(() => window.localMemoryPreview?.workspace);
  await settle();
}
async function submit(text, response, { memory = true } = {}) {
  await page.evaluate(response => window.__repairFixture.replies.push(response), response);
  if (memory) await plans({ promptTokens: 300 });
  await page.locator('#prompt').fill(text); await page.locator('#send').click(); await ready();
}
async function state() {
  return page.evaluate(() => {
    const w = window.localMemoryPreview.workspace;
    return { conversation: w.conversation.snapshot(), memory: w.memory.snapshot(), persona: w.automaticMemory.exportPersona(),
      global: w.automaticMemory.exportGlobal(), nodes: w.automaticMemory.snapshot().nodes, scope: w.automaticMemory.getScope(),
      summary: w.context.summarySnapshot(), context: w.context.snapshot(), usage: w.context.usageSnapshot(),
      events: w.events.list(), inspection: w.context.inspectionSnapshot(), readiness: w.context.manualCompactionStatus(),
      calls: window.__repairFixture.calls, compactNote: document.getElementById('memory-compact-status').textContent,
      mainStatus: document.getElementById('memory-status').textContent, mainStatusError: document.getElementById('memory-status').classList.contains('memory-error'),
      mainStatusRole: document.getElementById('memory-status').getAttribute('role'), contextUnchanged: document.getElementById('context-usage').dataset.unchanged,
      contextState: document.getElementById('context-state').textContent, contextDetail: document.getElementById('context-detail').textContent,
      effectCount: document.querySelectorAll('.memory-summary-effects').length,
      stored: Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('private-'))) };
  });
}
async function clickCompact() {
  const box = await page.locator('#memory-compact-now').boundingBox(); assert.ok(box, 'Compact now is visibly reachable');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
async function waitCompact() { await page.waitForFunction(() => !window.localMemoryPreview.workspace.context.manualCompactionStatus().busy); await settle(); }
async function appendHistory(kind = 'delivery', count = 4) {
  await page.evaluate(async ({ kind, count, reported }) => {
    const w = window.localMemoryPreview.workspace;
    const exchanges = kind === 'fred' ? reported.slice(0, count) : Array.from({ length: count }, (_, index) => [
      'Friday delivery parcel ' + (index + 1) + ' has a collection label.', 'Generated fixture response ' + (index + 1) + '; never authored evidence.']);
    for (const [content, answer] of exchanges) { w.conversation.append({ role: 'user', content }); w.conversation.append({ role: 'assistant', content: answer }); }
    await w.persist();
  }, { kind, count, reported });
}
async function observeEffects() {
  await page.evaluate(() => {
    window.__repairEffects = [];
    new MutationObserver(records => { for (const record of records) for (const added of record.addedNodes) {
      if (!(added instanceof Element)) continue;
      for (const node of [added, ...added.querySelectorAll('.memory-summary-effects')]) if (node.matches('.memory-summary-effects')) {
        window.__repairEffects.push({ eventId: node.dataset.eventId, targetNodeId: node.dataset.targetNodeId, reducedMotion: node.dataset.reducedMotion,
          particles: [...node.querySelectorAll('.memory-summary-particle')].map(item => ({ source: item.dataset.sourceNodeId, target: item.dataset.targetNodeId })) });
      }
    } }).observe(document, { childList: true, subtree: true });
  });
}
async function commitPocket() {
  await fresh(); await appendHistory(); await openMemory(); await plans({ promptTokens: 1100 }, { promptTokens: 400 });
  await clickCompact(); await page.waitForFunction(() => window.localMemoryPreview.workspace.context.summarySnapshot()); await waitCompact();
  return state();
}
async function capture(name) {
  assert.ok(['settings.png', 'narrow-reason.png'].includes(name));
  await mkdir(output, { recursive: true }); await page.screenshot({ path: join(output, name) });
  const bytes = await readFile(join(output, name));
  screenshots.push({ path: '.artifacts/proof/conversation-repair/' + name, bytes: bytes.length, sha256: digest(bytes), labeledFixture: true });
}
async function seedSentinels() {
  await page.evaluate(async () => {
    localStorage.setItem('unrelated-origin-fixture', 'preserve-unrelated-data');
    localStorage.setItem('downloaded-model-cache-fixture', 'not-a-model-preserve-cache');
    const cache = await caches.open('conversation-repair-owned-cache-fixture');
    await cache.put('/owned-model-cache-sentinel', new Response('not-a-model-cache-sentinel'));
    const root = await navigator.storage.getDirectory();
    const file = await root.getFileHandle('conversation-repair-owned-model-cache-sentinel', { create: true });
    const writer = await file.createWritable(); await writer.write('not-a-model-OPFS-cache-sentinel'); await writer.close();
  });
}
async function assertSentinels() {
  const value = await page.evaluate(async () => {
    const cache = await caches.open('conversation-repair-owned-cache-fixture');
    const root = await navigator.storage.getDirectory();
    const file = await root.getFileHandle('conversation-repair-owned-model-cache-sentinel');
    return { unrelated: localStorage.getItem('unrelated-origin-fixture'), model: localStorage.getItem('downloaded-model-cache-fixture'),
      cache: await (await cache.match('/owned-model-cache-sentinel')).text(), opfs: await (await file.getFile()).text() };
  });
  assert.deepEqual(value, { unrelated: 'preserve-unrelated-data', model: 'not-a-model-preserve-cache', cache: 'not-a-model-cache-sentinel', opfs: 'not-a-model-OPFS-cache-sentinel' });
}
async function assertFreshBaseline(forbiddenText) {
  let current = await state();
  assert.deepEqual(current.conversation.turns, []); assert.deepEqual(current.memory.records, []); assert.equal(current.summary, null);
  assert.equal(current.context.cutoff, 0); assert.equal(current.context.cycle, 0); assert.equal(current.events.length, 0);
  assert.equal(current.scope, 'all'); assert.equal(current.nodes.length, 3); assert.ok(current.nodes.every(node => node.scope === 'global'));
  assert.equal(current.nodes.some(node => /Fred|Friday delivery|private sentinel/i.test(node.text)), false);
  assert.equal(current.usage.phase, 'unmeasured'); assert.equal(current.inspection.lastSubmitted, null);
  assert.deepEqual(current.calls, []); assert.equal(current.effectCount, 0);
  await assertSentinels(); await openMemory();
  assert.equal(await page.locator('[data-memory-kind="summary"]').count(), 0);
  assert.equal(await page.locator('[data-memory-scope="conversation"]').count(), 0);
  assert.equal(await page.locator('[data-memory-scope="persona"]').count(), 0);
  assert.equal(await page.locator('.memory-summary-effects').count(), 0);
  assert.equal(await page.locator('.memory-compaction-cue').isVisible(), false);
  await page.locator('#memory-close').click(); await loadFixture();
  await submit('What remains after starting fresh?', 'Fresh baseline UI fixture reply.'); current = await state();
  const lastReply = current.calls.findLast(call => call.kind === 'reply');
  assert.ok(lastReply); assert.doesNotMatch(JSON.stringify(lastReply.messages), forbiddenText);
  assert.deepEqual(lastReply.messages.filter(message => message.role !== 'system'), [{ role: 'user', content: 'What remains after starting fresh?' }]);
}

async function proof() {
  await check('exact reported Fred conversation preserves raw role ordering with memory off, on and All to Conversation', async () => {
    const runs = [];
    for (const mode of ['off', 'on', 'scope-switch']) {
      const memory = mode !== 'off'; await fresh({ memory }); const dispatches = [];
      for (const [index, [question, answer]] of reported.entries()) {
        if (mode === 'scope-switch' && index === 3) {
          await openMemory(); await page.locator('#memory-pocket').selectOption('conversation');
          await page.waitForFunction(() => window.localMemoryPreview.workspace.automaticMemory.getScope() === 'conversation');
          await page.locator('#memory-close').click();
        }
        await submit(question, answer, { memory });
        const calls = await page.evaluate(() => window.__repairFixture.calls), latest = calls.findLast(call => call.kind === 'reply');
        const expected = reported.slice(0, index).flatMap(([content, reply]) => [{ role: 'user', content }, { role: 'assistant', content: reply }]);
        expected.push({ role: 'user', content: question });
        assert.deepEqual(latest.messages.filter(message => message.role !== 'system'), expected);
        assert.equal(latest.messages.at(-1).content, question);
        const systems = latest.messages.filter(message => message.role === 'system');
        assert.equal(systems.length, 1);
        assert.doesNotMatch(systems[0].content, /No older user passage selected|No saved evidence matched|If the answer is absent|No evidence or context provided/);
        if (memory) {
          assert.match(systems[0].content, /Continue the conversation/);
          const current = await state();
          assert.equal(current.context.cutoff, 0); assert.equal(current.summary, null);
          assert.deepEqual(current.inspection.lastSubmitted.exactMessages, latest.messages);
          assert.equal(current.inspection.lastSubmitted.requestSha256, digest(JSON.stringify(latest.messages)));
          assert.equal(await page.locator('#messages .memory-sources').count(), 0, 'Direct recent turns are not duplicated as retrieved citations');
        }
        const shown = await page.locator('.message.assistant .content').last().textContent();
        const transcript = await page.locator('#messages').textContent(); assert.ok(transcript.includes(answer));
        if (shown !== null) assert.equal(shown, answer);
        dispatches.push({ raw: expected, requestSha256: digest(JSON.stringify(latest.messages)) });
      }
      runs.push({ mode, dispatches });
    }
    assert.deepEqual(runs[0].dispatches.map(item => item.raw), runs[1].dispatches.map(item => item.raw));
    assert.deepEqual(runs[1].dispatches.map(item => item.raw), runs[2].dispatches.map(item => item.raw));
    observations.push({ exactReportedConversation: { modes: runs.map(item => item.mode), exchangesPerMode: 5,
      rawRolesAndLatestQuestionPreserved: true, noDiagnosticSystemPlaceholders: true, noDuplicateRecentSourceCitations: true,
      runtimeReturnedReportedOddPhraseShownExactly: true, answersAreFixtureNotInference: true,
      requestSha256: runs.map(item => ({ mode: item.mode, values: item.dispatches.map(value => value.requestSha256) })) } });
  });

  await check('short manual no-source and measured no-reduction have explicit neutral reasons; genuine meter error stays distinct', async () => {
    await fresh(); await openMemory();
    assert.equal((await state()).readiness.reason, 'empty'); await clickCompact();
    assert.match((await state()).mainStatus, /older|recent|nothing/i);
    assert.deepEqual((await state()).calls.map(call => call.kind), ['prepare']);
    await page.locator('#memory-close').click(); await appendHistory('fred', 3); await openMemory();
    const before = await state(); await plans({ promptTokens: 300 }); await clickCompact();
    await page.waitForFunction(() => /Nothing changed/.test(document.getElementById('memory-compact-status').textContent)); await waitCompact();
    let current = await state();
    assert.match(current.compactNote, /No new older user excerpt.*Recent messages and originals/);
    assert.equal(current.mainStatusError, false); assert.equal(current.mainStatusRole, 'status'); assert.equal(current.contextState, 'Context unchanged');
    assert.equal(current.contextUnchanged, 'true');
    assert.match(current.contextDetail, /Check completed without changing context/); assert.equal(current.summary, null);
    assert.deepEqual(current.conversation, before.conversation); assert.equal(current.events.some(event => event.type === 'compacted'), false);
    assert.equal(current.calls.filter(call => call.kind === 'measure').length, 1); assert.equal(current.effectCount, 0);
    await page.setViewportSize({ width: 390, height: 844 }); await settle(); await capture('narrow-reason.png');
    observations.push({ shortNoSource: { status: current.contextState, message: current.compactNote, oneBeforeMeasurement: true, originalsKept: true, noSuccessEffects: true } });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await fresh(); await appendHistory('fred', 5); await openMemory();
    const reportedOriginal = (await state()).conversation;
    await plans({ promptTokens: 300 }, { promptTokens: 300 }); await clickCompact();
    await page.waitForFunction(() => /Nothing changed/.test(document.getElementById('memory-compact-status').textContent)); await waitCompact(); current = await state();
    assert.equal(current.contextState, 'Context unchanged'); assert.equal(current.contextUnchanged, 'true'); assert.equal(current.mainStatusRole, 'status');
    assert.equal(current.summary, null); assert.equal(current.effectCount, 0); assert.deepEqual(current.conversation, reportedOriginal);
    assert.equal(current.events.some(event => event.type === 'compacted'), false);
    assert.ok(['MANUAL_COMPACTION_NO_SOURCE_CONTEXT', 'MANUAL_COMPACTION_NO_REDUCTION'].includes(current.usage.errorCode));
    observations.push({ reportedFiveExchangeManual: { reason: current.usage.errorCode, message: current.compactNote,
      measurements: current.calls.filter(call => call.kind === 'measure').length, originalsKept: true, noInventedSummaryOrSuccessEffects: true } });
    await fresh(); await appendHistory(); await openMemory(); await plans({ promptTokens: 400 }, { promptTokens: 425 }); await clickCompact();
    await page.waitForFunction(() => /Nothing changed/.test(document.getElementById('memory-compact-status').textContent)); await waitCompact(); current = await state();
    assert.match(current.compactNote, /425 prompt tokens versus 400/); assert.equal(current.contextState, 'Context unchanged');
    assert.equal(current.mainStatusError, false); assert.equal(current.mainStatusRole, 'status'); assert.equal(current.contextUnchanged, 'true');
    assert.equal(current.summary, null); assert.equal(current.context.cutoff, 0);
    observations.push({ measuredNoReduction: { status: current.contextState, before: 400, after: 425, message: current.compactNote, fixtureCountsOnly: true } });
    await fresh(); await appendHistory(); await openMemory(); await plans({ promptTokens: 400, error: 'LABELED fixture native-meter boundary failure' }); await clickCompact();
    await page.waitForFunction(() => /did not finish/.test(document.getElementById('memory-compact-status').textContent)); await waitCompact(); current = await state();
    assert.equal(current.contextState, 'Check failed'); assert.equal(current.mainStatusError, true); assert.equal(current.mainStatusRole, 'alert');
    assert.equal(current.contextUnchanged, 'false'); assert.equal(current.summary, null); assert.equal(current.effectCount, 0);
    observations.push({ actualFailure: { status: current.contextState, message: current.compactNote, errorStyle: true, noSuccessEffects: true } });
  });

  await check('genuine measured compaction keeps provenance and originals, prevents duplicate recall, and settles bounded source particles', async () => {
    await page.emulateMedia({ reducedMotion: 'no-preference' }); await fresh(); await appendHistory(); await openMemory(); await observeEffects();
    const original = (await state()).conversation; await plans({ promptTokens: 1100 }, { promptTokens: 400 }); await clickCompact();
    await page.waitForFunction(() => window.localMemoryPreview.workspace.context.summarySnapshot()); await waitCompact();
    const current = await state(), summary = current.summary;
    assert.equal(summary.summaryHash, digest(summary.text)); assert.deepEqual(current.conversation, original);
    assert.ok(summary.sourceTurnIds.length > 0); assert.equal(summary.scope, 'conversation'); assert.equal(summary.derived, true);
    for (const item of summary.items) {
      const turn = original.turns.find(turn => turn.id === item.turnId);
      assert.equal(turn.role, 'user'); assert.equal(item.quote, turn.content.slice(item.offsets.start, item.offsets.end)); assert.equal(item.turnHash, digest(turn.content));
    }
    await page.waitForFunction(() => window.__repairEffects.length === 1);
    const effects = await page.evaluate(() => window.__repairEffects); assert.equal(effects.length, 1);
    assert.equal(effects[0].targetNodeId, summary.id); assert.ok(effects[0].particles.length > 0 && effects[0].particles.length <= 24);
    assert.ok(effects[0].particles.every(item => item.target === summary.id && summary.sourceTurnIds.includes(item.source.replace(/^turn:/, ''))));
    await page.waitForFunction(() => !document.querySelector('.memory-summary-effects'), null, { timeout: 2500 });
    await pause(120); assert.equal((await page.evaluate(() => window.__repairEffects)).length, 1);
    await page.locator('#memory-close').click(); await submit('What is the Friday delivery parcel detail?', 'Fixture source-linked answer.');
    const dispatched = (await state()).calls.findLast(call => call.kind === 'reply');
    assert.equal(dispatched.messages.filter(message => message.role === 'system' && message.content === summary.text).length, 1);
    assert.ok(original.turns.slice(0, current.context.cutoff).every(turn => !dispatched.messages.some(message => message.role === turn.role && message.content === turn.content)));
    observations.push({ realCompaction: { summaryId: summary.id, summaryHash: summary.summaryHash, actualAuthoredSourceIds: summary.sourceTurnIds,
      fixtureBeforeTokens: 1100, fixtureAfterTokens: 400, canonicalOriginalsKept: true, sourceParticleCount: effects[0].particles.length,
      particlesSettled: true, oneSummaryInNextDispatch: true, noDuplicateOriginalPrefix: true, noPersonaPromotion: true } });
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  await check('Reset settings preserves memories, summary, model session and cache independently, including reload', async () => {
    await commitPocket(); await seedSentinels(); await page.locator('#memory-close').click();
    await openMemory(); await page.locator('#memory-pocket').selectOption('conversation');
    await page.waitForFunction(() => window.localMemoryPreview.workspace.automaticMemory.getScope() === 'conversation');
    await page.locator('#memory-close').click(); await settings(); await page.locator('#effects').uncheck();
    const before = await state(), portCount = ports.length;
    await page.locator('#reset-settings').click(); await page.waitForFunction(() => /Settings reset\./.test(document.getElementById('settings-status').textContent));
    let current = await state(); assert.equal(current.scope, 'all'); assert.equal(await page.locator('#effects').isChecked(), true);
    assert.deepEqual(current.conversation, before.conversation); assert.deepEqual(current.memory, before.memory); assert.equal(current.persona, before.persona);
    assert.equal(current.global, before.global);
    assert.equal(current.summary.summaryHash, before.summary.summaryHash); assert.equal(ports.length, portCount); assert.equal(await page.locator('#app').getAttribute('data-phase'), 'ready');
    await assertSentinels(); await capture('settings.png');
    await page.reload(); await page.waitForFunction(() => window.localMemoryPreview?.workspace); current = await state();
    assert.equal(current.scope, 'all'); assert.equal(await page.locator('#effects').isChecked(), true); assert.deepEqual(current.conversation, before.conversation);
    assert.equal(current.summary.summaryHash, before.summary.summaryHash); assert.equal(current.global, before.global); assert.deepEqual(current.calls, []); await assertSentinels();
    observations.push({ settingsReset: { restoresAmbientAndAllFilter: true, conversationSummaryAndMemoriesPreserved: true, runtimeUntouched: true,
      modelCacheAndUnrelatedDataPreserved: true, reloadProved: true } });
  });

  await check('Clear chat confirmation cancel preserves data; confirmed clear and reload restore only three public starter facts', async () => {
    await fresh(); await appendHistory(); await seedSentinels();
    await page.evaluate(async () => {
      const w = window.localMemoryPreview.workspace;
      const starter = w.automaticMemory.snapshot().nodes.find(node => node.scope === 'global');
      if (!starter) throw Error('Expected a real public starter fact before clear.');
      await w.automaticMemory.forget(starter);
      const turn = w.conversation.append({ role: 'user', content: 'private sentinel: Friday delivery parcel notes for clearing' });
      w.conversation.append({ role: 'assistant', content: 'Generated private sentinel acknowledgement.' });
      await w.memory.save({ text: turn.content, sourceTurnIds: [turn.id], scope: { actorId: w.ownerScope.actorId, conversationId: w.ownerScope.conversationId }, modelSafe: true });
      await w.automaticMemory.pinPersona({ turnId: turn.id, text: turn.content }); await w.persist();
    });
    await page.reload(); await page.waitForFunction(() => window.localMemoryPreview?.workspace); await loadFixture();
    // Saved/Persona changes conservatively require a real checked ordinary
    // request; only newly eligible history after that gate may be compacted.
    await submit('Friday delivery parcel refresh after explicitly remembering a source.', 'Fixture policy-refresh acknowledgement.');
    await appendHistory(); await openMemory(); assert.equal((await state()).readiness.reason, 'ready');
    await plans({ promptTokens: 1100 }, { promptTokens: 400 }); await clickCompact();
    await page.waitForFunction(() => window.localMemoryPreview.workspace.context.summarySnapshot()); await waitCompact();
    await page.locator('#memory-close').click();
    const before = await state(); assert.ok(before.summary); assert.equal(before.memory.records.length, 1);
    assert.equal(JSON.parse(before.persona).records.length, 1);
    await beginClear(); assert.match(await page.locator('#clear-description').textContent(), /three public Space starter facts.*Downloaded model files and unrelated site data stay/);
    await page.locator('#clear-cancel').click(); assert.equal(await page.locator('#clear-confirmation').evaluate(node => node.open), false);
    await page.waitForFunction(() => document.activeElement?.id === 'clear');
    assert.equal(await page.locator('#clear').isVisible(), true); assert.equal(await page.locator('#chat-options').evaluate(node => node.open), true);
    const cancelled = await state(); assert.deepEqual(cancelled.conversation, before.conversation); assert.deepEqual(cancelled.stored, before.stored);
    await beginClear(); await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.getElementById('clear-confirmation').open);
    await page.waitForFunction(() => document.activeElement?.id === 'clear'); assert.equal(await page.locator('#clear').isVisible(), true);
    await assertSentinels(); await beginClear(); await confirmClear(); await assertFreshBaseline(/Friday delivery|private sentinel|Generated fixture response/);
    await page.reload(); await page.waitForFunction(() => window.localMemoryPreview?.workspace); await assertSentinels();
    const reloaded = await state(); assert.equal(reloaded.conversation.turns.length, 2); assert.equal(reloaded.nodes.some(node => /private sentinel|Friday delivery/.test(node.text)), false);
    observations.push({ clearConfirmation: { cancelPreservesExactStoredData: true, cancelAndEscapeRestoreVisibleSettingsFocus: true,
      explicitConfirmReloaded: true, savedPersonaConversationAndSummaryCleared: true,
      onlyThreePublicStarterFactsAtFreshStart: true, previouslyRemovedPublicStarterRestored: true,
      noOldPromptOrGraphNodes: true, cacheStorageOpfsUnrelatedKeysPreserved: true, secondReloadProved: true } });
  });

  await check('clearing during a pending meter or reply rejects stale saves and cannot resurrect the old session', async () => {
    for (const kind of ['measure', 'reply']) {
      await fresh(); await appendHistory(); await seedSentinels();
      await page.evaluate(kind => { window.__repairFixture.disposePause = true; window.__repairFixture.replyPause = kind === 'reply'; }, kind);
      await plans({ promptTokens: 400, pause: kind === 'measure' });
      await page.locator('#prompt').fill('private pending request that must never return after clear'); await page.locator('#send').click();
      await page.waitForFunction(kind => window.__repairFixture.pending.some(item => item.kind === kind), kind);
      await beginClear(); await page.locator('#clear-confirm').click();
      await page.waitForFunction(() => window.__repairFixture.pending.some(item => item.kind === 'dispose'));
      const old = await page.evaluate(async kind => {
        const w = window.localMemoryPreview.workspace; window.__repairFixture.release(kind);
        const persisted = await w.persist(); let prepareRejected = false;
        try { await w.prepare(); } catch { prepareRejected = true; }
        return { persisted, prepareRejected, visibleMessages: document.querySelectorAll('#messages .message').length };
      }, kind);
      assert.equal(old.persisted.stale, true); assert.equal(old.prepareRejected, true); assert.equal(old.visibleMessages, 0);
      await Promise.all([page.waitForEvent('domcontentloaded'), page.evaluate(() => window.__repairFixture.release('dispose'))]);
      await page.waitForFunction(() => window.localMemoryPreview?.workspace); await assertFreshBaseline(/Friday delivery|private pending|Generated fixture response/);
      observations.push({ staleContinuation: { kind, lateResultReleasedBeforeReload: true, oldSaveRejected: true, oldPrepareRejected: true, noResurrectedTurnsOrGraphOrPrompt: true } });
    }
  });

  await check('a queued old save behind the actor lock cannot overwrite the confirmed reset marker', async () => {
    await fresh(); await appendHistory(); await seedSentinels();
    await page.evaluate(() => {
      const f = window.__repairFixture;
      f.locked = false;
      void navigator.locks.request('rag-local-memory:local-user', () => new Promise(resolve => { f.releaseLock = resolve; f.locked = true; }));
    });
    await page.waitForFunction(() => window.__repairFixture.locked);
    await page.evaluate(() => {
      const w = window.localMemoryPreview.workspace;
      void w.persist().then(result => window.__repairBarrier({ name: 'queued-old-save', stale: result.stale, durable: result.durable }));
    });
    await beginClear(); await page.locator('#clear-confirm').click();
    await Promise.all([page.waitForEvent('domcontentloaded'), page.evaluate(() => window.__repairFixture.releaseLock())]);
    await page.waitForFunction(() => window.localMemoryPreview?.workspace);
    assert.ok(barriers.some(item => item.name === 'queued-old-save' && item.stale === true && item.durable === false));
    await assertFreshBaseline(/Friday delivery|Generated fixture response/);
    observations.push({ queuedSaveBarrier: { actorLockHeldThenReleased: true, queuedOldSaveStale: true, clearMarkerNotOverwritten: true, freshBaselineProved: true } });

    // Basic chat shares the same origin and actor storage but excludes memory/**
    // from its curated package. Its clear must still serialize with memory saves.
    await fresh(); await appendHistory(); await seedSentinels();
    const oldMemoryPage = page, storedBeforeBasicClear = (await state()).stored['private-one-chat-memory-v1'];
    await oldMemoryPage.evaluate(() => {
      const f = window.__repairFixture; f.locked = false;
      void navigator.locks.request('rag-local-memory:local-user', () => new Promise(resolve => { f.releaseLock = resolve; f.locked = true; }));
    });
    await oldMemoryPage.waitForFunction(() => window.__repairFixture.locked);
    const basicRequests = [], basicPage = await context.newPage();
    basicPage.on('request', request => basicRequests.push(new URL(request.url()).pathname));
    basicPage.on('pageerror', cause => pageErrors.push(cause.message));
    page = basicPage; page.setDefaultTimeout(12000);
    await page.goto(new URL('?memory=0', base).href); await page.waitForFunction(() => window.__repairFixture);
    await page.evaluate(() => { window.__basicClearBeforeReload = 'held-lock'; });
    await beginClear(); await page.locator('#clear-confirm').click(); await pause(80);
    assert.equal(await page.evaluate(() => window.__basicClearBeforeReload), 'held-lock');
    assert.equal(await page.locator('#clear-confirmation').evaluate(node => node.open), true);
    assert.equal(await page.locator('#clear-confirm').isDisabled(), true);
    assert.equal(await page.evaluate(() => localStorage.getItem('private-one-chat-memory-v1')), storedBeforeBasicClear);
    await Promise.all([page.waitForEvent('domcontentloaded'), oldMemoryPage.evaluate(() => window.__repairFixture.releaseLock())]);
    await page.waitForFunction(() => window.__repairFixture);
    const marker = await page.evaluate(() => JSON.parse(localStorage.getItem('private-one-chat-memory-v1')));
    assert.equal(marker.schema, 'private-one-chat-memory-reset/v1'); assert.equal(marker.pending, false);
    assert.ok(!basicRequests.some(path => path.startsWith('/memory/')), 'Basic clear never requests excluded optional memory modules');
    const oldSave = await oldMemoryPage.evaluate(() => window.localMemoryPreview.workspace.persist());
    assert.equal(oldSave.durable, false); assert.match(oldSave.error, /changed|cleared|Reload/i);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('private-one-chat-memory-v1'))), marker);
    await assertSentinels(); await oldMemoryPage.close();
    await page.goto(new URL('?memory=1', base).href); await page.waitForFunction(() => window.localMemoryPreview?.workspace);
    await assertFreshBaseline(/Friday delivery|Generated fixture response/);
    observations.push({ basicClearActorLock: { basicRoute: '?memory=0', noMarkerOrReloadBeforeRelease: true, sharedActorLockHonored: true,
      resetMarkerWon: true, staleOtherMemoryTabSaveRejected: true, optionalMemoryModulesRequestedByBasic: false,
      freshMemoryBaselineAndCacheSentinelsProved: true } });
  });
}

try {
  const driver = process.env.BROWSER_MODEL_PLAYWRIGHT_MODULE, chrome = process.env.MODEL_CHAT_BROWSER;
  assert.ok(driver && chrome, 'Explicit existing Playwright/Chrome required'); await Promise.all([access(driver), access(chrome)]);
  assert.equal(digest(await readFile(join(coreRoot, 'rag-core.mjs'))), coreSha256);
  assert.equal(digest(await readFile(join(coreRoot, 'graph-renderer.mjs'))), graphSha256);
  sourceBefore = await sourceIdentity();
  server = await startServer({ root: join(root, 'examples/browser-model-chat'), runtimeRoot, memoryCoreRoot: coreRoot, memoryGraphRoot: coreRoot }); base = new URL(server.url);
  const { chromium } = await import(pathToFileURL(resolve(driver)).href);
  profile = await mkdtemp(join(tmpdir(), profilePrefix));
  context = await chromium.launchPersistentContext(profile, { executablePath: chrome, headless: true, chromiumSandbox: true, serviceWorkers: 'block',
    viewport: { width: 1440, height: 1000 }, hasTouch: true, reducedMotion: 'reduce',
    ignoreDefaultArgs: ['--enable-unsafe-swiftshader', '--unsafely-disable-devtools-self-xss-warnings'] });
  browserVersion = context.browser()?.version();
  await context.exposeBinding('__repairPort', (_source, kind) => { if (kind === 'worker-attempt') workers++; else ports.push(kind); });
  await context.exposeBinding('__repairBarrier', (_source, value) => barriers.push(value));
  await context.addInitScript(() => {
    window.Worker = class { constructor() { void window.__repairPort('worker-attempt'); throw Error('Workers forbidden in UI fixture'); } };
    new MutationObserver(() => {
      for (const header of [document.querySelector('.masthead'), document.querySelector('#memory-dialog .memory-panel-header')]) if (header && !header.querySelector('[data-repair-fixture-label]')) {
        const label = document.createElement('small'); label.dataset.repairFixtureLabel = 'true'; label.textContent = 'DETERMINISTIC UI FIXTURE - NO MODEL OR NATIVE TOKENIZER';
        label.style.cssText = 'position:absolute;bottom:0;left:12px;font:8px/10px ui-monospace;color:#ffe8bd;pointer-events:none'; header.style.position = 'relative'; header.append(label);
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url()), path = url.pathname.slice(1) || 'index.html';
    assert.ok(++requests <= 1000, 'Finite request budget');
    if (url.origin !== base.origin || /^(runtime\/|engine-worker\.mjs$)|\.wasm$|\.gguf$/i.test(path) || route.request().resourceType() === 'worker') {
      forbidden.push(path); return route.abort();
    }
    if (path === 'runtime-adapter.mjs') return route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: adapter });
    try {
      const response = await route.fetch(); assert.equal(response.status(), 200, path);
      const bytes = await response.body(); assetBytes += bytes.length; assert.ok(assetBytes <= 64 * 1024 * 1024, 'Finite asset byte budget');
      if (/\.m?js$/.test(path)) assert.match(response.headers()['content-type'] || '', /^(application|text)\/javascript(?:;|$)/i);
      const source = path === 'memory/rag-core.mjs' ? join(coreRoot, 'rag-core.mjs') : path === 'memory/graph-renderer.mjs' ? join(coreRoot, 'graph-renderer.mjs')
        : path.startsWith('theme/') ? join(root, 'modules/browser-rag-ts/demo', path.slice(6)) : join(root, 'examples/browser-model-chat', path);
      assert.equal(digest(bytes), digest(await readFile(source)), path + ' production bytes'); assets.push({ path, sha256: digest(bytes) });
      return route.fulfill({ response });
    } catch (cause) { pageErrors.push(cause.message); return route.abort(); }
  });
  page = context.pages()[0] || await context.newPage(); page.setDefaultTimeout(12000);
  page.on('pageerror', cause => pageErrors.push(cause.message)); page.on('worker', () => workers++);
  await proof();
  await check('all production source identities and finite no-model boundaries remain intact', async () => {
    sourceAfter = await sourceIdentity(); assert.deepEqual(sourceAfter, sourceBefore); assert.deepEqual(forbidden, []); assert.deepEqual(pageErrors, []); assert.equal(workers, 0);
  });
} catch (cause) { error = cause.stack || cause.message; process.exitCode = 1; console.error(error); }
finally {
  const failed = cause => { error ||= cause.message; process.exitCode = 1; };
  if (context) await context.close().then(() => { cleanup.contextClosed = true; }, failed);
  if (server) await server.close().then(() => { cleanup.serverClosed = true; }, failed);
  if (profile && dirname(profile) === resolve(tmpdir()) && basename(profile).startsWith(profilePrefix)) {
    await rm(profile, { recursive: true, force: true }).then(() => { cleanup.ownedProfileRemoved = true; }, failed);
  }
  const result = { schema: 'conversation-repair-browser/v1', status: error ? 'fail' : 'pass', harnessSha256, durationMs: Date.now() - started,
    browserVersion, sourceBefore, sourceAfter, coreSha256, graphSha256, checks, observations, screenshots,
    assets: { requests, verified: assets.length, bytes: assetBytes, identitySha256: digest(JSON.stringify(assets)) },
    boundary: { localOnly: true, disposableOwnedProfile: true, productionBootstrap: true, productionPromptAssembly: true, onlyAdapterReplaced: true,
      fixturePorts: Object.fromEntries(['prepare', 'measure', 'reply', 'dispose'].map(kind => [kind, ports.filter(value => value === kind).length])),
      nativeModelCalls: 0, modelDownloads: 0, runtimeWasmFetched: false, workers, forbidden, pageErrors, physicalDevice: false }, cleanup, error };
  const bytes = JSON.stringify(result); assert.ok(Buffer.byteLength(bytes) <= 24 * 1024, 'Compact result bound');
  await mkdir(output, { recursive: true }); await writeFile(join(output, 'browser-result.tmp'), bytes);
  console.log('CONVERSATION_REPAIR_BROWSER_JSON ' + bytes);
}
