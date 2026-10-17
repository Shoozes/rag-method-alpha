// Real native/browser acceptance. Never substitutes the adapter, model, meter,
// replies, event ledger or production operations. Owns only a disposable profile.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from '../examples/browser-model-chat/serve.mjs';
import { MODEL, RUNTIME, COMPAT } from '../examples/browser-model-chat/model-contract.mjs';
import { smokeTurns, semanticChecks, spaceNote, recallTurn } from './space-journey-plan.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node tests/model-chat-space-journey.mjs [--smoke | --scenario smoke|automatic|manual|reset|full]\nRequired BROWSER_MODEL_GGUF_FILE and BROWSER_MODEL_PLAYWRIGHT_MODULE; optional MODEL_CHAT_BROWSER, BROWSER_MODEL_RUNTIME_ROOT, BROWSER_MODEL_MEMORY_ROOT, BROWSER_MODEL_JOURNEY_OUTPUT. All model bytes must already exist; no downloads occur. One receipt retains earlier stage failures.');
  process.exit(0);
}
assert.ok(args.length === 0 || args.length === 1 && args[0] === '--smoke' || args.length === 2 && args[0] === '--scenario', 'Unknown options. Use --help.');
const mode = args[0] === '--smoke' ? 'smoke' : args[1] || 'full';
assert.ok(['smoke', 'automatic', 'manual', 'reset', 'full'].includes(mode), 'Unknown scenario: ' + mode);
const modelInput = process.env.BROWSER_MODEL_GGUF_FILE;
if (!modelInput) throw Error('Set BROWSER_MODEL_GGUF_FILE to the exact retained pinned model. This harness never downloads it.');
const output = resolve(process.env.BROWSER_MODEL_JOURNEY_OUTPUT || join(root, '.artifacts/proof/space-journey'));
const runtimeRoot = resolve(process.env.BROWSER_MODEL_RUNTIME_ROOT || join(root, '../rag-model-onboarding/.artifacts/model-chat/runtime'));
const memoryRoot = resolve(process.env.BROWSER_MODEL_MEMORY_ROOT || join(root, '../rag-conversation-repair/.artifacts/memory'));
if (!process.env.BROWSER_MODEL_PLAYWRIGHT_MODULE) throw Error('Set BROWSER_MODEL_PLAYWRIGHT_MODULE to an existing Playwright module; automatic installation is disabled.');
const playwright = resolve(process.env.BROWSER_MODEL_PLAYWRIGHT_MODULE);
const chrome = process.env.MODEL_CHAT_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const digest = value => createHash('sha256').update(value).digest('hex');
const pause = ms => new Promise(done => setTimeout(done, ms));
const started = Date.now(), hardLimitMs = 30 * 60_000, deadline = started + hardLimitMs;
const checks = [], qualityFailures = [], turns = [], observations = [], sourceIdentity = [], externalRequests = [], errors = [];
const visualCaptures = [], visualJobs = new Map();
const harnessIdentity = { path: 'tests/model-chat-space-journey.mjs', sha256: digest(await readFile(fileURLToPath(import.meta.url))),
  planPath: 'tests/space-journey-plan.mjs', planSha256: digest(await readFile(join(root, 'tests/space-journey-plan.mjs'))) };
