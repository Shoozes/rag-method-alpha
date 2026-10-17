import { mountMemoryNavigation } from './navigation.mjs';
import { createCompactionCue } from './compaction-cue.mjs';
import { createContextInspector } from './context-panel.mjs';
import { createSummaryEffects } from './summary-effects.mjs';

export const MEMORY_SCOPE_COLORS = Object.freeze({ conversation: '#0ea5ff', persona: '#c81fff', global: '#f59e0b' });
export function memoryScopeColor(scope) {
  const color = Object.hasOwn(MEMORY_SCOPE_COLORS, scope) ? MEMORY_SCOPE_COLORS[scope] : undefined;
  return color === undefined ? undefined : Number.parseInt(color.slice(1), 16);
}

/** A checked no-change result is different from a failed context operation. */
export function manualCompactionFailureView(error) {
  if (error?.name === 'AbortError') return { message: 'Compaction cancelled. Prior context and originals kept.', error: false };
  if (error?.code === 'MANUAL_COMPACTION_NO_SOURCE_CONTEXT') return {
    message: 'Nothing changed. No new older user excerpt was selected for your latest message. Recent messages and originals are kept.', error: false,
  };
  if (error?.code === 'MANUAL_COMPACTION_NO_REDUCTION') {
    const check = error.compactionCheck;
    const counted = Number.isSafeInteger(check?.beforePromptTokens) && check.beforePromptTokens > 0
      && Number.isSafeInteger(check.afterPromptTokens) && check.afterPromptTokens >= check.beforePromptTokens;
    const counts = counted ? ' The summary would use ' + check.afterPromptTokens.toLocaleString('en-US')
      + ' prompt tokens versus ' + check.beforePromptTokens.toLocaleString('en-US') + ' now.' : '';
    return { message: 'Nothing changed. A source-linked summary would not reduce this conversation.' + counts
      + ' Recent messages and originals are kept.', error: false };
  }
  const detail = typeof error?.message === 'string' ? error.message.slice(0, 180) : 'The context operation could not finish.';
  return { message: 'Compaction did not finish. ' + detail, error: true };
}

/** Only the inspected dispatched request can authorize a last-request source cue. */
export function submittedMemoryNodeIds(snapshot, requestSha256, currentScope) {
  const request = snapshot?.lastSubmitted;
  if (!requestSha256 || request?.requestSha256 !== requestSha256 || !Array.isArray(request.admitted)) return [];
  if (currentScope && ['actorId', 'conversationId'].some(key => request.scope?.[key] !== currentScope[key])) return [];
  const localSource = row => {
    const owner = request.scope, origin = row?.provenance?.origin;
    if (!owner?.actorId || !owner?.conversationId) return false;
    // Saved evidence is retrieved within the request's canonical conversation.
    // Persona turn IDs are local to their origin conversation and can collide.
    return origin ? origin.actorId === owner.actorId && origin.conversationId === owner.conversationId
      : row?.scope === 'conversation' && row?.kind === 'saved';
  };
  return [...new Set(request.admitted.flatMap(row => row?.admitted === false ? [] : [row?.nodeId,
    ...(localSource(row) && Array.isArray(row?.sourceTurnIds) ? row.sourceTurnIds.filter(id => typeof id === 'string').map(id => 'turn:' + id) : [])])
    .filter(id => typeof id === 'string' && id.length > 0))];
}

/** A retained output is a display projection, never another retrieval record. */
export function projectConversationSummary(base, summary) {
  if (!summary || summary.kind !== 'summary' || summary.scope !== 'conversation' || summary.derived !== true
    || summary.id !== 'summary:' + summary.eventId || !Array.isArray(summary.sourceTurnIds) || !summary.sourceTurnIds.length) return base;
  const sources = new Set(summary.sourceTurnIds.map(id => 'turn:' + id));
  const ordered = [...base.nodes.filter(node => sources.has(node.id)), ...base.nodes.filter(node => !sources.has(node.id))];
  const nodes = [summary, ...ordered].slice(0, 12), ids = new Set(nodes.map(node => node.id));
  const links = [...base.links.filter(link => ids.has(link.source) && ids.has(link.target)),
    ...nodes.filter(node => sources.has(node.id)).map(node => ({ id: JSON.stringify([node.id, summary.id]),
      source: node.id, target: summary.id, kind: 'retained-excerpt' }))];
  return { ...base, nodes, links };
}

/** Only the exact retained body in an actual submitted request can light its summary node. */
export function submittedSummaryNodeIds(snapshot, requestSha256, owner, summary) {
  const record = snapshot?.lastSubmitted;
  return summary?.kind === 'summary' && requestSha256 && record?.requestSha256 === requestSha256
    && owner && ['actorId', 'conversationId'].every(key => owner[key] === record.scope?.[key])
    && Array.isArray(record.exactMessages) && record.exactMessages.some(message => message.role === 'system' && message.content === summary.text)
    ? [summary.id] : [];
}

/** Real saved memories and their cited user messages; bounded view, no admission. */
export function projectMemoryMap({ active, turns, graphData, preferredRecordIds = [], limit = 6 }) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 6) throw RangeError('Memory map admits at most six current records.');
  const records = new Map(active.map(item => [item.id, item]));
  const originals = new Map(turns.filter(turn => turn.role === 'user').map(turn => [turn.id, turn]));
  const actual = graphData ? new Set(graphData.nodes.map(node => node.id)) : null;
  const ordered = [...new Set([...preferredRecordIds, ...active.slice().reverse().map(item => item.id)])]
    .map(id => records.get(id)).filter(item => item && (!actual || actual.has('record:' + item.id))).slice(0, limit);
  const nodes = [], links = [], sources = new Set();
  const excerpt = value => { const words = value.replace(/\s+/gu, ' ').trim(); return [...words].slice(0, 58).join('') + ([...words].length > 58 ? '…' : ''); };
  for (const item of ordered) {
    const id = 'record:' + item.id;
    nodes.push({ id, kind: 'record', recordId: item.id, version: item.version, label: excerpt(item.text) });
    const sourceId = item.sourceTurnIds.find(source => originals.has(source) && (!actual || actual.has('turn:' + source)));
    if (!sourceId) continue;
    const target = 'turn:' + sourceId;
    if (!sources.has(target)) { nodes.push({ id: target, kind: 'source', sourceTurnId: sourceId, label: 'From chat' }); sources.add(target); }
    const recordEvents = graphData?.links.filter(link => link.target === id).map(link => link.source);
    if (!graphData || graphData.links.some(link => recordEvents.includes(link.source) && link.target === target)) {
      links.push({ id: JSON.stringify([id, target]), source: id, target, kind: 'source' });
    }
  }
  return { nodes, links };
}

