import test from 'node:test';
import assert from 'node:assert/strict';
import { contextInspectionView, createContextInspector } from '../examples/browser-model-chat/memory/context-panel.mjs';

const row = { nodeId: 'turn:t-0001', scope: 'conversation', role: 'user', text: 'The compass is copper.',
  admitted: true, admissionReason: 'Included by the supplied request accounting.', score_micro: null, keyword_micro: null, reasons: [] };
const record = (phase = 'prepared') => ({ phase, queryId: 'q-1', requestSha256: 'a'.repeat(64), conversationVersion: 2,
  exactMemoryContext: '[{"role":"system","content":"Quoted text: <script>literal</script>"}]', memoryContextComplete: true,
  exactMessages: [{ role: 'system', content: 'Quoted text: <script>literal</script>' }, { role: 'user', content: 'Where is the compass?' }], complete: true,
  admitted: [row], candidates: [{ ...row, admitted: false, admissionReason: 'Not included in this fixture request.' }],
  candidateCoverage: 'Supplied core-returned hits only; not all indexed documents.' });
const snapshot = extra => ({ schema: 'memory-context-inspection/v1', ephemeral: true, phase: 'prepared', latestPrepared: record(), lastSubmitted: null, error: null, ...extra });

test('empty, preparing, failed, and cancelled inspection never fabricate request text or sources', () => {
  for (const phase of ['unmeasured', 'preparing', 'error', 'cancelled']) {
    const view = contextInspectionView(snapshot({ phase, latestPrepared: null }));
    assert.equal(view.record, null); assert.deepEqual(view.admitted, []); assert.deepEqual(view.candidates, []);
    assert.equal(view.exactMemoryContext, null); assert.equal(view.exactMessages, null);
    assert.doesNotMatch(view.state, /^Submitted/);
  }
  assert.match(contextInspectionView(snapshot({ phase: 'preparing', latestPrepared: null })).state, /Nothing has been submitted/);
});

test('prepared, stale, cancelled, and submitted records retain explicit admission and dispatch distinctions', () => {
  for (const phase of ['prepared', 'stale', 'cancelled']) {
    const view = contextInspectionView(snapshot({ latestPrepared: record(phase) }));
    assert.match(view.state, /not submitted/i); assert.equal(view.admissionLabel, 'Selected for prepared request');
  }
  const view = contextInspectionView(snapshot({ phase: 'submitted', latestPrepared: null, lastSubmitted: record('submitted') }));
  assert.equal(view.selected, 'submitted'); assert.match(view.state, /does not prove the model used/);
  assert.equal(view.admissionLabel, 'Included in submitted request');
});

test('request selection uses only offered prepared/submitted records', () => {
  const value = snapshot({ lastSubmitted: { ...record('submitted'), queryId: 'q-old' } });
  assert.equal(contextInspectionView(value).record.queryId, 'q-1');
  assert.equal(contextInspectionView(value, 'submitted').record.queryId, 'q-old');
  assert.deepEqual(contextInspectionView(value).choices.map(choice => choice.value), ['prepared', 'submitted']);
  assert.equal(contextInspectionView(snapshot(), 'submitted').selected, 'prepared');
});

test('upstream completeness flags control exact text; oversized data is unavailable rather than clipped', () => {
  const value = record();
  const view = contextInspectionView(snapshot({ latestPrepared: value }));
  assert.equal(view.exactMemoryContext, value.exactMemoryContext); assert.deepEqual(view.exactMessages, value.exactMessages);
  const unavailable = contextInspectionView(snapshot({ latestPrepared: { ...value, memoryContextComplete: false, complete: false,
    memoryContextUnavailableReason: 'Memory prefix exceeds 16 KiB.', unavailableReason: 'Full request exceeds 32 KiB.' } }));
  assert.equal(unavailable.exactMemoryContext, null); assert.equal(unavailable.exactMessages, null);
  assert.match(unavailable.memoryUnavailableReason, /16 KiB/); assert.match(unavailable.messagesUnavailableReason, /32 KiB/);
});