const cleanup = { browserClosed: false, profileRemoved: false, serverClosed: false };
let server, browser, context, page, profile, chromeProcess, modelPath, failure, failureContext, hardTimer, runtimeIdentity, hardExpired = false, currentStage = 'setup', visualBridgeInstalled = false;
const checkpoint = (event, data = {}) => console.log(JSON.stringify({ event, elapsedMs: Date.now() - started, ...data }));
const bounded = () => { if (Date.now() >= deadline || hardExpired) throw Error('The bounded 30-minute native journey limit expired.'); };
async function check(name, work) {
  bounded(); const at = Date.now();
  try { const result = await work(); checks.push({ name, status: 'pass', ms: Date.now() - at }); checkpoint('check', { name, status: 'pass', ms: Date.now() - at }); return result; }
  catch (error) { checks.push({ name, status: 'fail', ms: Date.now() - at, error: error.message }); throw error; }
}
async function snapshot() {
  return page.evaluate(() => {
    const { workspace: w, app } = window.localMemoryPreview;
    return { controller: app.controller.getState(), conversation: w.conversation.snapshot(), context: w.context.snapshot(),
      summary: w.context.summarySnapshot(), summaryStatus: w.context.summaryStatus(), usage: w.context.usageSnapshot(), inspection: w.context.inspectionSnapshot(),
      events: w.events.list(), automaticPolicy: JSON.parse(w.automaticMemory.exportPolicy()), persona: JSON.parse(w.automaticMemory.exportPersona()),
      globals: JSON.parse(w.automaticMemory.exportGlobal()), visibleMemory: w.automaticMemory.snapshot(), manual: w.context.manualCompactionStatus(),
      error: document.getElementById('chat-error').hidden ? null : document.getElementById('chat-error').textContent };
  });
}
function verifyRequest(state, turn) {
  const submitted = state.inspection.lastSubmitted;
  assert.ok(submitted?.complete && Array.isArray(submitted.exactMessages), 'Exact submitted messages must be inspectable.');
  assert.equal(digest(JSON.stringify(submitted.exactMessages)), submitted.requestSha256, 'Request bytes match the exact native measurement/submission hash.');
  assert.equal(submitted.exactMessages.at(-1).role, 'user'); assert.equal(submitted.exactMessages.at(-1).content, turn.text);
  assert.ok(!submitted.exactMessages.some(message => message.role === 'system' && /No older user passage selected\.|No saved evidence matched this query\./u.test(message.content)), 'No diagnostic placeholder enters the native prompt.');
  assert.ok(Number.isSafeInteger(submitted.promptTokens) && submitted.promptTokens > 0 && submitted.promptTokens <= 1888, 'Native submitted prompt fits the usable budget.');
  assert.equal(state.usage.measurement?.quality, 'measured', 'A fixture or estimated meter cannot qualify native acceptance.');
  assert.equal(submitted.admittedComplete, true, 'All admitted rows must fit the bounded inspector.');
  const beforeAnswer = state.conversation.turns.slice(0, -1), rawExpected = beforeAnswer.slice(state.context.cutoff).map(({ role, content }) => ({ role, content }));
  const rawActual = submitted.exactMessages.filter(message => message.role !== 'system');
  assert.deepEqual(rawActual, rawExpected, 'Production request preserves the exact canonical raw tail and role order.');
  assert.equal(rawActual[0].role, 'user', 'The raw tail cannot begin with an orphan assistant.');
  const rawIds = new Set(beforeAnswer.slice(state.context.cutoff).map(value => value.id));
  for (const row of submitted.admitted) if (row.turnId && ['conversation', 'derived-context'].includes(row.kind))
    assert.ok(!rawIds.has(row.turnId), 'A raw turn cannot also be admitted as recalled/derived context.');
  for (const row of submitted.admitted) if (row.turnId && row.offsets && row.turnHash && row.text !== null) {
    const source = state.conversation.turns.find(value => value.id === row.turnId);
    assert.ok(source && source.role === 'user', 'Quoted conversation evidence is actually user-authored.');
    assert.equal(digest(source.content), row.turnHash); assert.equal(source.content.slice(row.offsets.start, row.offsets.end), row.text);
    if (row.lineHash) assert.equal(digest(row.text), row.lineHash);
  }
  const dispatch = state.events.findLast(event => event.type === 'context-dispatched');
  assert.equal(dispatch?.requestSha256, submitted.requestSha256); assert.equal(submitted.replyTurnId, state.conversation.turns.at(-1).id);
  assert.equal(state.persona.records.length, 0, 'Conversation never becomes Persona memory automatically.');
  return submitted;
}
async function settled() {
  const timeout = Math.min(150_000, Math.max(1, deadline - Date.now()));
  await page.waitForFunction(() => ['error', 'cancelled', 'unsupported'].includes(document.getElementById('app').dataset.phase)
    || document.getElementById('app').dataset.phase === 'ready' && !document.querySelector('.message.pending') && !document.getElementById('send').disabled, null, { timeout });
  const current = await snapshot();
  assert.equal(current.controller.phase, 'ready', current.controller.error || current.error || 'Model did not become ready.');
  assert.equal(current.error, null, 'Application context/reply must complete without an error.');
  return current;
}
async function submit(turn, { scenario = 'smoke', watchMerge = false } = {}) {
  bounded(); const at = Date.now();
  assert.ok(turns.filter(value => value.scenario === scenario).length < 30, 'At most30 authored turns per scenario.');
  const dialog = page.locator('#memory-dialog');
  if (await dialog.evaluate(node => node.open)) await page.locator('#memory-close').click();
  const before = await snapshot();
  await page.locator('#prompt').fill(turn.text); await page.locator('#send').click();
  if (watchMerge) await openMemory();
  const current = await settled();
  assert.equal(current.conversation.turns.length, before.conversation.turns.length + 2, 'One authored turn plus one actual completed native answer.');
  const answer = current.conversation.turns.at(-1); assert.equal(answer.role, 'assistant'); assert.ok(answer.content.trim());
  const submitted = verifyRequest(current, turn), semantic = semanticChecks(turn, answer.content);
  if (semantic.length) qualityFailures.push({ scenario, turnId: turn.id, failures: semantic, answer: answer.content.slice(0, 800), requestSha256: submitted.requestSha256 });
  turns.push({ scenario, id: turn.id, authored: turn.text, answer: answer.content.slice(0, 800), answerSha256: digest(answer.content),
    answerComplete: answer.content.length <= 800, promptTokens: submitted.promptTokens, fractionOfUsablePrompt: submitted.promptTokens / 1888,
    requestSha256: submitted.requestSha256, rawTurns: submitted.exactMessages.filter(value => value.role !== 'system').length,
    admitted: submitted.admitted.map(({ nodeId, turnId, kind }) => ({ nodeId, turnId, kind })), semantic: semantic.length ? 'fail' : 'pass', ms: Date.now() - at });
  checkpoint('turn', { scenario, id: turn.id, promptTokens: submitted.promptTokens, semantic: semantic.length ? 'fail' : 'pass', answer: answer.content.slice(0, 300), ms: Date.now() - at });
  return current;
}
async function openMemory() {
  if (!await page.locator('#memory-dialog').evaluate(node => node.open)) await page.locator('#memory-open').click();
  await page.waitForFunction(() => document.getElementById('memory-graph').dataset.renderer === 'tsl', null, { timeout: 25_000 });
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
}
async function screenshot(name) {
  const path = join(output, name); await page.screenshot({ path, fullPage: true });
  const bytes = await readFile(path); return { path: name, bytes: bytes.length, sha256: digest(bytes), elapsedMs: Date.now() - started };
}
async function installObservers() {
  if (!visualBridgeInstalled) await context.exposeFunction('__spaceJourneyVisual', data => {
    if (visualJobs.has(data.scenario)) return;
    const job = (async () => {
      await pause(220);
      const during = await screenshot(data.scenario + '-during.png');
      await pause(1380);
      const after = await screenshot(data.scenario + '-after.png');
      const sampled = await page.evaluate(() => window.__spaceJourneyVisualSamples.at(-1));
      visualCaptures.push({ ...data, during, after, sampled });
    })();
    visualJobs.set(data.scenario, job); job.catch(error => checkpoint('visual-capture-error', { error: error.message }));
  });
  visualBridgeInstalled = true;
  await page.evaluate(() => {
    window.__spaceJourneyObserved = [];
    window.__spaceJourneyVisualSamples = [];
    const w = window.localMemoryPreview.workspace;
    w.events.subscribe(event => {
      if (event.type === 'compacted') window.__spaceJourneyObserved.push({ ...event, observedAt: performance.now(), summary: w.context.summarySnapshot() });
    });
    const rounded = value => typeof value === 'number' ? Math.round(value * 1e4) / 1e4 : value;
    const sample = element => {
      const canvas = document.querySelector('#memory-graph canvas'), parse = key => { try { return JSON.parse(canvas?.dataset[key] || 'null'); } catch { return null; } };
      return { at: rounded(performance.now()), eventId: element?.dataset.eventId, mergePhase: element?.dataset.nodeMergePhase,
        movingNodeCount: Number(element?.dataset.movingNodeCount || 0), nodeMergeFrameCount: Number(element?.dataset.nodeMergeFrameCount || 0), targetNodeId: element?.dataset.targetNodeId,
        positions: (parse('nodePositions') || []).map(point => Object.fromEntries(Object.entries(point).map(([key, value]) => [key, rounded(value)]))),
        colors: parse('nodeColors') || [],
        visibleNodeIds: [...document.querySelectorAll('[data-memory-node]')].filter(node => !node.hidden).map(node => node.dataset.memoryNode),
        particleCount: element?.querySelectorAll('.memory-summary-particle').length || 0,
        particles: [...element?.querySelectorAll('.memory-summary-particle') || []].slice(0, 4).map(node => ({ source: node.dataset.sourceNodeId, target: node.dataset.targetNodeId, transform: getComputedStyle(node).transform })) };
    };
    new MutationObserver(records => {
      for (const record of records) for (const added of record.addedNodes) if (added instanceof Element) {
        const effects = added.matches('.memory-summary-effects') ? [added] : [...added.querySelectorAll('.memory-summary-effects')];
        for (const element of effects) {
          const armed = window.__spaceJourneyVisualArmed; if (!armed) continue;
          window.__spaceJourneyVisualArmed = null;
          const entry = { scenario: armed, eventId: element.dataset.eventId, targetNodeId: element.dataset.targetNodeId,
            sourceNodeIds: element.dataset.sourceNodeIds, reducedMotion: element.dataset.reducedMotion, samples: [sample(element)] };
          window.__spaceJourneyVisualSamples.push(entry);
          for (const delay of [180, 450, 850, 1250, 1450]) setTimeout(() => entry.samples.push(sample(element.isConnected ? element : null)), delay);
          void window.__spaceJourneyVisual({ scenario: armed, eventId: entry.eventId, targetNodeId: entry.targetNodeId });
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
}
async function armVisual(scenario) {
  await openMemory();
  const before = await screenshot(scenario + '-before.png');
  await page.evaluate(scenario => { window.__spaceJourneyVisualArmed = scenario; }, scenario);
  return before;
}
function verifySummary(current, event, { trigger, before } = {}) {
  // Preserve the real candidate even when a following invariant fails. This is
  // diagnostic state from production, never a successful-compaction claim.
  observations.push({ compactionCandidate: { trigger, event: event || null, context: { cutoff: current.context.cutoff, cycle: current.context.cycle },
    summary: current.summary, conversationVersion: current.conversation.version, originals: current.conversation.turns.map(turn => ({ id: turn.id, role: turn.role, sha256: digest(turn.content) })) } });
  assert.ok(event, 'The native threshold/manual action must commit an actual compaction event.');
  assert.equal(event.trigger || 'automatic', trigger); assert.equal(event.capacity, 2048); assert.equal(event.reserve, 160);
  assert.ok(event.afterPromptTokens <= 1888 && event.afterPromptTokens < event.beforePromptTokens, 'Committed context is genuinely smaller and within budget.');
  if (trigger === 'automatic') assert.ok(event.beforePromptTokens > 1888, 'Automatic compaction actually crossed the native admitted prompt threshold.');
  else assert.ok(event.beforePromptTokens / 1888 >= .45 && event.beforePromptTokens / 1888 <= .55, 'Manual compaction begins at45–55% of true usable prompt budget.');
  const summary = current.summary; assert.ok(summary?.items.length > 0, 'An empty extractor diagnostic is not a retained summary.');
  assert.equal(summary.eventId, event.id); assert.equal(summary.summaryHash, event.summaryHash); assert.equal(digest(summary.text), event.summaryHash);
  assert.ok(current.context.cutoff > 0); assert.equal(current.context.cycle, event.cycle);
  const sources = new Map(current.conversation.turns.map(turn => [turn.id, turn]));
  for (const item of summary.items) {
    const original = sources.get(item.turnId); assert.ok(original?.role === 'user'); assert.equal(digest(original.content), item.turnHash);
    assert.equal(original.content.slice(item.offsets.start, item.offsets.end), item.quote);
    for (const ref of item.sourceRefs) { const source = sources.get(ref.turnId); assert.equal(digest(source.content), ref.turnHash); assert.equal(digest(source.content.slice(ref.offsets.start, ref.offsets.end)), ref.lineHash); }
  }
  const retainedText = summary.items.map(item => item.quote).join('\n');
  assert.match(retainedText, /Cedar-17/iu, 'The summary must retain a unique authored fact, not only public starter facts.');
  assert.match(retainedText, /Tuesday/iu, 'The explicit corrected observing detail must remain in source-linked context.');
  if (before) assert.deepEqual(current.conversation, before.conversation, 'Manual compaction preserves all original turns/version and emits no provider reply.');
  assert.equal(current.persona.records.length, 0);
  return { event, targetNodeId: summary.id, summaryHash: summary.summaryHash, sourceTurnIds: summary.sourceTurnIds,
    items: summary.items.map(({ turnId, offsets, turnHash, quote }) => ({ turnId, offsets, turnHash, quote })), fractionBefore: event.beforePromptTokens / 1888 };
}
async function verifyVisual(scenario, before, summaryProof) {
  await page.waitForFunction(scenario => window.__spaceJourneyVisualSamples?.some(value => value.scenario === scenario), scenario, { timeout: 6000 });
  for (let attempt = 0; attempt < 30 && !visualJobs.has(scenario); attempt++) await pause(20);
  await Promise.all([...visualJobs.values()]);
  const capture = visualCaptures.find(value => value.scenario === scenario);
  const diagnostic = { scenario, before, ...(capture || {}), summaryHash: summaryProof.summaryHash, status: 'checking' };
  observations.push({ visual: diagnostic });
  assert.ok(capture, 'The real committed summary must produce a visible merge presentation.');
  assert.equal(capture.eventId, summaryProof.event.id); assert.equal(capture.targetNodeId, summaryProof.targetNodeId);
  const samples = capture.sampled?.samples || [];
  const active = samples.filter(sample => sample.positions.some(point => point.node_id === summaryProof.targetNodeId));
  const sourceIds = summaryProof.sourceTurnIds.map(id => 'turn:' + id), distances = [];
  for (const sample of active) {
    const target = sample.positions.find(point => point.node_id === summaryProof.targetNodeId);
    distances.push({ at: sample.at, phase: sample.mergePhase, sources: sourceIds.flatMap(id => { const source = sample.positions.find(point => point.node_id === id); return source ? [{ id, distance: Math.hypot(source.x - target.x, source.y - target.y, source.z - target.z) }] : []; }) });
  }
  const moved = sourceIds.filter(id => {
    const values = distances.flatMap(row => row.sources.filter(value => value.id === id).map(value => value.distance));
    return values.length >= 2 && values[0] > .001 && values.at(-1) < values[0] * .15;
  });
  diagnostic.movedSourceIds = moved; diagnostic.distances = distances;
  const targetColor = 0x22e37f;
  assert.ok(samples.every(sample => sample.colors.some(row => row.node_id === summaryProof.targetNodeId && row.base_color === targetColor)), 'Actual retained summary material stays emerald during merge and after settling.');
  const recoloredSources = sourceIds.filter(id => {
    const colors = samples.flatMap(sample => sample.colors.filter(row => row.node_id === id).map(row => row.base_color));
    return new Set(colors).size > 1 && colors.some(color => color === targetColor);
  });
  assert.equal(recoloredSources.length, sourceIds.length, 'Every actual moving source body transitions to the destination summary color.');
  diagnostic.summaryColor = '#22e37f'; diagnostic.recoloredSourceIds = recoloredSources;
  assert.ok(moved.length > 0, 'Actual producer source-mesh world positions converge onto the retained summary. Particles alone cannot pass.');
  assert.ok(samples.some(value => value.particleCount > 0), 'A real merge includes bounded light particles.');
  assert.ok(samples.at(-1).positions.some(value => value.node_id === summaryProof.targetNodeId), 'Retained summary target survives settling.');
  diagnostic.status = 'pass';
}
async function manualOccupancy() {
  const current = await snapshot(), submitted = current.inspection.lastSubmitted;
  assert.equal(current.context.cutoff, 0, 'Half-budget scenario must be clean and un-compacted.');
  const messages = [...submitted.exactMessages, { role: 'assistant', content: current.conversation.turns.at(-1).content }];
  const measured = await page.evaluate(messages => window.localMemoryPreview.workspace.provider.measure(messages), messages);
  assert.ok(Number.isSafeInteger(measured.promptTokens)); assert.equal(measured.contextTokens, 2048); assert.equal(measured.overflow, false);
  observations.push({ manualAimingMeasurement: { promptTokens: measured.promptTokens, requestSha256: digest(JSON.stringify(messages)), actualNative: true } });
  return measured.promptTokens;
}
async function cleanScenario(name, { load = true } = {}) {
  currentStage = name + ':clean-start';
  const current = await snapshot();
  if (current.conversation.turns.length) {
    if (await page.locator('#memory-dialog').evaluate(node => node.open)) await page.locator('#memory-close').click();
    await page.evaluate(async () => {
      localStorage.setItem('space-journey-unrelated', 'preserve');
      const dir = await navigator.storage.getDirectory(), file = await dir.getFileHandle('space-journey-cache-sentinel', { create: true });
      const writer = await file.createWritable(); await writer.write('preserve'); await writer.close();
      const cache = await caches.open('space-journey-cache-sentinel'); await cache.put('./space-journey-sentinel', new Response('preserve'));
    });
    if (!await page.locator('#chat-options').evaluate(node => node.open)) await page.locator('#chat-options > summary').click();
    await page.locator('#clear').click();
    await page.locator('#clear-cancel').click();
    await page.waitForFunction(() => !document.getElementById('clear-confirmation').open
      && document.getElementById('chat-options').open && document.activeElement?.id === 'clear');
    assert.deepEqual((await snapshot()).conversation, current.conversation);
    if (!await page.locator('#chat-options').evaluate(node => node.open)) await page.locator('#chat-options > summary').click();
    await page.locator('#clear').click(); await Promise.all([page.waitForEvent('domcontentloaded'), page.locator('#clear-confirm').click()]);
    await page.waitForFunction(() => window.localMemoryPreview?.workspace);
    const fresh = await snapshot(); assert.equal(fresh.conversation.turns.length, 0); assert.equal(fresh.persona.records.length, 0); assert.equal(fresh.summary, null); assert.equal(fresh.inspection.lastSubmitted, null);
    assert.equal(fresh.visibleMemory.nodes.filter(node => node.kind === 'global').length, 3);
    const preserved = await page.evaluate(async () => {
      const file = await (await navigator.storage.getDirectory()).getFileHandle('space-journey-cache-sentinel');
      return { unrelated: localStorage.getItem('space-journey-unrelated'), opfs: await (await file.getFile()).text(), cache: await (await (await caches.open('space-journey-cache-sentinel')).match('./space-journey-sentinel')).text() };
    });
    assert.deepEqual(preserved, { unrelated: 'preserve', opfs: 'preserve', cache: 'preserve' }); observations.push({ freshStart: name, cancellationPreservedConversation: true, scopedClearAfterReload: true, unrelatedAndCacheSentinelsPreserved: true, actualRemoteModelCacheExercised: false });
    if (load) await selectRetainedModel();
  }
  await installObservers();
}
async function runAutomatic() {
  const scenario = 'automatic'; await cleanScenario(scenario); currentStage = scenario;
  for (const turn of smokeTurns) await submit(turn, { scenario });
  let current = await snapshot(), beforeImage;
  for (let index = 0; index < 21 && !current.events.some(event => event.type === 'compacted'); index++) {
    beforeImage = await armVisual(scenario);
    current = await submit(spaceNote(index, { large: true }), { scenario, watchMerge: true });
  }
  const event = current.events.findLast(value => value.type === 'compacted'), proof = verifySummary(current, event, { trigger: 'automatic' });
  observations.push({ compaction: { scenario, ...proof } }); await verifyVisual(scenario, beforeImage, proof);
  current = await submit(recallTurn, { scenario });
  const request = current.inspection.lastSubmitted;
  assert.match(JSON.stringify(request.exactMessages), /Cedar-17/iu); assert.match(JSON.stringify(request.exactMessages), /Tuesday/iu);
  await verifyContextAndSearch(scenario);
}
async function runManual() {
  const scenario = 'manual'; await cleanScenario(scenario); currentStage = scenario;
  for (const turn of smokeTurns) await submit(turn, { scenario });
  let measured = await manualOccupancy();
  for (let index = 0; index < 19 && measured < 850; index++) {
    await submit(spaceNote(index, { large: 944 - measured > 210 }), { scenario }); measured = await manualOccupancy();
  }
  assert.ok(measured >= 850 && measured <= 1038, 'Native half-budget aiming must remain within45–55%; no fake token counts.');
  const before = await snapshot(), dispatched = before.events.filter(event => event.type === 'context-dispatched').length, oldEvents = before.events.filter(event => event.type === 'compacted').length;
  assert.equal(oldEvents, 0); assert.equal(before.manual.eligible, true);
  const beforeImage = await armVisual(scenario); await page.locator('#memory-compact-now').click();
  await page.waitForFunction(count => window.localMemoryPreview.workspace.events.list().filter(event => event.type === 'compacted').length > count
    || window.localMemoryPreview.workspace.context.usageSnapshot().phase === 'error', oldEvents, { timeout: 120_000 });
  await page.waitForFunction(() => !document.getElementById('memory-compact-now').disabled, null, { timeout: 120_000 });
  let current = await snapshot(); const event = current.events.findLast(value => value.type === 'compacted');
  const proof = verifySummary(current, event, { trigger: 'manual', before });
  assert.equal(current.events.filter(value => value.type === 'context-dispatched').length, dispatched, 'Manual compaction preview does not dispatch an answer.');
  assert.equal(current.inspection.latestPrepared.purpose, 'manual-compaction'); assert.equal(current.inspection.lastSubmitted.requestSha256, before.inspection.lastSubmitted.requestSha256);
  observations.push({ compaction: { scenario, ...proof } }); await verifyVisual(scenario, beforeImage, proof);
  current = await submit(recallTurn, { scenario });
  assert.match(JSON.stringify(current.inspection.lastSubmitted.exactMessages), /Cedar-17/iu); assert.match(JSON.stringify(current.inspection.lastSubmitted.exactMessages), /Tuesday/iu);
  await verifyContextAndSearch(scenario);
}
async function verifyContextAndSearch(scenario) {
  await openMemory(); const before = await snapshot(), identity = before.inspection.lastSubmitted.requestSha256, count = before.events.filter(event => event.type === 'context-dispatched').length;
  await page.locator('#memory-query').fill('observing notebook Cedar-17'); await page.locator('#memory-recall').click();
  await page.waitForFunction(() => !document.getElementById('memory-recall').disabled);
  const after = await snapshot(); assert.equal(after.events.filter(event => event.type === 'context-dispatched').length, count); assert.equal(after.inspection.lastSubmitted.requestSha256, identity);
  const original = after.conversation.turns.find(turn => turn.role === 'user' && /Cedar-17/u.test(turn.content));
  assert.ok(original, 'The authored observing-notebook source remains available after compaction.');
  await page.locator('#memory-graph [data-memory-node="turn:' + original.id + '"]').click();
  assert.equal(await page.locator('#memory-detail-text').textContent(), original.content);
  const sourceImage = join(output, scenario + '-original-source.png');
  await page.screenshot({ path: sourceImage });
  const sourceBytes = await readFile(sourceImage);
  observations.push({ originalSourceAccess: { scenario, originalTurnId: original.id, contentSha256: digest(original.content),
    screenshot: { path: scenario + '-original-source.png', bytes: sourceBytes.length, sha256: digest(sourceBytes) },
    originalTextExact: true, postCompaction: true } });
  await page.locator('#memory-back').click();
  await page.locator('#memory-context-tab').click();
  const choice = page.locator('#memory-context-request'); if (await choice.isVisible()) await choice.selectOption('submitted');
  const exact = page.getByLabel('Exact full request', { exact: true });
  if (!await page.locator('.memory-context-full-request').evaluate(node => node.open)) await page.locator('.memory-context-full-request > summary').click();
  assert.deepEqual(JSON.parse(await exact.textContent()), after.inspection.lastSubmitted.exactMessages);
  observations.push({ exactContextUI: true, requestSha256: identity, graphSearchCreatedNoDispatch: true });
  await page.locator('#memory-graph-tab').click();
}
async function verifyForgetCancelAndError() {
  currentStage = 'forgotten-source-and-native-recovery';
  const original = (await snapshot()).conversation.turns.find(turn => turn.role === 'user' && /Cedar-17/u.test(turn.content));
  assert.ok(original, 'The unique original authored fact must exist.');
  await openMemory(); await page.locator('#memory-query').fill('observing notebook Cedar-17'); await page.locator('#memory-recall').click();
  const selector = '[data-memory-node="turn:' + original.id + '"]';
  await page.locator(selector).waitFor({ state: 'visible' }); await page.locator(selector).click(); await page.locator('#memory-forget').click();
  await page.waitForFunction(id => window.localMemoryPreview.workspace.automaticMemory.getBlockedTurnIds().includes(id), original.id);
  const forgotten = await submit({ id: 'forgotten-code', text: 'What is the observing notebook code from our notes? If the notes do not contain it, say you do not know.',
    forbidden: ['Cedar-17'], meaning: 'No native answer should recover an excluded unique authored code.' }, { scenario: 'recovery' });
  const prompt = JSON.stringify(forgotten.inspection.lastSubmitted.exactMessages);
  assert.ok(!prompt.includes('Cedar-17'), 'Forgotten source and earlier generated echoes must be absent from the actual submitted prompt.');
  assert.ok(forgotten.inspection.lastSubmitted.admitted.every(row => row.turnId !== original.id));
  assert.ok(forgotten.conversation.turns.some(turn => turn.id === original.id), 'Forgetting excludes context without erasing the canonical original.');
  observations.push({ forgotten: { originalTurnId: original.id, absentFromSubmittedRequest: true, requestSha256: forgotten.inspection.lastSubmitted.requestSha256, canonicalOriginalKept: true } });
  const beforeCancel = await snapshot(), assistantCount = beforeCancel.conversation.turns.filter(turn => turn.role === 'assistant').length;
  if (await page.locator('#memory-dialog').evaluate(node => node.open)) await page.locator('#memory-close').click();
  await page.locator('#prompt').fill('Explain why the Sun is a star in several paragraphs.'); await page.locator('#send').click();
  await page.waitForFunction(() => document.getElementById('app').dataset.phase === 'generating', null, { timeout: 120_000 });
  await page.locator('#stop').click(); await page.waitForFunction(() => document.getElementById('app').dataset.phase === 'cancelled' && !document.querySelector('.message.pending'));
  const cancelled = await snapshot(); assert.equal(cancelled.conversation.turns.filter(turn => turn.role === 'assistant').length, assistantCount);
  assert.equal(cancelled.inspection.lastSubmitted.replyTurnId, null, 'A cancelled native answer must not be published as complete.');
  await pause(150); assert.equal((await snapshot()).conversation.turns.filter(turn => turn.role === 'assistant').length, assistantCount);
  observations.push({ cancellation: { actualNativeGeneration: true, noCompletedAssistantTurn: true, noLateResurrection: true, modelReloadRequired: true } });
  await selectRetainedModel(); await submit({ id: 'after-cancel', text: 'Hello again. Answer in five words or fewer.' }, { scenario: 'recovery' });
  const beforeError = await snapshot(), oldCycles = beforeError.context.cycle, oldDispatches = beforeError.events.filter(event => event.type === 'context-dispatched').length;
  await page.locator('#prompt').fill('星 '.repeat(1900)); await page.locator('#send').click();
  await page.waitForFunction(() => !document.getElementById('chat-error').hidden && !document.getElementById('send').disabled, null, { timeout: 120_000 });
  const refused = await snapshot(); assert.equal(refused.context.cycle, oldCycles); assert.equal(refused.events.filter(event => event.type === 'context-dispatched').length, oldDispatches);
  assert.match(refused.error, /exceeds|budget|Shorten/iu); assert.equal(refused.conversation.turns.at(-1).role, 'user');
  observations.push({ nativeBudgetError: { actualTokenizer: true, message: refused.error, noCompactionCommit: true, noProviderReplyDispatch: true, originalAuthoredTurnKept: true } });
  await cleanScenario('final-reset');
}
async function selectRetainedModel() {
  // Production clears the input after change so the same file can be chosen
  // again. Observe ordinary selection metadata during capture, before that
  // handler runs; never retain or transport its heavyweight File object.
  await page.locator('#local-file').evaluate(input => input.addEventListener('change', () => {
    window.__spaceJourneySelectedFile = { size: input.files[0]?.size, name: input.files[0]?.name };
  }, { capture: true, once: true }));
  const session = await context.newCDPSession(page);
  try {
    const { root: documentNode } = await session.send('DOM.getDocument');
    const { nodeId } = await session.send('DOM.querySelector', { nodeId: documentNode.nodeId, selector: '#local-file' });
    await session.send('DOM.setFileInputFiles', { nodeId, files: [modelPath] });
  } finally { await session.detach(); }
  const file = await page.evaluate(() => window.__spaceJourneySelectedFile);
  assert.equal(file.size, MODEL.bytes, 'Ordinary local File selection must expose the exact nonempty large model.');
  await page.waitForFunction(() => ['ready', 'error', 'cancelled', 'unsupported'].includes(document.getElementById('app').dataset.phase), null, { timeout: 210_000 });
  const current = await snapshot(); assert.equal(current.controller.phase, 'ready', current.controller.error || 'Native initialization did not finish.');
  runtimeIdentity = current.controller; checkpoint('native-ready', { model: MODEL.file, runtimeProfile: current.controller.runtimeProfile, context: current.controller.context });
}
async function collectSourceIdentity(directory, prefix) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === 'tests') continue;
    const path = join(directory, entry.name), name = prefix + entry.name;
    if (entry.isDirectory()) await collectSourceIdentity(path, name + '/');
    else if (/\.(?:mjs|html|css|txt)$/u.test(entry.name)) sourceIdentity.push({ path: name, sha256: digest(await readFile(path)), file: path });
  }
}
async function run() {
  await check('retained-model-runtime-and-product-identities', async () => {
    modelPath = await realpath(resolve(modelInput)); const info = await stat(modelPath); assert.ok(info.isFile()); assert.equal(info.size, MODEL.bytes);
    const hash = createHash('sha256'); for await (const chunk of createReadStream(modelPath)) hash.update(chunk); assert.equal(hash.digest('hex'), MODEL.sha256);
    for (const [file, identity] of Object.entries({ ...RUNTIME.files, ...COMPAT.files })) assert.equal(digest(await readFile(join(runtimeRoot, file))), identity.sha256, file);
    await collectSourceIdentity(join(root, 'examples/browser-model-chat'), 'examples/browser-model-chat/');
    for (const [file, path] of [['rag-core.mjs', join(memoryRoot, 'rag-core.mjs')], ['graph-renderer.mjs', join(memoryRoot, 'graph-renderer.mjs')],
      ['aurel-gold.css', join(root, 'modules/browser-rag-ts/demo/aurel-gold.css')]]) sourceIdentity.push({ path: file, file: path, sha256: digest(await readFile(path)) });
  });
  server = await startServer({ runtimeRoot, memoryCoreRoot: memoryRoot, memoryGraphRoot: memoryRoot });
  profile = await mkdtemp(join(tmpdir(), 'rag-space-journey-'));
  let spawnError; chromeProcess = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore', windowsHide: true });
  chromeProcess.once('error', error => { spawnError = error; });
  let port;
  for (let index = 0; index < 300 && !spawnError; index++) { try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); if (port) break; } catch {} await pause(100); }
  if (!port) throw spawnError || Error('Owned Chrome did not expose its same-machine CDP port.');
  const { chromium } = await import(pathToFileURL(playwright).href); browser = await chromium.connectOverCDP('http://127.0.0.1:' + port); context = browser.contexts()[0];
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(server.url).origin || ['blob:', 'data:'].includes(url.protocol)) return route.continue();
    externalRequests.push({ host: url.hostname, resource: route.request().resourceType() }); return route.abort('internetdisconnected');
  });
  page = context.pages()[0]; page.on('pageerror', error => errors.push(error.message)); await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(server.url + '?memory=1'); await page.waitForFunction(() => window.localMemoryPreview?.workspace);
  await check('disposable-clean-chat-with-three-public-starters', async () => {
    const current = await snapshot(); assert.equal(current.conversation.turns.length, 0); assert.equal(current.persona.records.length, 0);
    assert.equal(current.globals.disabledIds.length, 0); assert.equal(current.visibleMemory.nodes.filter(value => value.kind === 'global').length, 3); assert.equal(current.summary, null);
    assert.equal(current.inspection.lastSubmitted, null); assert.equal(current.controller.phase, 'idle');
  });
  await check('actual-native-model-load-through-production-file-input', selectRetainedModel);
  if (mode === 'smoke') {
    currentStage = 'smoke';
    await check('native-short-conversation-space-followup-and-correction', async () => { for (const turn of smokeTurns) await submit(turn); });
    observations.push({ smokeCompleted: true, allRepliesNative: true, semanticsPassed: qualityFailures.length === 0 });
  } else if (mode === 'reset') {
    await check('native-reset-with-settings-already-open', async () => {
      await submit(smokeTurns[0], { scenario: 'reset' });
      if (!await page.locator('#chat-options').evaluate(node => node.open)) await page.locator('#chat-options > summary').click();
      assert.equal(await page.locator('#chat-options').evaluate(node => node.open), true);
      await cleanScenario('reset');
    });
  } else {
    if (['automatic', 'full'].includes(mode)) await check('native-automatic-threshold-source-retention-and-merge', runAutomatic);
    if (['manual', 'full'].includes(mode)) await check('native-manual-half-budget-source-retention-and-merge', runManual);
    await check('forgotten-source-absence-native-cancellation-error-and-reset', verifyForgetCancelAndError);
  }
  await check('native-ready-narrow-layout', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    const bounds = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, height: innerHeight,
      scrollHeight: document.documentElement.scrollHeight, viewport: { width: visualViewport.width, height: visualViewport.height, offsetLeft: visualViewport.offsetLeft, offsetTop: visualViewport.offsetTop, scale: visualViewport.scale } }));
    assert.ok(bounds.scrollWidth <= bounds.width + 1, 'Narrow layout has no horizontal page overflow.'); observations.push({ narrow: bounds });
  });
  await check('no-external-requests-or-browser-errors', async () => { assert.deepEqual(externalRequests, []); assert.deepEqual(errors, []); });
}
try {
  await mkdir(output, { recursive: true });
  await Promise.race([run(), new Promise((_, reject) => { hardTimer = setTimeout(() => { hardExpired = true; reject(Error('The hard 30-minute native journey limit expired.')); }, hardLimitMs); })]);
} catch (error) {
  failure = error;
  if (page && !page.isClosed()) try {
    failureContext = await page.evaluate(() => {
      const w = window.localMemoryPreview?.workspace; if (!w) return null;
      const state = w.context.snapshot(), inspection = w.context.inspectionSnapshot(), canvas = document.querySelector('#memory-graph canvas');
      const request = value => value ? { requestSha256: value.requestSha256, promptTokens: value.promptTokens, purpose: value.purpose || null,
        admitted: value.admitted, admittedComplete: value.admittedComplete, replyTurnId: value.replyTurnId } : null;
      return { cutoff: state.cutoff, cycle: state.cycle, usage: w.context.usageSnapshot(), summary: w.context.summarySnapshot(),
        compactedEvents: w.events.list().filter(event => event.type === 'compacted').slice(-2),
        latestPrepared: request(inspection.latestPrepared), lastSubmitted: request(inspection.lastSubmitted),
        visualSamples: window.__spaceJourneyVisualSamples || [], rendererDiagnostics: canvas?.dataset.rendererDiagnostics || null };
    });
  } catch { /* A transport failure may make optional diagnostics unavailable. */ }
  const retainedVisualIds = new Set(observations.flatMap(value => value.visual?.sampled?.eventId ? [value.visual.sampled.eventId] : []));
  if (failureContext?.visualSamples) {
    failureContext.visualSamplesAlreadyRetained = [...retainedVisualIds];
    failureContext.visualSamples = failureContext.visualSamples.filter(value => !retainedVisualIds.has(value.eventId));
  }
  for (const value of observations) if (value.visual?.status === 'checking') value.visual.status = 'failed-invariant';
  checkpoint('failure', { classification: 'functional-or-harness', stage: currentStage, error: error.message });
}
finally {
  clearTimeout(hardTimer);
  if (page && !page.isClosed()) { try { await page.evaluate(() => window.localMemoryPreview?.app.controller.cancel()); } catch {} }
  if (browser) { try { const cdp = await context.newCDPSession(page); await cdp.send('Browser.close'); } catch {} await browser.close().catch(() => {}); }
  if (chromeProcess) {
    for (let index = 0; index < 100 && chromeProcess.exitCode === null && chromeProcess.signalCode === null; index++) await pause(50);
    if (chromeProcess.exitCode === null && chromeProcess.signalCode === null) { chromeProcess.kill(); for (let index = 0; index < 100 && chromeProcess.exitCode === null && chromeProcess.signalCode === null; index++) await pause(50); }
    cleanup.browserClosed = chromeProcess.exitCode !== null || chromeProcess.signalCode !== null;
  }
  if (server) { try { await server.close(); cleanup.serverClosed = true; } catch (error) { failure ||= error; } }
  if (profile && cleanup.browserClosed) { try { assert.equal(resolve(dirname(profile)), resolve(tmpdir())); assert.ok(basename(profile).startsWith('rag-space-journey-')); await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); cleanup.profileRemoved = true; } catch (error) { failure ||= error; } }
  if (profile && !cleanup.browserClosed) failure ||= Error('Owned browser exit was not confirmed; disposable profile preserved.');
  for (const identity of sourceIdentity) if (digest(await readFile(identity.file)) !== identity.sha256) failure ||= Error('Product input changed during native acceptance: ' + identity.path);
  if (digest(await readFile(fileURLToPath(import.meta.url))) !== harnessIdentity.sha256
    || digest(await readFile(join(root, harnessIdentity.planPath))) !== harnessIdentity.planSha256) failure ||= Error('Journey harness or authored plan changed during this run.');
  const receipt = { schema: 'browser-model-space-journey/v1', mode, status: failure ? 'functional-or-harness-failure' : qualityFailures.length ? 'model-quality-failure' : 'pass',
    fixture: false, browser: browser ? browser.version() : null, node: process.version, durationMs: Date.now() - started, harnessIdentity,
    command: ['node', 'tests/model-chat-space-journey.mjs', ...args],
    budget: { configuredContext: 2048, replyReserve: 160, usablePrompt: 1888, manualHalfTarget: 944, meter: 'Production native createChatCompletion usage.prompt_tokens; one completion token per measurement.' },
    model: MODEL, runtime: { version: RUNTIME.version, files: RUNTIME.files, compatibility: COMPAT, actual: runtimeIdentity },
    sourceIdentity: sourceIdentity.map(({ file, ...identity }) => identity), checks, turns, qualityFailures, observations, externalRequests, browserErrors: errors, cleanup,
    boundaries: { modelDownloads: 0, paidCalls: 0, protocolModelBytes: 0, userBrowserProfileAccess: false, productionOperationsReplaced: false, physicalIOS: false },
    ...(failure ? { error: { name: failure.name, message: failure.message, stage: currentStage, classification: 'functional-or-harness', modelQualityFailure: false }, failureContext } : {}) };
  try {
    const previous = JSON.parse(await readFile(join(output, 'receipt.json'), 'utf8'));
    const { previousRuns = [], ...last } = previous;
    const compact = run => {
      const { sourceIdentity: inputs, runtime, model, ...kept } = run;
      return { ...kept, ...(inputs ? { sourceIdentitySha256: digest(JSON.stringify(inputs)), sourceInputCount: inputs.length } : {}),
        ...(runtime ? { runtimeVersion: runtime.version, actualRuntimeProfile: runtime.actual?.runtimeProfile } : {}), ...(model ? { modelSha256: model.sha256 } : {}) };
    };
    receipt.previousRuns = [...previousRuns.map(compact), { ...compact(last), retainedFromReceiptSha256: digest(JSON.stringify(previous) + '\n') }];
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const bytes = JSON.stringify(receipt); await writeFile(join(output, 'receipt.json'), bytes + '\n');
  checkpoint('receipt', { status: receipt.status, checks: checks.length, qualityFailures: qualityFailures.length, bytes: Buffer.byteLength(bytes) + 1, sha256: digest(bytes + '\n'), output: join(output, 'receipt.json') });
}
if (failure || qualityFailures.length) process.exitCode = 1;