/** Storage and retrieval retain authority; this view owns only presentation. */
export function mountMemoryPanel({ conversation, memory, retrieval, events, graph, automaticMemory, context, onChange, rendererBackend = 'auto' } = {}) {
  if (!['auto', 'webgl2'].includes(rendererBackend)) throw Error('Unsupported memory graph backend.');
  const doc = document, options = doc.getElementById('chat-options');
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  if (!options?.parentElement || doc.getElementById('memory-dialog')) throw Error('Memory needs an unmounted chat header.');
  const listeners = new AbortController();
  const listen = (node, type, callback) => node.addEventListener(type, callback, { signal: listeners.signal });
  const el = (tag, value, attrs = {}) => {
    const node = doc.createElement(tag); if (value !== undefined) node.textContent = value;
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  };
  const control = (value, id) => el('button', value, { type: 'button', id, class: 'secondary' });
  const field = (label, node) => { const wrapper = el('label', undefined, { class: 'memory-field' }); wrapper.append(el('span', label), node); return wrapper; };
  const stylesheet = doc.getElementById('memory-panel-style') ? null : el('link', undefined, {
    id: 'memory-panel-style', rel: 'stylesheet', href: new URL('./panel.css', import.meta.url).href,
  });
  if (stylesheet) doc.head.append(stylesheet);
  const button = control('Memory', 'memory-open'); button.classList.add('memory-open');
  button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-controls', 'memory-dialog'); options.before(button);
  const dialog = el('dialog', undefined, { id: 'memory-dialog', class: 'memory-dialog', 'aria-labelledby': 'memory-title' });
  for (const [scope, color] of Object.entries(MEMORY_SCOPE_COLORS)) dialog.style.setProperty('--memory-scope-' + scope, color);
  const header = el('header', undefined, { class: 'memory-panel-header' });
  const back = control('Back', 'memory-back'), fit = control('Fit', 'memory-fit'), expand = control('⤢', 'memory-expand'), close = control('Chat', 'memory-close'); back.hidden = true; fit.hidden = true;
  expand.setAttribute('aria-label', 'Expand Memory'); expand.setAttribute('aria-expanded', 'false'); expand.title = 'Expand Memory';
  close.setAttribute('aria-label', 'Back to chat'); close.title = 'Back to chat';
  fit.setAttribute('aria-label', 'Fit memory graph');
  const title = el('h2', 'Memory', { id: 'memory-title' }); header.append(back, title, fit, expand, close);
  const body = el('div', undefined, { class: 'memory-panel-body' });
  const searchForm = el('form', undefined, { id: 'memory-recall-form', class: 'memory-search-form' });
  const query = el('input', undefined, { id: 'memory-query', type: 'search', maxlength: '1024', placeholder: automaticMemory ? 'Search memory' : 'Search saved words', 'aria-label': automaticMemory ? 'Search memory' : 'Search saved words', enterkeyhint: 'search' });
  const pocket = el('select', undefined, { id: 'memory-pocket', 'aria-label': 'Memory pocket' });
  for (const [value, label] of [['all', 'All pockets'], ['global', 'Global'], ['persona', 'Persona'], ['conversation', 'Conversation']]) pocket.append(el('option', label, { value }));
  pocket.hidden = !automaticMemory;
  const clear = control('×', 'memory-query-clear'); clear.setAttribute('aria-label', 'Clear search'); clear.hidden = true;
  const recall = control('Search', 'memory-recall'); recall.type = 'submit'; searchForm.append(pocket, query, clear, recall);
  recall.title = 'Find memories in this graph. Searching does not send a model request.';
  query.title = recall.title;
  const searchSummary = el('p', '', { id: 'memory-search-summary', class: 'memory-search-summary', role: 'status', 'aria-live': 'polite' }); searchSummary.hidden = true;
  const map = el('div', undefined, { class: 'memory-map' });
  const picture = el('div', undefined, { id: 'memory-graph', class: 'memory-graph', 'aria-label': automaticMemory ? 'Memory from your active pockets' : 'Saved memories and their sources' });
  const canvas = el('canvas', undefined, { class: 'memory-canvas', 'aria-hidden': 'true', draggable: 'false' }); canvas.hidden = true;
  const empty = el('p', 'No saved memories yet.', { class: 'memory-empty' }); picture.append(canvas, empty); map.append(picture);
  const compactionNote = el('p', '', { class: 'memory-compaction-cue', role: 'status', 'aria-live': 'polite' }); compactionNote.hidden = true; map.append(compactionNote);
  const detail = el('section', undefined, { id: 'memory-detail', class: 'memory-detail', 'aria-labelledby': 'memory-detail-title' }); detail.hidden = true;
  const preview = el('section', undefined, { id: 'memory-node-preview', class: 'memory-node-preview', role: 'tooltip' }); preview.hidden = true;
  const previewTitle = el('strong'), previewText = el('p'), previewSource = el('small'); preview.append(previewTitle, previewText, previewSource); map.append(preview);
  const detailTitle = el('h3', 'Saved words', { id: 'memory-detail-title', tabindex: '-1' });
  const detailProvenance = el('p', '', { id: 'memory-detail-provenance', class: 'memory-note' }); detailProvenance.hidden = true;
  const detailText = el('p', '', { id: 'memory-detail-text', class: 'memory-record-text' });
  const summaryExact = el('details', undefined, { id: 'memory-summary-exact', class: 'memory-summary-exact' }); summaryExact.hidden = true;
  const summaryExactText = el('pre', '', { id: 'memory-summary-exact-text' });
  summaryExact.append(el('summary', 'Exact retained context'), summaryExactText);
  const detailSources = el('div', undefined, { id: 'memory-detail-sources', class: 'memory-sources' });
  const edit = control('Edit', 'memory-edit'), forget = control('Forget saved record', 'memory-forget'), remember = control('Remember for persona', 'memory-remember-persona'); remember.hidden = true;
  const forgetHint = el('p', 'Forgetting a saved record does not erase the transcript or other messages that repeat it.', { id: 'memory-forget-hint', class: 'memory-note' });
  forget.setAttribute('aria-describedby', 'memory-forget-hint');
  const detailActions = el('div', undefined, { class: 'memory-actions' }); detailActions.append(remember, edit, forget);
  detail.append(detailTitle, detailProvenance, detailText, summaryExact, detailSources, detailActions, forgetHint); map.append(detail);
  const editor = el('section', undefined, { id: 'memory-editor', class: 'memory-editor', 'aria-label': 'Save exact words from your chat' }); editor.hidden = true;
  const source = el('select', undefined, { id: 'memory-source-turn' });
  const text = el('textarea', undefined, { id: 'memory-text', rows: '5', maxlength: '4000', 'aria-describedby': 'memory-source-hint' });
  const hint = el('p', 'Keep all or part of the exact words in your message.', { id: 'memory-source-hint', class: 'memory-note' });
  const save = control('Save', 'memory-save'), correct = control('Save correction', 'memory-correct'), cancel = control('Cancel', 'memory-cancel');
  const editorActions = el('div', undefined, { class: 'memory-actions' }); editorActions.append(save, correct, cancel);
  editor.append(field('From your chat', source), field('Exact words', text), hint, editorActions);
  const add = control('Save from chat', 'memory-add'); add.classList.add('memory-add');
  const savedWords = control('Saved words', 'memory-saved-words'); savedWords.hidden = true;
  const footer = el('div', undefined, { class: 'memory-footer' }); footer.append(add, savedWords);
  const compact = control('Compact now', 'memory-compact-now'), compactCancel = control('Cancel', 'memory-compact-cancel'); compactCancel.hidden = true;
  const openSummary = control('View summary', 'memory-open-summary'); openSummary.hidden = true;
  openSummary.setAttribute('aria-controls', 'memory-detail');
  const compactNote = el('p', '', { id: 'memory-compact-status', class: 'memory-note', role: 'status', 'aria-live': 'polite' });
  compact.setAttribute('aria-describedby', 'memory-compact-status');
  const compactTools = el('div', undefined, { class: 'memory-compact-tools' }); compactTools.append(openSummary, compact, compactCancel, compactNote);
  compactTools.hidden = typeof context?.compactNow !== 'function'; footer.append(compactTools);
  const legend = el('div', undefined, { class: 'memory-scope-legend', role: 'list', 'aria-label': 'Memory scopes' }); legend.hidden = !automaticMemory;
  for (const [scope] of Object.entries(MEMORY_SCOPE_COLORS)) {
    const label = el('span', scope[0].toUpperCase() + scope.slice(1), { role: 'listitem' });
    label.style.setProperty('--memory-node-color', 'var(--memory-scope-' + scope + ')'); legend.append(label);
  }
  const status = el('p', '', { id: 'memory-status', role: 'status', 'aria-live': 'polite' });
  const graphRegion = el('section', undefined, { id: 'memory-graph-view', class: 'memory-graph-view', role: 'tabpanel', 'aria-labelledby': 'memory-graph-tab' });
  graphRegion.append(searchForm, searchSummary, legend, map, editor, status, footer);
  body.append(graphRegion); dialog.append(header, body); doc.body.append(dialog);

  let disposed = false, busy = false, hits = null, sequence = 0, selected = null, editRecord = null, skipFocusReturn = false;
  let renderer = null, rendererModule = null, rendererPromise = null, rendererGeneration = 0, topology = '', currentMap = { nodes: [], links: [] }, expandFrame = 0, viewFrame = 0;
  let legacyView = false, suspendedCamera = null;
  let searchTimer = 0, searchEpoch = 0, searching = false, searchBinding = null, pendingSearchFit = false, previewNodeId = null;
  let compactController = null, compactMessage = '', manualCueNodeIds = [], lastDispatchSha256 = null;
  const nodeButtons = new Map();
  const compactionCue = createCompactionCue(events.list());
  const summaryEffects = createSummaryEffects({ container: picture, getTargets: () => renderer?.diagnostics().node_targets ?? [],
    getMotionEnabled: () => !motionPreference.matches, initialEventIds: events.list().filter(event => event.type === 'compacted').map(event => event.id) });
  let pendingCompactionCue = null, compactionTimer = 0, requestHighlightTimer = 0, requestHighlightUntil = 0;
  const stopCompactionAnimation = () => { summaryEffects.stop(); for (const target of nodeButtons.values()) target.classList.remove('is-compaction-source'); };
  function cancelCompactionCue() {
    clearTimeout(compactionTimer); compactionTimer = 0; pendingCompactionCue = null; stopCompactionAnimation();
    compactionNote.hidden = true; compactionNote.textContent = ''; delete compactionNote.dataset.eventId;
  }
  function playCompactionCue() {
    if (!pendingCompactionCue || compactionTimer || !dialog.open || graphRegion.hidden || !isAutomaticView() || !editor.hidden || !detail.hidden) return;
    if (picture.dataset.renderer === 'loading') return;
    const cue = pendingCompactionCue, summary = context.summarySnapshot?.();
    const actualSummary = summary && cue.eventIds.includes(summary.eventId) && currentMap.nodes.some(node => node.id === summary.id);
    if (actualSummary && renderer && !renderer.diagnostics().node_targets.some(target => target.node_id === summary.id && target.visible)) return;
    pendingCompactionCue = null;
    compactionNote.textContent = actualSummary ? 'Conversation summary ready · ' + summary.sourceTurnIds.length + ' authored sources. Originals kept.' : cue.message;
    compactionNote.dataset.eventId = cue.eventIds.at(-1); compactionNote.hidden = false;
    if (actualSummary && renderer) summaryEffects.play({ eventId: summary.eventId,
      sourceNodeIds: summary.sourceTurnIds.map(id => 'turn:' + id), targetNodeId: summary.id });
    compactionTimer = setTimeout(cancelCompactionCue, cue.durationMs);
  }
  const snapshot = () => conversation.snapshot();
  const scope = () => { const value = snapshot(); return { actorId: value.actorId, conversationId: value.conversationId }; };
  const active = () => memory.active(scope());
  const userTurns = () => snapshot().turns.filter(turn => turn.role === 'user');
  const selectedSource = () => userTurns().find(turn => turn.id === source.value);
  const selectedRecord = () => selected?.kind === 'record' ? active().find(item => item.id === selected.recordId) : null;
  const isAutomaticView = () => Boolean(automaticMemory && !legacyView);
  const navigation = mountMemoryNavigation({ surface: picture, getMotionEnabled: () => !motionPreference.matches,
    getRenderer: () => dialog.open && !graphRegion.hidden && editor.hidden && detail.hidden && picture.dataset.renderer === 'tsl' ? renderer : null });
  const inspector = createContextInspector({ context, document: doc, graphPanelId: graphRegion.id, onViewChange: view => {
    cancelCompactionCue(); navigation.cancel(); graphRegion.hidden = view !== 'graph';
    if (view !== 'graph') stopRenderer(true);
    if (viewFrame) cancelAnimationFrame(viewFrame);
    viewFrame = requestAnimationFrame(() => { viewFrame = 0; if (!disposed && dialog.open) { if (view === 'graph') drawMap(); buttons(); } });
  } });
  body.prepend(inspector.tabs); body.append(inspector.panel);
  const autoSnapshot = () => projectConversationSummary(automaticMemory.snapshot({ preferredNodeIds: hits?.map(hit => hit.nodeId) ?? manualCueNodeIds, limit: 12 }), context.summarySnapshot?.());
  const setStatus = (value, error = false) => { status.textContent = value; status.classList.toggle('memory-error', error); status.setAttribute('role', error ? 'alert' : 'status'); status.hidden = !value; };
  const errorText = error => typeof error?.message === 'string' ? error.message.slice(0, 180) : 'The memory operation could not finish.';
  const currentSearchBinding = () => JSON.stringify([isAutomaticView(), scope(), snapshot().version,
    automaticMemory?.identity(), memory.snapshot().records]);
  const setSearchSummary = value => { searchSummary.textContent = value; searchSummary.hidden = !value; };
  function hidePreview() {
    preview.hidden = true; previewNodeId = null;
    for (const target of nodeButtons.values()) target.removeAttribute('aria-describedby');
  }
  function showPreview(node) {
    if (selected || !node || !dialog.open || !editor.hidden) return;
    previewNodeId = node.id;
    const scopeLabel = node.scope ? node.scope[0].toUpperCase() + node.scope.slice(1) : 'Saved words';
    previewTitle.textContent = scopeLabel + ' · ' + (node.kind === 'summary' ? 'Retained summary' : node.role === 'assistant' ? 'Assistant · generated' : node.kind === 'global' ? 'Public starter' : 'Your words');
    const previewContent = node.kind === 'summary' ? node.items.map(item => item.quote).join('\n\n') : hits?.find(hit => hit.nodeId === node.id)?.text ?? node.text ?? node.label;
    previewText.textContent = [...previewContent].slice(0, 240).join('');
    const origin = node.provenance?.origin;
    previewSource.textContent = node.kind === 'summary' ? node.sourceTurnIds.length + ' authored sources · derived excerpts' : node.kind === 'global' ? node.sourceTitle ?? 'NASA source' : origin?.conversationId && origin?.turnId
      ? 'Source ' + origin.conversationId + ' / ' + origin.turnId : 'Source ' + (node.turnId ?? node.sourceTurnId ?? node.recordId ?? node.id);
    preview.hidden = false;
    nodeButtons.get(node.id)?.setAttribute('aria-describedby', preview.id);
  }
  function updateCompactControls() {
    if (compactTools.hidden) return;
    const state = context.manualCompactionStatus();
    compact.disabled = busy || searching || Boolean(compactController) || state.busy;
    compact.setAttribute('aria-disabled', String(compact.disabled || !state.eligible));
    openSummary.hidden = !context.summarySnapshot?.();
    openSummary.disabled = busy || Boolean(compactController);
    compactCancel.hidden = !compactController;
    compactCancel.disabled = !compactController || compactController.signal.aborted;
    const reason = { ready: 'Check whether older context can be reduced; recent messages and originals stay intact.',
      'model-not-ready': 'Load the model before compacting context.', unavailable: 'Manual compaction is unavailable.',
      busy: 'Wait for the active reply or context operation.', empty: 'No conversation to compact.',
      'insufficient-history': 'More eligible older history is needed; the recent exchange is protected.',
      'policy-refresh': 'Memory rules changed. Send a message to refresh checked context before compacting.',
      'scope-disabled': 'Select All pockets or Conversation to compact older context.', disposed: 'This workspace is closed.' };
    const readiness = reason[state.reason] || 'Manual compaction is unavailable.';
    compact.title = state.eligible ? 'Check older excerpts for a smaller prompt. No messages are sent or deleted.' : readiness + ' Select for an explanation.';
    compactNote.textContent = compactController ? 'Compacting context…'
      : compactMessage ? compactMessage + (state.eligible ? '' : ' ' + readiness) : readiness;
  }
  function buttons() {
    const authored = selectedSource(), valid = Boolean(authored && text.value.length && text.value.length <= 4000 && authored.content.includes(text.value));
    save.disabled = busy || !valid; correct.disabled = busy || !valid || !editRecord;
    for (const node of [source, text, query, recall, clear, add, edit, forget, remember, savedWords, pocket, cancel, back, fit]) node.disabled = busy;
    recall.disabled = busy || searching || !query.value.trim(); clear.hidden = !query.value;
    add.hidden = !editor.hidden || selected !== null || userTurns().length === 0;
    savedWords.hidden = !automaticMemory || legacyView || !editor.hidden || selected !== null || active().length === 0;
    pocket.hidden = !isAutomaticView();
    legend.hidden = !isAutomaticView() || !editor.hidden;
    fit.hidden = graphRegion.hidden || !renderer || !detail.hidden || !editor.hidden;
    searchForm.classList.toggle('has-pockets', isAutomaticView());
    updateCompactControls();
  }
  function sourceLinks(ids) {
    detailSources.replaceChildren();
    for (const id of ids) detailSources.append(el('a', 'Open in chat', { href: '#turn-' + id, 'data-memory-source': id }));
  }
  function matchingNodeIds() {
    if (isAutomaticView()) return (hits ? hits.map(hit => hit.nodeId) : !query.value.trim() && Date.now() < requestHighlightUntil
      ? [...submittedMemoryNodeIds(context.inspectionSnapshot(), lastDispatchSha256, scope()),
        ...submittedSummaryNodeIds(context.inspectionSnapshot(), lastDispatchSha256, scope(), context.summarySnapshot?.())] : []).filter(id => currentMap.nodes.some(node => node.id === id));
    if (!hits) return [];
    const current = new Map(active().map(item => [item.id, item]));
    return hits.filter(hit => current.get(hit.recordId)?.version === hit.version)
      .flatMap(hit => ['record:' + hit.recordId, ...hit.sourceTurnIds.map(id => 'turn:' + id)])
      .filter(id => currentMap.nodes.some(node => node.id === id));
  }
  function showDetail(node, focus = false) {
    hidePreview();
    cancelCompactionCue();
    navigation.cancel();
    const previousSummary = detail.dataset.summaryHash;
    selected = node; editor.hidden = true; map.hidden = false; searchForm.hidden = false; detail.hidden = !node;
    if (node?.kind !== 'summary') { summaryExact.hidden = true; summaryExact.open = false; summaryExactText.textContent = ''; delete detail.dataset.summaryHash; }
    back.hidden = !node && !legacyView; title.textContent = legacyView ? 'Saved words' : 'Memory'; editRecord = null;
    detailProvenance.hidden = !node || !isAutomaticView(); remember.hidden = true;
    if (node) {
      if (isAutomaticView()) {
        const current = currentMap.nodes.find(item => item.id === node.id);
        if (!current) { showDetail(null); return; }
        selected = current;
        if (current.kind === 'summary') {
          detailTitle.textContent = 'Conversation summary';
          detailProvenance.textContent = 'Retained excerpts · Current conversation · ' + current.sourceTurnIds.length + ' authored sources. Derived context, not a Persona memory.';
          if (submittedSummaryNodeIds(context.inspectionSnapshot(), lastDispatchSha256, scope(), current).length) detailProvenance.textContent += ' This exact summary was included in the last submitted request.';
          detailText.textContent = current.items.map(item => item.quote).join('\n\n'); detail.dataset.summaryHash = current.summaryHash;
          if (previousSummary !== current.summaryHash) summaryExact.open = false;
          summaryExact.hidden = false; summaryExactText.textContent = current.text;
          sourceLinks(current.sourceTurnIds);
          for (const anchor of detailSources.querySelectorAll('[data-memory-source]')) anchor.textContent = 'Source ' + anchor.dataset.memorySource + ' · Open in chat';
          edit.hidden = true; forget.hidden = true; remember.hidden = true; forgetHint.hidden = false;
          forgetHint.textContent = 'Originals stay in Conversation. Forget an original source to exclude it from retained context. Later requests select context again; this node records the committed output.';
        } else {
        delete detail.dataset.summaryHash;
        detailTitle.textContent = current.kind === 'global' ? 'Space starter · Global' : current.role === 'assistant' ? 'Assistant · generated' : current.scope === 'persona' ? 'Your words · Persona' : 'Your message';
        detailProvenance.textContent = current.kind === 'global' ? 'Shared starter knowledge · NASA source' : (current.role === 'assistant' ? 'Generated text · ' : 'Exact source words · ') + (current.scope === 'persona' ? 'Current persona' : 'Current conversation');
        const origin = current.provenance?.origin;
        if (current.scope === 'persona' && origin?.conversationId && origin?.turnId) detailProvenance.textContent += ' · Source ' + origin.conversationId + '/' + origin.turnId;
        if (submittedMemoryNodeIds(context.inspectionSnapshot(), lastDispatchSha256, scope()).includes(current.id)) detailProvenance.textContent += ' · Source included in last submitted request';
        const original = current.kind === 'message' ? snapshot().turns.find(turn => turn.id === current.turnId && turn.role === current.role) : null;
        detailText.textContent = original?.content ?? current.text; sourceLinks(current.turnId ? [current.turnId] : []);
        const sourceUrl = current.sourceUrl ?? current.sourceURL;
        if (sourceUrl) {
          // Only ordinary HTTPS sources from the data port become clickable links.
          try { const url = new URL(sourceUrl); if (url.protocol === 'https:') detailSources.append(el('a', 'Open source', { href: url.href, target: '_blank', rel: 'noopener noreferrer', title: current.sourceTitle ?? 'Source' })); } catch { /* The exact text remains available. */ }
        }
        edit.hidden = true; forget.hidden = false; forgetHint.hidden = false;
        forget.textContent = current.kind === 'global' ? 'Remove starter' : current.scope === 'persona' ? 'Forget persona memory' : 'Forget from memory';
        forgetHint.textContent = current.kind === 'global' ? 'Removes this starter from your local memory pockets.' : current.scope === 'persona' ? 'Removes this persona memory. Your original message stays in chat.' : 'Excludes this message from memory and retrieval. The original message stays in chat.';
        remember.hidden = current.kind !== 'message' || current.role !== 'user' || !current.turnId;
        }
      } else {
      const record = node.kind === 'record' ? active().find(item => item.id === node.recordId) : null;
      const original = node.kind === 'source' ? userTurns().find(turn => turn.id === node.sourceTurnId) : null;
      if (!record && !original) { selected = null; detail.hidden = true; back.hidden = true; query.focus(); return; }
      detailTitle.textContent = record ? 'Saved words' : 'From your chat'; detailText.textContent = record?.text ?? original.content;
      sourceLinks(record?.sourceTurnIds ?? [original.id]); edit.hidden = !record; forget.hidden = !record; forgetHint.hidden = !record;
      forget.textContent = 'Forget saved record'; forgetHint.textContent = 'Forgetting a saved record does not erase the transcript or other messages that repeat it.';
      }
      if (focus) detailTitle.focus({ preventScroll: true });
    }
    for (const [id, target] of nodeButtons) target.setAttribute('aria-pressed', String(selected?.id === id));
    renderer?.setInteractionState(selected?.id ?? null, matchingNodeIds()); buttons();
  }
  function overlayPositions() {
    if (!renderer) return;
    const targets = renderer.diagnostics().node_targets;
    const order = new Map(targets.slice().sort((a, b) => (b.depth ?? 0) - (a.depth ?? 0)).map((target, index) => [target.node_id, index + 1]));
    for (const target of targets) {
      const node = nodeButtons.get(target.node_id); if (!node) continue;
      node.style.setProperty('--node-x', target.x + 'px'); node.style.setProperty('--node-y', target.y + 'px'); node.hidden = !target.visible;
      const size = Math.max(44, 2 * (target.radius_px ?? 16) + 8);
      node.style.setProperty('--node-size', size + 'px'); node.style.zIndex = String(order.get(target.node_id));
      if (node.hidden && previewNodeId === target.node_id) hidePreview();
    }
    playCompactionCue();
  }
  const renderAllowed = () => !disposed && dialog.open && !graphRegion.hidden && editor.hidden && doc.visibilityState !== 'hidden';
  const cameraMapKey = () => JSON.stringify([legacyView, scope(), automaticMemory?.getScope(),
    currentMap.nodes.map(node => node.id), currentMap.links.map(link => link.id)]);
  function stopRenderer(preserveCamera = false) {
    cancelCompactionCue();
    navigation.cancel(); fit.hidden = true;
    if (preserveCamera && renderer) suspendedCamera = { key: cameraMapKey(), pose: renderer.getCameraPose() };
    else if (!preserveCamera) suspendedCamera = null;
    ++rendererGeneration; renderer?.dispose(); renderer = null; topology = ''; canvas.hidden = true;
    // A stale constructor still owns this canvas until its public dispose runs.
    if (rendererPromise) picture.dataset.renderer = 'stopping';
    else if (preserveCamera) picture.dataset.renderer = 'suspended';
  }
  function fallback(reason = '') {
    navigation.cancel(); fit.hidden = true;
    renderer?.dispose(); renderer = null; topology = ''; canvas.hidden = true;
    picture.dataset.renderer = 'list'; picture.classList.add('is-fallback');
    for (const node of nodeButtons.values()) node.hidden = false;
    if (reason) setStatus(isAutomaticView() ? 'Graph unavailable. Your memory is still available below.' : 'Graph unavailable. Your saved words are still available.', true);
    playCompactionCue();
  }
  function drawRenderer() {
    if (!renderer || !rendererModule || !renderAllowed()) return;
    const width = Math.max(1, canvas.clientWidth), height = Math.max(1, canvas.clientHeight), count = currentMap.nodes.length;
    const aspect = Number((width / height).toFixed(2));
    canvas.dataset.memoryPacking = 'spatial';
    picture.dataset.presentation = 'spatial';
    const key = JSON.stringify({ nodes: currentMap.nodes, links: currentMap.links, aspect });
    if (topology !== key) {
      navigation.cancel();
      const data = { view: 'evidence', nodes: currentMap.nodes.map(node => ({ ...node, kind: node.kind === 'source' || node.kind === 'global' ? 'source' : 'chunk',
        record_id: node.recordId ?? null, source_id: node.turnId ?? node.sourceTurnId ?? node.recordId ?? node.id, path: 'memory/' + (node.recordId ?? node.sourceTurnId ?? node.id) })),
        links: currentMap.links, total_nodes: currentMap.nodes.length, total_links: currentMap.links.length, omitted_nodes: 0, omitted_links: 0 };
      const positioned = rendererModule.layoutMemoryGraph(data, hits?.map(hit => hit.recordId) ?? [], { aspect });
      const nodes = positioned.nodes;
      renderer.render({ ...positioned, nodes }); topology = key;
    }
    renderer.setInteractionState(selected?.id ?? null, matchingNodeIds()); renderer.refreshViewport(); overlayPositions();
  }
  async function ensureRenderer() {
    if (!graph || !renderAllowed() || !currentMap.nodes.length) return;
    if (renderer) { drawRenderer(); return; } if (rendererPromise) return;
    const generation = ++rendererGeneration; picture.dataset.renderer = 'loading'; picture.classList.add('is-fallback');
    const startup = (async () => {
      // Avoid starting Three with a null WebGL context on devices without a GPU.
      let backend = rendererBackend, hasWebGpu = false;
      if (backend === 'auto' && navigator.gpu) {
        try { hasWebGpu = Boolean(await navigator.gpu.requestAdapter()); } catch { /* Try the supported fallback below. */ }
      }
      if (!hasWebGpu) {
        const probe = doc.createElement('canvas'), context = probe.getContext('webgl2');
        if (!context) throw Error('No supported graph backend.');
        context.getExtension('WEBGL_lose_context')?.loseContext(); backend = 'webgl2';
      }
      const module = await import('./graph-renderer.mjs');
      if (generation !== rendererGeneration || !renderAllowed()) return;
      canvas.hidden = false;
      const value = await module.createTslRagGraphRenderer({ canvas, backend, onNodeActivate: id => {
        const node = currentMap.nodes.find(node => node.id === id); if (node) showDetail(node, true);
      }, nodeColor: id => memoryScopeColor(currentMap.nodes.find(node => node.id === id)?.scope), preserveNodeColors: true, nodeSurface: 'scope-colored', presentation: 'memory-spatial',
      onTerminalFailure: () => { if (generation === rendererGeneration && renderAllowed()) fallback('device unavailable'); } });
      if (generation !== rendererGeneration || !renderAllowed()) { value.dispose(); return; }
      renderer = value; rendererModule = module; renderer.setMotionEnabled(!motionPreference.matches);
      picture.dataset.renderer = 'tsl'; picture.dataset.backend = renderer.backend; picture.classList.remove('is-fallback'); drawRenderer();
      const restoreCamera = Boolean(suspendedCamera?.pose && suspendedCamera.key === cameraMapKey());
      navigation.bind(renderer, { preserveLimits: restoreCamera });
      if (restoreCamera) renderer.setCameraPose(suspendedCamera.pose);
      if (pendingSearchFit) { pendingSearchFit = false; navigation.fit(); }
      suspendedCamera = null; buttons(); playCompactionCue();
    })().catch(() => { if (generation === rendererGeneration && !disposed) fallback('initialization failed'); })
      .finally(() => {
        if (rendererPromise !== startup) return;
        rendererPromise = null;
        if (disposed) return;
        if (generation !== rendererGeneration && renderAllowed()) void ensureRenderer();
        else if (picture.dataset.renderer === 'stopping') picture.dataset.renderer = 'suspended';
      });
    rendererPromise = startup;
  }
  function drawMap() {
    currentMap = isAutomaticView() ? autoSnapshot() : projectMemoryMap({ active: active(), turns: snapshot().turns, graphData: graph?.snapshot() ?? null, preferredRecordIds: hits?.map(hit => hit.recordId) ?? [] });
    if (isAutomaticView()) {
      pocket.value = automaticMemory.getScope();
      if (!busy && currentMap.status?.state === 'limit') setStatus(currentMap.status.message ?? 'Memory capacity reached. New messages remain in chat.', true);
    }
    query.placeholder = isAutomaticView() ? 'Search memory' : 'Search saved words'; query.setAttribute('aria-label', query.placeholder);
    empty.textContent = isAutomaticView() ? 'No memories in this pocket yet.' : 'No saved memories yet.';
    const ids = new Set(currentMap.nodes.map(node => node.id)), matches = new Set(matchingNodeIds());
    for (const [id, button] of nodeButtons) if (!ids.has(id)) {
      const focused = doc.activeElement === button; button.remove(); nodeButtons.delete(id); if (focused) query.focus();
    }
    for (const node of currentMap.nodes) {
      let target = nodeButtons.get(node.id);
      if (!target) {
        target = control('', ''); target.removeAttribute('id'); target.className = 'memory-map-node'; target.draggable = false;
        target.append(el('span', '', { class: 'memory-node-label', 'aria-hidden': 'true' }));
        target.dataset.memoryNode = node.id; target.dataset.memoryKind = node.kind;
        listen(target, 'click', () => { const current = currentMap.nodes.find(item => item.id === node.id); if (current) showDetail(current, true); });
        for (const type of ['pointerenter', 'focus']) listen(target, type, event => {
          if (event.type === 'pointerenter' && event.pointerType === 'touch') return;
          showPreview(currentMap.nodes.find(item => item.id === node.id));
        });
        for (const type of ['pointerleave', 'blur']) listen(target, type, () => { if (previewNodeId === node.id) hidePreview(); });
        picture.append(target); nodeButtons.set(node.id, target);
      }
      target.firstChild.textContent = node.label;
      const provenance = isAutomaticView() ? node.kind === 'summary' ? 'Derived conversation summary · ' + node.sourceTurnIds.length + ' authored sources: '
        : node.kind === 'global' ? 'Space starter · Global: ' : (node.role === 'assistant' ? 'Assistant · generated' : 'Your words') + ' · ' + node.scope + ': ' : node.kind === 'record' ? 'Memory: ' : 'Source message ' + node.sourceTurnId + ': ';
      const highlight = matches.has(node.id) ? hits ? 'search' : 'last-request' : '';
      target.dataset.memoryHighlight = highlight;
      const highlightLabel = highlight === 'search' ? 'Search match · graph only' : highlight === 'last-request' ? 'Source included in last submitted request' : '';
      target.setAttribute('aria-label', provenance + node.label + (highlightLabel ? ' · ' + highlightLabel : ''));
      target.title = provenance + node.label + (highlightLabel ? ' · ' + highlightLabel : '');
      if (node.kind === 'summary') { target.dataset.summaryEventId = node.eventId; target.dataset.summaryHash = node.summaryHash; }
      if (isAutomaticView()) { target.dataset.memoryScope = node.scope; target.dataset.memoryRole = node.role; }
      else { delete target.dataset.memoryScope; delete target.dataset.memoryRole; }
      if (memoryScopeColor(node.scope) !== undefined) target.style.setProperty('--memory-node-color', MEMORY_SCOPE_COLORS[node.scope]);
      else target.style.removeProperty('--memory-node-color');
      target.dataset.matched = String(matches.has(node.id)); target.setAttribute('aria-pressed', String(selected?.id === node.id));
    }
    picture.classList.toggle('has-query', hits !== null); empty.hidden = currentMap.nodes.length > 0;
    if (!currentMap.nodes.length) { stopRenderer(); picture.dataset.renderer = 'empty'; }
    else if (!graph) fallback(); else void ensureRenderer();
    if (renderer) drawRenderer();
  }
  function refresh() {
    if (disposed) return;
    // Reading an existing local memory never requires loading the model.
    const effectEvent = summaryEffects.diagnostics().eventId;
    if (effectEvent && context.summarySnapshot?.()?.eventId !== effectEvent) cancelCompactionCue();
    let bindingChanged = false;
    try { bindingChanged = Boolean(searchBinding && searchBinding !== currentSearchBinding()); }
    catch (error) {
      invalidateSearch(); setSearchSummary('Memory unavailable. Reload before searching.'); setStatus(errorText(error), true);
    }
    if (bindingChanged) {
      searchEpoch++; searching = false; hits = null; searchBinding = null; hidePreview();
      setSearchSummary(query.value.trim() ? 'Memory changed · search again.' : '');
    }
    if (hits && !isAutomaticView()) hits = hits.filter(hit => active().some(item => item.id === hit.recordId && item.version === hit.version));
    drawMap();
    if (selected && editor.hidden) showDetail(currentMap.nodes.find(node => node.id === selected.id) ?? null);
    buttons();
  }
  function graphView(returnFocus = true) {
    hidePreview();
    cancelCompactionCue();
    const from = selected?.id; selected = null; editRecord = null; editor.hidden = true; detail.hidden = true; map.hidden = false; searchForm.hidden = false;
    back.hidden = !legacyView; title.textContent = legacyView ? 'Saved words' : 'Memory'; refresh();
    if (returnFocus) (nodeButtons.get(from) ?? query).focus({ preventScroll: true });
  }
  function beginEdit(record = null, sourceId) {
    navigation.cancel();
    editRecord = record ? { id: record.id, version: record.version } : null;
    stopRenderer(); editor.hidden = false; map.hidden = true; searchForm.hidden = true; detail.hidden = true; back.hidden = false;
    title.textContent = record ? 'Edit memory' : 'Save from chat'; source.replaceChildren(el('option', 'Choose a message', { value: '' }));
    for (const turn of userTurns()) source.append(el('option', turn.content.replace(/\s+/g, ' ').slice(0, 80), { value: turn.id }));
    source.value = sourceId ?? record?.sourceTurnIds[0] ?? userTurns().at(-1)?.id ?? '';
    text.value = record?.text ?? selectedSource()?.content ?? ''; save.hidden = Boolean(record); correct.hidden = !record;
    setStatus(''); buttons(); source.focus({ preventScroll: true });
  }
  async function write(operation, success, automatic = false) {
    if (busy || disposed) return; invalidateSearch(); setSearchSummary(''); cancelCompactionCue(); busy = true; buttons(); let committed = false;
    try {
      const changed = await operation(); committed = true; hits = null; query.value = '';
      const persisted = automatic ? changed : await onChange?.();
      if (!disposed) {
        if (!automatic && automaticMemory && changed?.status === 'active') legacyView = true;
        graphView(false); const node = currentMap.nodes.find(node => node.recordId === changed?.id);
        if (!automatic && node && changed.status === 'active') showDetail(node, true); else query.focus({ preventScroll: true });
        setStatus(persisted?.error ? 'Changed in this session; saving did not finish. ' + String(persisted.error).slice(0, 180) : success, Boolean(persisted?.error));
      }
    } catch (error) { if (!disposed) setStatus((committed ? 'Changed in this session. ' : '') + errorText(error), true); }
    finally { busy = false; if (!disposed) refresh(); }
  }
  listen(source, 'change', () => { text.value = selectedSource()?.content ?? ''; buttons(); }); listen(text, 'input', buttons);
  listen(add, 'click', () => beginEdit()); listen(edit, 'click', () => { const item = selectedRecord(); if (item) beginEdit(item); });
  listen(cancel, 'click', () => graphView()); listen(back, 'click', () => { if (legacyView && !selected && editor.hidden) { invalidateSearch(); setSearchSummary(''); legacyView = false; query.value = ''; } graphView(); });
  listen(savedWords, 'click', () => { invalidateSearch(); setSearchSummary(''); legacyView = true; query.value = ''; setStatus(''); graphView(); });
  listen(pocket, 'change', () => { navigation.cancel(); const requested = pocket.value; void write(() => automaticMemory.setScope(requested), '', true); });
  listen(remember, 'click', () => {
    const node = selected;
    if (!isAutomaticView() || node?.kind !== 'message' || node.role !== 'user' || !node.turnId) return;
    void write(() => automaticMemory.pinPersona({ turnId: node.turnId, text: node.text }), 'Remembered for this persona.', true);
  });
  listen(save, 'click', () => write(() => memory.save({ text: text.value, sourceTurnIds: [source.value], scope: scope(), modelSafe: true }), 'Saved from your message.'));
  listen(correct, 'click', () => write(() => memory.correct({ recordId: editRecord.id, text: text.value, sourceTurnIds: [source.value], expectedVersion: editRecord.version }), 'Memory corrected.'));
  listen(forget, 'click', () => {
    if (isAutomaticView()) {
      const node = selected; if (!node || node.kind === 'summary' || !currentMap.nodes.some(item => item.id === node.id)) return;
      void write(() => automaticMemory.forget(node), node.kind === 'global' ? 'Starter removed.' : 'Forgotten from memory. The chat is unchanged.', true); return;
    }
    const item = selectedRecord(); if (!item || item.version !== selected.version) { graphView(); setStatus('That memory changed. Select it again.', true); return; }
    void write(() => memory.forget({ recordId: item.id }), 'Memory forgotten.');
  });
  function invalidateSearch({ preserveResults = false } = {}) {
    clearTimeout(searchTimer); searchTimer = 0; searchEpoch++; searching = false;
    if (!preserveResults) { hits = null; searchBinding = null; manualCueNodeIds = []; }
    else if (hits === null && query.value.trim()) setSearchSummary('Search again · graph search only');
    hidePreview();
  }
  async function searchGraph() {
    clearTimeout(searchTimer); searchTimer = 0;
    const requested = query.value.trim();
    if (busy || disposed || !requested) return;
    const epoch = ++searchEpoch, automatic = isAutomaticView();
    cancelCompactionCue(); searching = true; setSearchSummary('Searching memories…'); buttons();
    try {
      const binding = currentSearchBinding();
      const result = automatic ? await automaticMemory.search({ query: requested }) : await retrieval.search({ query: requested,
        records: memory.snapshot().records, scope: scope(), queryId: 'panel-' + Date.now() + '-' + ++sequence });
      if (disposed || epoch !== searchEpoch || query.value.trim() !== requested) return;
      if (binding !== currentSearchBinding()) { hits = null; searchBinding = null; setSearchSummary('Memory changed · search again.'); return; }
      // Legacy search emits retrieval events. Preserve their persistence boundary
      // and reject a slow save's results when its query or source scope changed.
      let persistenceFailed = false;
      if (!automatic) {
        try { persistenceFailed = Boolean((await onChange?.())?.error); }
        catch { persistenceFailed = true; }
        if (disposed || epoch !== searchEpoch || query.value.trim() !== requested) return;
        if (binding !== currentSearchBinding()) { invalidateSearch(); setSearchSummary('Memory changed. Search again.'); drawMap(); return; }
      }
      hits = automatic ? result.hits : result.hits.filter(hit => active().some(item => item.id === hit.recordId && item.version === hit.version));
      searchBinding = binding; pendingSearchFit = hits.length > 0; refresh();
      if (pendingSearchFit && renderer) { pendingSearchFit = false; navigation.fit(); }
      const shown = matchingNodeIds().length;
      setSearchSummary((hits.length ? hits.length + (hits.length === 1 ? ' match' : ' matches')
        + (shown < hits.length ? ' · ' + shown + ' shown' : '') : 'No matches') + ' · graph search only');
      setStatus(persistenceFailed ? 'Search completed in this session; saving did not finish.' : result.status?.message ?? '', persistenceFailed);
    } catch (error) {
      if (!disposed && epoch === searchEpoch) {
        hits = null; searchBinding = null; hidePreview(); drawMap();
        setSearchSummary('Search did not finish.'); setStatus(errorText(error), true);
      }
    } finally { if (!disposed && epoch === searchEpoch) { searching = false; buttons(); } }
  }
  listen(query, 'input', () => {
    invalidateSearch(); cancelCompactionCue(); if (selected) showDetail(null); setStatus('');
    setSearchSummary(query.value.trim() ? 'Searching memories…' : ''); drawMap(); buttons();
    if (query.value.trim()) searchTimer = setTimeout(() => { void searchGraph(); }, 220);
  });
  const clearQuery = () => { invalidateSearch(); cancelCompactionCue(); query.value = ''; if (selected) showDetail(null); setSearchSummary(''); setStatus(''); drawMap(); buttons(); query.focus({ preventScroll: true }); };
  listen(clear, 'click', clearQuery);
  listen(searchForm, 'submit', async event => {
    event.preventDefault(); await searchGraph();
  });
  listen(compactCancel, 'click', () => { compactController?.abort(); buttons(); });
  listen(openSummary, 'click', () => {
    invalidateSearch(); query.value = ''; setSearchSummary(''); legacyView = false; graphView(false);
    const node = currentMap.nodes.find(node => node.kind === 'summary'); if (node) showDetail(node, true);
  });
  listen(compact, 'click', async () => {
    if (busy || searching || compactController) return;
    const eligibility = context.manualCompactionStatus();
    if (!eligibility.eligible) {
      compactMessage = eligibility.reason === 'model-not-ready' ? 'Nothing changed. Load the model before compacting.'
        : eligibility.reason === 'insufficient-history' || eligibility.reason === 'empty' ? 'Nothing to compact yet. The recent exchange is protected; keep chatting to create older history.'
          : eligibility.reason === 'policy-refresh' ? 'Nothing changed. Memory rules changed; send a message to refresh checked context before compacting.'
            : eligibility.reason === 'busy' ? 'Nothing changed. Wait for the active reply or context operation.' : 'Nothing changed. Conversation context must be available to compact.';
      setStatus(compactMessage); buttons(); return;
    }
    invalidateSearch(); query.value = ''; setSearchSummary(''); setStatus(''); hidePreview(); cancelCompactionCue();
    const controller = compactController = new AbortController(); compactMessage = ''; busy = true; buttons();
    try {
      const result = await context.compactNow({ signal: controller.signal });
      if (disposed) return;
      const event = events.list().findLast(item => item.type === 'compacted' && item.cycle === result.compaction?.cycle);
      const summary = context.summarySnapshot?.();
      manualCueNodeIds = summary?.eventId === event?.id ? summary.sourceTurnIds.map(id => 'turn:' + id) : [];
      graphView(false); navigation.fit(); pendingCompactionCue = compactionCue.take(currentMap.nodes); playCompactionCue();
      compactMessage = (summary ? 'Conversation summary ready · ' + summary.sourceTurnIds.length + ' authored sources retained. ' : 'Context compacted. ')
        + result.compaction.before.promptTokens + ' → ' + result.compaction.after.promptTokens + ' prompt tokens. Originals kept; nothing sent.';
      // The real compaction is already committed; saving cannot undo its event.
      let persistenceFailed = false;
      try { persistenceFailed = Boolean((await onChange?.())?.error); }
      catch { persistenceFailed = true; }
      if (persistenceFailed) compactMessage += ' Saving did not finish; this change is session-only.';
    } catch (error) {
      if (!disposed) {
        const feedback = manualCompactionFailureView(error);
        compactMessage = feedback.message; setStatus(compactMessage, feedback.error);
      }
    } finally { if (compactController === controller) compactController = null; busy = false; if (!disposed) refresh(); }
  });
  listen(canvas, 'rag-camera-frame', overlayPositions);
  listen(fit, 'click', () => { cancelCompactionCue(); navigation.fit(); });
  listen(expand, 'click', () => {
    cancelCompactionCue(); navigation.cancel();
    const expanded = dialog.classList.toggle('is-expanded');
    expand.textContent = expanded ? '⤡' : '⤢';
    expand.setAttribute('aria-expanded', String(expanded));
    expand.setAttribute('aria-label', expanded ? 'Collapse Memory' : 'Expand Memory');
    expand.title = expanded ? 'Collapse Memory' : 'Expand Memory';
    if (expandFrame) cancelAnimationFrame(expandFrame);
    expandFrame = requestAnimationFrame(() => { expandFrame = 0; if (!disposed && dialog.open) { drawRenderer(); navigation.fit(); } });
  });
  for (const type of ['pointerdown', 'wheel']) listen(picture, type, () => { hidePreview(); cancelCompactionCue(); });
  for (const type of ['dragstart', 'selectstart', 'contextmenu']) listen(picture, type, event => {
    if (picture.dataset.renderer === 'tsl') event.preventDefault();
  });
  listen(motionPreference, 'change', () => { if (motionPreference.matches) stopCompactionAnimation(); renderer?.setMotionEnabled(!motionPreference.matches); });
  const viewport = () => { cancelCompactionCue(); dialog.style.setProperty('--memory-viewport-height', (window.visualViewport?.height ?? window.innerHeight) + 'px'); drawRenderer(); renderer?.refreshViewport(); };
  if (window.visualViewport) listen(window.visualViewport, 'resize', viewport); listen(window, 'resize', viewport); viewport();
  listen(doc, 'visibilitychange', () => {
    if (doc.visibilityState === 'hidden') {
      if (viewFrame) cancelAnimationFrame(viewFrame); viewFrame = 0;
      if (expandFrame) cancelAnimationFrame(expandFrame); expandFrame = 0;
      stopRenderer(true);
    } else if (renderAllowed()) { drawMap(); buttons(); }
  });
  listen(button, 'click', () => {
    options.open = false; inspector.showGraph(); graphView(false); dialog.showModal(); refresh();
    // take() marks each new event seen before asynchronous renderer startup or playback.
    if (isAutomaticView()) pendingCompactionCue = compactionCue.take(currentMap.nodes);
    playCompactionCue(); query.focus({ preventScroll: true });
  });
  listen(close, 'click', () => dialog.close());
  listen(dialog, 'cancel', event => { if (inspector.selectedTab === 'context') return; if (!editor.hidden || selected) { event.preventDefault(); graphView(); } else if (query.value) { event.preventDefault(); clearQuery(); } });
  listen(dialog, 'close', () => { compactController?.abort(); invalidateSearch({ preserveResults: true }); if (viewFrame) cancelAnimationFrame(viewFrame); viewFrame = 0; if (expandFrame) cancelAnimationFrame(expandFrame); expandFrame = 0; stopRenderer(); if (!skipFocusReturn && !button.hidden && !disposed) button.focus({ preventScroll: true }); skipFocusReturn = false; });
  listen(dialog, 'click', event => {
    const anchor = event.target.closest?.('a[data-memory-source]'); if (!anchor) return;
    event.preventDefault(); const target = doc.getElementById('turn-' + anchor.dataset.memorySource);
    if (!target || target.closest('[hidden]')) {
      // Reading a retained source must not require model loading or focus a
      // hidden chat. Use the same authorized original node in this local view.
      const id = 'turn:' + anchor.dataset.memorySource;
      if (isAutomaticView()) {
        invalidateSearch(); query.value = ''; setSearchSummary(''); manualCueNodeIds = [id]; graphView(false);
      }
      const original = currentMap.nodes.find(node => node.id === id && ['message', 'source'].includes(node.kind));
      if (original) { showDetail(original, true); setStatus('Your original message. Reading it does not load the model.'); }
      else setStatus('That source is outside this memory view.', true);
      return;
    }
    skipFocusReturn = true; dialog.close(); const old = target.getAttribute('tabindex');
    target.setAttribute('tabindex', '-1'); target.scrollIntoView({ block: 'center', behavior: 'auto' }); target.focus({ preventScroll: true });
    target.addEventListener('blur', () => { if (old === null) target.removeAttribute('tabindex'); else target.setAttribute('tabindex', old); }, { once: true });
  });
  const observer = new MutationObserver(refresh); observer.observe(options, { attributes: true, attributeFilter: ['hidden'] });
  const appRoot = doc.getElementById('app'); if (appRoot) observer.observe(appRoot, { attributes: true, attributeFilter: ['data-phase'] });
  const unsubscribe = events.subscribe(event => {
    compactionCue.observe(event);
    if (event.type === 'compacted' && !compactController) queueMicrotask(() => {
      if (disposed) return;
      const summary = context.summarySnapshot?.();
      if (summary?.eventId !== event.id) return;
      manualCueNodeIds = summary.sourceTurnIds.map(id => 'turn:' + id); refresh();
      if (dialog.open && isAutomaticView()) {
        navigation.fit(); pendingCompactionCue = compactionCue.take(currentMap.nodes); playCompactionCue();
      }
    });
    if (event.type === 'context-dispatched') {
      lastDispatchSha256 = event.requestSha256;
      manualCueNodeIds = [];
      // Bind visible cues to this exact submitted inspection, not a search,
      // a prepared request, compaction inputs, or a generated reply.
      requestHighlightUntil = Date.now() + 3200;
      clearTimeout(requestHighlightTimer);
      requestHighlightTimer = setTimeout(() => { requestHighlightTimer = 0; requestHighlightUntil = 0; if (!disposed) refresh(); }, 3200);
      queueMicrotask(() => { if (!disposed) refresh(); });
    } else refresh();
  }), unsubscribeAutomatic = automaticMemory?.subscribe?.(refresh), unsubscribeInspection = context.subscribeInspection?.(() => { if (!disposed) refresh(); }); refresh();
  return Object.freeze({ button, dialog, refresh, dispose() {
    if (disposed) return; disposed = true; compactController?.abort(); invalidateSearch(); inspector.dispose(); if (viewFrame) cancelAnimationFrame(viewFrame); viewFrame = 0; clearTimeout(requestHighlightTimer); requestHighlightTimer = 0; if (expandFrame) cancelAnimationFrame(expandFrame); expandFrame = 0; stopRenderer(); summaryEffects.dispose(); compactionCue.dispose(); navigation.dispose(); observer.disconnect(); unsubscribe(); unsubscribeAutomatic?.(); unsubscribeInspection?.(); listeners.abort();
    if (dialog.open) dialog.close(); dialog.remove(); button.remove(); stylesheet?.remove();
  } });
}