test('source totals and completeness remain separate from the retained row arrays', () => {
  const view = contextInspectionView(snapshot({ latestPrepared: { ...record(), admittedCount: 5, admittedComplete: false,
    candidateCount: 9, candidatesComplete: false } }));
  assert.equal(view.admittedCount, 5); assert.equal(view.admittedComplete, false); assert.equal(view.admitted.length, 1);
  assert.equal(view.candidateCount, 9); assert.equal(view.candidatesComplete, false); assert.equal(view.candidates.length, 1);
  const absent = contextInspectionView(snapshot());
  assert.equal(absent.admittedCount, null); assert.equal(absent.admittedComplete, null);
  assert.equal(absent.candidateCount, null); assert.equal(absent.candidatesComplete, null);
});

// Small DOM/event fixture for ownership and keyboard state, not browser visual proof.
class NodeFixture extends EventTarget {
  constructor(tag, ownerDocument) { super(); this.tagName = tag; this.ownerDocument = ownerDocument; this.attributes = new Map(); this.childNodes = []; this.hidden = false; this.value = ''; this._text = ''; }
  setAttribute(key, value) { this.attributes.set(key, String(value)); if (key === 'tabindex') this.tabIndex = Number(value); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  set textContent(value) { this._text = String(value); this.childNodes = []; }
  get textContent() { return this._text + this.childNodes.map(node => node.textContent).join(''); }
  append(...nodes) { this.childNodes.push(...nodes); }
  replaceChildren(...nodes) { this._text = ''; this.childNodes = [...nodes]; }
  focus() { this.ownerDocument.activeElement = this; }
  remove() { this.removed = true; }
}
const walk = node => [node, ...node.childNodes.flatMap(walk)];
const byId = (inspector, id) => [...walk(inspector.tabs), ...walk(inspector.panel)].find(node => node.getAttribute('id') === id);
function uiFixture(initial = snapshot()) {
  const doc = { activeElement: null, createElement(tag) { return new NodeFixture(tag, doc); } };
  let current = initial, observer, unsubscribed = false;
  const changes = [];
  const inspector = createContextInspector({ document: doc,
    context: { inspectionSnapshot: () => current, subscribeInspection(fn) { observer = fn; return () => { observer = undefined; unsubscribed = true; }; } },
    onViewChange: view => changes.push(view) });
  return { inspector, doc, changes, get unsubscribed() { return unsubscribed; }, emit(value) { current = value; observer?.(value); } };
}
function key(target, value) { const event = new Event('keydown', { cancelable: true }); Object.defineProperty(event, 'key', { value }); target.dispatchEvent(event); return event; }

test('Graph defaults and native tab keyboard navigation expose one active tab with correct controls', () => {
  const { inspector, doc, changes } = uiFixture();
  const graph = byId(inspector, 'memory-graph-tab'), context = byId(inspector, 'memory-context-tab');
  assert.equal(inspector.selectedTab, 'graph'); assert.equal(inspector.panel.hidden, true);
  assert.equal(graph.getAttribute('aria-controls'), 'memory-graph-view'); assert.equal(context.getAttribute('aria-controls'), 'memory-context-view');
  assert.equal(key(inspector.tabs, 'ArrowRight').defaultPrevented, true);
  assert.equal(inspector.selectedTab, 'context'); assert.equal(inspector.panel.hidden, false); assert.equal(doc.activeElement, context);
  assert.equal(context.getAttribute('aria-selected'), 'true'); assert.equal(context.tabIndex, 0); assert.equal(graph.tabIndex, -1);
  key(inspector.tabs, 'ArrowLeft'); assert.equal(doc.activeElement, graph);
  key(inspector.tabs, 'End'); assert.equal(inspector.selectedTab, 'context');
  key(inspector.tabs, 'Home'); assert.equal(inspector.selectedTab, 'graph');
  context.dispatchEvent(new Event('click')); assert.equal(inspector.selectedTab, 'context');
  inspector.showGraph(); assert.equal(inspector.selectedTab, 'graph'); assert.equal(changes.at(-1), 'graph');
  inspector.dispose();
});

test('inspection text stays literal, missing scores are not invented, and subscription disposal releases the view', () => {
  const fixture = uiFixture(); const { inspector } = fixture;
  assert.ok(inspector.panel.textContent.includes(record().exactMemoryContext));
  assert.equal(walk(inspector.panel).some(node => node.tagName === 'script'), false, 'source text is never interpreted as markup');
  assert.doesNotMatch(inspector.panel.textContent, /Retrieval score \(micro units\)|Keyword score \(micro units\)|Supplied reasons/);
  assert.match(inspector.panel.textContent, /not all admitted/); assert.match(inspector.panel.textContent, /core-returned hits only/);
  fixture.emit(snapshot({ latestPrepared: { ...record(), admitted: [{ ...row, score_micro: 0, keyword_micro: 48000, reasons: ['Exact supplied component.'] }] } }));
  assert.match(inspector.panel.textContent, /Retrieval score \(micro units\)0/); assert.match(inspector.panel.textContent, /Keyword score \(micro units\)48000/);
  assert.match(inspector.panel.textContent, /Exact supplied component/);
  fixture.emit(snapshot({ latestPrepared: null, lastSubmitted: record('submitted'), phase: 'submitted' }));
  assert.equal(byId(inspector, 'memory-context-request').value, 'submitted');
  fixture.emit(snapshot({ latestPrepared: { ...record(), queryId: 'q-new' }, lastSubmitted: record('submitted') }));
  assert.equal(byId(inspector, 'memory-context-request').value, 'prepared', 'new preparation remains the default unless the user picks submitted');
  const choice = byId(inspector, 'memory-context-request'); choice.value = 'submitted'; choice.dispatchEvent(new Event('change'));
  assert.match(inspector.panel.textContent, /Included in submitted request/);
  inspector.dispose(); assert.equal(fixture.unsubscribed, true); assert.equal(inspector.tabs.removed, true); assert.equal(inspector.panel.removed, true);
  fixture.emit(snapshot({ phase: 'error', error: 'Late observer update' })); assert.doesNotMatch(inspector.panel.textContent, /Late observer update/);
});

test('bounded source lists visibly distinguish retained details, omitted-all, and genuine zero', () => {
  const fixture = uiFixture(snapshot({ latestPrepared: { ...record(), admittedCount: 5, admittedComplete: false,
    candidateCount: 9, candidatesComplete: false } }));
  const { inspector } = fixture;
  assert.match(inspector.panel.textContent, /1 of 5 admitted rows retained/);
  assert.match(inspector.panel.textContent, /1 of 9 candidate rows retained/);
  assert.match(inspector.panel.textContent, /Some source details were omitted/);
  fixture.emit(snapshot({ latestPrepared: { ...record(), admitted: [], candidates: [], admittedCount: 5, admittedComplete: false,
    candidateCount: 9, candidatesComplete: false } }));
  assert.match(inspector.panel.textContent, /0 of 5 admitted rows retained/);
  assert.match(inspector.panel.textContent, /0 of 9 candidate rows retained/);
  assert.match(inspector.panel.textContent, /All source details were omitted/);
  assert.doesNotMatch(inspector.panel.textContent, /No admitted sources were recorded|No candidate sources were recorded/);
  const warnings = walk(inspector.panel).filter(node => node.tagName === 'p' && /All source details were omitted/.test(node.textContent));
  assert.equal(warnings.length, 2); assert.ok(warnings.every(node => !node.hidden));
  fixture.emit(snapshot({ latestPrepared: { ...record(), admitted: [], candidates: [], admittedCount: 0, admittedComplete: true,
    candidateCount: 0, candidatesComplete: true } }));
  assert.match(inspector.panel.textContent, /No admitted sources were recorded/);
  assert.match(inspector.panel.textContent, /No candidate sources were recorded/);
  assert.doesNotMatch(inspector.panel.textContent, /source details were omitted/);
  fixture.emit(snapshot({ latestPrepared: { ...record(), admitted: [], candidates: [], admittedComplete: false, candidatesComplete: false } }));
  assert.match(inspector.panel.textContent, /0 admitted rows retained; total count was not supplied/);
  assert.doesNotMatch(inspector.panel.textContent, /0 of 0/);
  inspector.dispose();
});
