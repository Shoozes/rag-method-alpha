/** Private, explicit memory controls. The stores own validation and retrieval. */
export function mountMemoryPanel({ conversation, memory, retrieval, events, graph, context, onChange } = {}) {
  const doc = document;
  const options = doc.getElementById('chat-options');
  if (!options?.parentElement || doc.getElementById('memory-dialog')) throw new Error('Memory panel needs an unmounted chat header.');
  const listeners = new AbortController();
  const listen = (node, type, callback) => node.addEventListener(type, callback, { signal: listeners.signal });
  const element = (tag, text, attrs = {}) => {
    const node = doc.createElement(tag);
    if (text !== undefined) node.textContent = text;
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  };
  const control = (text, id) => element('button', text, { type: 'button', id, class: 'secondary' });
  const field = (label, node) => {
    const wrapper = element('label', undefined, { class: 'memory-field' });
    wrapper.append(element('span', label), node);
    return wrapper;
  };
  const stylesheet = doc.getElementById('memory-panel-style') ? null : element('link', undefined, {
    id: 'memory-panel-style', rel: 'stylesheet', href: new URL('./panel.css', import.meta.url).href,
  });
  if (stylesheet) doc.head.append(stylesheet);
  const button = control('Memory', 'memory-open');
  button.classList.add('memory-open');
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-controls', 'memory-dialog');
  options.before(button);
  const dialog = element('dialog', undefined, { id: 'memory-dialog', class: 'memory-dialog', 'aria-labelledby': 'memory-title' });
  const header = element('header', undefined, { class: 'memory-panel-header' });
  const close = control('Close', 'memory-close');
  header.append(element('h2', 'Memory', { id: 'memory-title' }), close);
  const body = element('div', undefined, { class: 'memory-panel-body' });
  const intro = element('p', 'Older context is selected automatically from your messages when the prompt fills. Selection is lossy, not a general semantic summary. Save exact words only when you want a separate saved record.', { class: 'memory-note' });
  const contextMethod = element('p', '', { id: 'memory-context-method', class: 'memory-note' });
  const source = element('select', undefined, { id: 'memory-source-turn' });
  const record = element('select', undefined, { id: 'memory-record' });
  const text = element('textarea', undefined, { id: 'memory-text', rows: '3', maxlength: '4000', 'aria-describedby': 'memory-source-hint' });
  const hint = element('p', 'Select a user message, then keep all or part of its exact text.', { id: 'memory-source-hint', class: 'memory-note' });
  const save = control('Save', 'memory-save');
  const correct = control('Correct', 'memory-correct');
  const forget = control('Forget saved record', 'memory-forget');
  const forgetHint = element('p', 'Forgetting a saved record does not erase the transcript or other messages that repeat it.', { id: 'memory-forget-hint', class: 'memory-note' });
  forget.setAttribute('aria-describedby', 'memory-forget-hint');
  const actions = element('div', undefined, { class: 'memory-actions' });
  actions.append(save, correct, forget);
  const editor = element('section', undefined, { 'aria-label': 'Save or change memory', class: 'memory-section' });
  const selectors = element('div', undefined, { class: 'memory-selectors' });
  selectors.append(field('User message', source), field('Saved record', record));
  editor.append(selectors, field('Exact words to save', text), hint, actions, forgetHint);
  const status = element('p', '', { id: 'memory-status', role: 'status', 'aria-live': 'polite' });
  const recordsSection = element('section', undefined, { class: 'memory-section', 'aria-labelledby': 'memory-records-title' });
  const recordsTitle = element('h3', 'Saved records', { id: 'memory-records-title' });
  const recordsList = element('ul', undefined, { id: 'memory-records', class: 'memory-list' });
  recordsSection.append(recordsTitle, recordsList);
  const recallSection = element('section', undefined, { class: 'memory-section', 'aria-labelledby': 'memory-recall-title' });
  const recallForm = element('form', undefined, { id: 'memory-recall-form', class: 'memory-recall-form' });
  const query = element('input', undefined, { id: 'memory-query', type: 'search', maxlength: '1024', placeholder: 'Search saved words' });
  const recall = control('Recall', 'memory-recall');
  recall.type = 'submit';
  recallForm.append(field('Query', query), recall);
  const results = element('ul', undefined, { id: 'memory-results', class: 'memory-list', 'aria-live': 'polite' });
  recallSection.append(element('h3', 'Recall', { id: 'memory-recall-title' }), recallForm, results);
  const activity = element('section', undefined, { class: 'memory-section', 'aria-labelledby': 'memory-activity-title' });
  const picture = element('div', undefined, { id: 'memory-graph', class: 'memory-graph' });
  const eventList = element('ol', undefined, { id: 'memory-event-list', class: 'memory-event-list' });
  activity.append(element('h3', 'Activity', { id: 'memory-activity-title' }), picture, eventList);
  body.append(intro, contextMethod, editor, status, recordsSection, recallSection, activity);
  dialog.append(header, body);
  doc.body.append(dialog);

  let disposed = false, busy = false, selectedVersion = null, hits = null, querySequence = 0, skipFocusReturn = false;
  const snapshot = () => conversation.snapshot();
  const scope = () => {
    const value = snapshot();
    if (!value.actorId || !value.conversationId) throw new Error('Conversation scope is unavailable.');
    return { actorId: value.actorId, conversationId: value.conversationId };
  };
  const userTurns = () => snapshot().turns.filter(turn => turn.role === 'user');
  const selectedSource = () => userTurns().find(turn => turn.id === source.value);
  const selectedRecord = () => memory.active(scope()).find(item => item.id === record.value);
  const setStatus = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle('memory-error', error);
    status.setAttribute('role', error ? 'alert' : 'status');
  };
  const errorMessage = error => {
    try { if (typeof error?.message === 'string') return error.message.slice(0, 180); } catch { /* Error reporting cannot own the operation. */ }
    return 'The memory operation could not finish.';
  };
  const persistenceMessage = error => typeof error === 'string' ? error.slice(0, 180) : errorMessage(error);
  function updateButtons() {
    const authored = selectedSource();
    const valid = Boolean(authored && text.value.length && authored.content.includes(text.value));
    save.disabled = busy || !valid;
    correct.disabled = busy || !valid || !record.value || selectedVersion === null;
    forget.disabled = busy || !record.value;
    recall.disabled = busy || !query.value.trim();
    for (const input of [source, record, text, query]) input.disabled = busy;
  }
  function sourceLinks(turnIds) {
    const links = element('span', undefined, { class: 'memory-sources' });
    for (const id of turnIds ?? []) links.append(element('a', id, { href: `#turn-${id}`, 'data-memory-source': id }));
    return links;
  }
  function drawRecords(active) {
    recordsTitle.textContent = `Saved records (${active.length})`;
    recordsList.replaceChildren();
    if (!active.length) recordsList.append(element('li', 'No saved records yet.', { class: 'memory-note' }));
    for (const item of active) {
      const row = element('li');
      row.append(element('p', item.text, { class: 'memory-record-text' }), element('span', `${item.id} · v${item.version}`, { class: 'memory-record-id' }), sourceLinks(item.sourceTurnIds));
      recordsList.append(row);
    }
  }
  function drawHits() {
    results.replaceChildren();
    if (hits === null) return;
    if (!hits.length) results.append(element('li', 'No matching active memories.', { class: 'memory-note' }));
    for (const hit of hits) {
      const row = element('li');
      row.append(element('p', hit.text, { class: 'memory-record-text' }), element('span', `${hit.recordId} · v${hit.version}`, { class: 'memory-record-id' }), sourceLinks(hit.sourceTurnIds));
      results.append(row);
    }
  }
  function drawGraph() {
    picture.replaceChildren();
    eventList.replaceChildren();
    const actualEvents = events.list();
    for (const event of actualEvents.slice(-8)) {
      const row = element('li', `${event.id} · ${event.type}`);
      const ids = event.recordId ? [event.recordId] : event.recordIds ?? [];
      if (ids.length) row.append(element('span', ` · ${ids.join(', ')}`));
      if (event.priorEventIds?.length) row.append(element('span', ` · after ${event.priorEventIds.join(', ')}`));
      row.append(sourceLinks(event.sourceTurnIds));
      eventList.append(row);
    }
    if (!actualEvents.length) picture.append(element('p', 'No memory events yet.', { class: 'memory-note' }));
    if (actualEvents.length > 8) eventList.prepend(element('li', `Latest 8 of ${actualEvents.length} actual events.`, { class: 'memory-note' }));
    if (!graph) return;
    try {
      const data = graph.snapshot();
      const eventIds = new Set(data.nodes.filter(node => node.kind === 'event').slice(-6).map(node => node.id));
      const related = new Set(data.links.filter(link => eventIds.has(link.source)).map(link => link.target));
      const eventNodes = data.nodes.filter(node => eventIds.has(node.id));
      const nodes = [...eventNodes, ...data.nodes.filter(node => related.has(node.id) && !eventIds.has(node.id)).slice(0, 30 - eventNodes.length)];
      if (!nodes.length) return;
      const ns = 'http://www.w3.org/2000/svg';
      const svgNode = (tag, attrs = {}, content) => {
        const node = doc.createElementNS(ns, tag);
        for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
        if (content !== undefined) node.textContent = content;
        return node;
      };
      const rows = { event: 0, record: 0, source: 0 }, x = { event: 32, record: 236, source: 438 }, positions = new Map();
      for (const node of nodes) positions.set(node.id, { x: x[node.kind], y: 28 + rows[node.kind]++ * 28 });
      const height = Math.max(3, ...Object.values(rows)) * 28 + 20;
      const svg = svgNode('svg', { viewBox: `0 0 600 ${height}`, role: 'img', 'aria-label': `${nodes.length} actual memory event, record and source nodes. Connections are listed below.` });
      for (const link of data.links) {
        const from = positions.get(link.source), to = positions.get(link.target);
        if (from && to) svg.append(svgNode('path', { d: `M${from.x},${from.y} Q${(from.x + to.x) / 2},${from.y} ${to.x},${to.y}`, class: 'memory-edge' }));
      }
      for (const node of nodes) {
        const point = positions.get(node.id);
        const label = node.kind === 'event' ? `${node.seq} ${node.type}` : node.recordId ?? node.sourceTurnId;
        svg.append(svgNode('circle', { cx: point.x, cy: point.y, r: '4', class: `memory-node memory-node-${node.kind}` }), svgNode('text', { x: point.x + 10, y: point.y + 4 }, label));
      }
      picture.append(svg, element('p', `Showing ${nodes.length} of ${data.nodes.length} actual graph nodes.`, { class: 'memory-note' }));
    } catch { picture.append(element('p', 'Graph unavailable. The actual event list is shown below.', { class: 'memory-note' })); }
  }
  function refresh() {
    if (disposed) return;
    const strategy = context?.snapshot?.().compacted?.strategy;
    contextMethod.textContent = strategy === 'source-linked-automatic-extractive-v1'
      ? 'Context: automatically selected exact passages from older user messages. Some context is omitted; original transcript kept.'
      : strategy === 'source-linked-structured-extractive-v1'
      ? 'Context: marked facts and constraints retained as source-linked quotes. Unmarked narrative omitted; original transcript kept.'
      : strategy === 'source-linked-lossy-window-v1' || strategy === 'source-linked-extractive-window-v1'
        ? 'Context: lossy recent-message window. Older meaning may be omitted; original transcript kept.'
        : strategy ? 'Context: method unavailable; original transcript kept.' : 'Context: recent conversation; no compaction applied.';
    button.hidden = options.hidden;
    if (button.hidden && dialog.open) dialog.close();
    const oldSource = source.value, oldRecord = record.value;
    source.replaceChildren(element('option', 'Choose a user message', { value: '' }));
    for (const turn of userTurns()) source.append(element('option', `${turn.id} · ${turn.content.slice(0, 70)}`, { value: turn.id }));
    source.value = oldSource;
    const active = memory.active(scope());
    record.replaceChildren(element('option', 'Choose a saved record', { value: '' }));
    for (const item of active) record.append(element('option', `${item.id} · v${item.version}`, { value: item.id }));
    record.value = oldRecord;
    if (!record.value) selectedVersion = null;
    if (hits) hits = hits.filter(hit => active.some(item => item.id === hit.recordId && item.version === hit.version));
    drawRecords(active); drawHits(); drawGraph(); updateButtons();
  }
  async function write(operation, success) {
    if (busy || disposed) return;
    busy = true; updateButtons();
    let committed = false;
    try {
      const changed = await operation(); committed = true; hits = null;
      if (!disposed && changed?.status === 'active') {
        refresh(); record.value = changed.id; selectedVersion = changed.version;
      }
      const persisted = await onChange?.();
      if (!disposed) setStatus(persisted?.error ? `Changed in this session; persistence did not finish. ${persistenceMessage(persisted.error)}` : success, Boolean(persisted?.error));
    } catch (error) {
      if (!disposed) setStatus(committed ? `Changed in this session; persistence did not finish. ${errorMessage(error)}` : errorMessage(error), true);
    } finally { busy = false; if (!disposed) refresh(); }
  }
  listen(source, 'change', () => { text.value = selectedSource()?.content ?? ''; updateButtons(); });
  listen(record, 'change', () => {
    const item = selectedRecord(); selectedVersion = item?.version ?? null;
    if (item) { source.value = item.sourceTurnIds.find(id => userTurns().some(turn => turn.id === id)) ?? ''; text.value = item.text; }
    updateButtons();
  });
  listen(text, 'input', updateButtons); listen(query, 'input', updateButtons);
  listen(save, 'click', () => write(() => memory.save({ text: text.value, sourceTurnIds: [source.value], scope: scope(), modelSafe: true }), 'Saved from your message.'));
  listen(correct, 'click', () => write(() => memory.correct({ recordId: record.value, text: text.value, sourceTurnIds: [source.value], expectedVersion: selectedVersion }), 'Memory corrected.'));
  listen(forget, 'click', () => write(() => memory.forget({ recordId: record.value }), 'Memory forgotten.'));
  listen(recallForm, 'submit', async event => {
    event.preventDefault();
    if (busy || !query.value.trim()) return;
    busy = true; updateButtons();
    try {
      const result = await retrieval.search({ query: query.value.trim(), records: memory.snapshot().records, scope: scope(), queryId: `panel-${Date.now()}-${++querySequence}` });
      if (!disposed) hits = result.hits;
      const persisted = await onChange?.();
      if (!disposed) setStatus(persisted?.error ? `Recall completed; persistence did not finish. ${persistenceMessage(persisted.error)}` : `${hits.length} matching active ${hits.length === 1 ? 'memory' : 'memories'}.`, Boolean(persisted?.error));
    } catch (error) { if (!disposed) setStatus(errorMessage(error), true); }
    finally { busy = false; if (!disposed) refresh(); }
  });
  listen(button, 'click', () => { options.open = false; refresh(); dialog.showModal(); body.scrollTop = 0; close.focus({ preventScroll: true }); });
  listen(close, 'click', () => dialog.close());
  listen(dialog, 'close', () => { if (!skipFocusReturn && !button.hidden && !disposed) button.focus({ preventScroll: true }); skipFocusReturn = false; });
  listen(dialog, 'click', event => {
    const anchor = event.target.closest?.('a[data-memory-source]');
    if (!anchor) return;
    event.preventDefault();
    const target = doc.getElementById(`turn-${anchor.dataset.memorySource}`);
    if (!target) { setStatus('That source turn is not present in this conversation view.', true); return; }
    skipFocusReturn = true; dialog.close();
    const oldTabindex = target.getAttribute('tabindex');
    target.setAttribute('tabindex', '-1'); target.scrollIntoView({ block: 'center', behavior: 'auto' }); target.focus({ preventScroll: true });
    target.addEventListener('blur', () => { if (oldTabindex === null) target.removeAttribute('tabindex'); else target.setAttribute('tabindex', oldTabindex); }, { once: true });
  });
  const observer = new MutationObserver(refresh);
  observer.observe(options, { attributes: true, attributeFilter: ['hidden'] });
  const unsubscribe = events.subscribe(refresh);
  refresh();
  return Object.freeze({ button, dialog, refresh, dispose() {
    if (disposed) return;
    disposed = true; observer.disconnect(); unsubscribe(); listeners.abort();
    if (dialog.open) dialog.close();
    dialog.remove(); button.remove(); stylesheet?.remove();
  } });
}
