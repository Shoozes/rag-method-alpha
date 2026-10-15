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
export function mountMemoryPanel({ conversation, memory, retrieval, events, graph, onChange, rendererBackend = 'auto' } = {}) {
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
  const header = el('header', undefined, { class: 'memory-panel-header' });
  const back = control('Back', 'memory-back'), close = control('Close', 'memory-close'); back.hidden = true;
  const title = el('h2', 'Memory', { id: 'memory-title' }); header.append(back, title, close);
  const body = el('div', undefined, { class: 'memory-panel-body' });
  const searchForm = el('form', undefined, { id: 'memory-recall-form', class: 'memory-search-form' });
  const query = el('input', undefined, { id: 'memory-query', type: 'search', maxlength: '1024', placeholder: 'Search saved words', 'aria-label': 'Search saved words', enterkeyhint: 'search' });
  const clear = control('×', 'memory-query-clear'); clear.setAttribute('aria-label', 'Clear search'); clear.hidden = true;
  const recall = control('Search', 'memory-recall'); recall.type = 'submit'; searchForm.append(query, clear, recall);
  const map = el('div', undefined, { class: 'memory-map' });
  const picture = el('div', undefined, { id: 'memory-graph', class: 'memory-graph', 'aria-label': 'Saved memories and their sources' });
  const canvas = el('canvas', undefined, { class: 'memory-canvas', 'aria-hidden': 'true' }); canvas.hidden = true;
  const empty = el('p', 'No saved memories yet.', { class: 'memory-empty' }); picture.append(canvas, empty); map.append(picture);
  const detail = el('section', undefined, { id: 'memory-detail', class: 'memory-detail', 'aria-labelledby': 'memory-detail-title' }); detail.hidden = true;
  const detailTitle = el('h3', 'Saved words', { id: 'memory-detail-title', tabindex: '-1' });
  const detailText = el('p', '', { id: 'memory-detail-text', class: 'memory-record-text' });
  const detailSources = el('div', undefined, { id: 'memory-detail-sources', class: 'memory-sources' });
  const edit = control('Edit', 'memory-edit'), forget = control('Forget saved record', 'memory-forget');
  const forgetHint = el('p', 'Forgetting a saved record does not erase the transcript or other messages that repeat it.', { id: 'memory-forget-hint', class: 'memory-note' });
  forget.setAttribute('aria-describedby', 'memory-forget-hint');
  const detailActions = el('div', undefined, { class: 'memory-actions' }); detailActions.append(edit, forget);
  detail.append(detailTitle, detailText, detailSources, detailActions, forgetHint); map.append(detail);
  const editor = el('section', undefined, { id: 'memory-editor', class: 'memory-editor', 'aria-label': 'Save exact words from your chat' }); editor.hidden = true;
  const source = el('select', undefined, { id: 'memory-source-turn' });
  const text = el('textarea', undefined, { id: 'memory-text', rows: '5', maxlength: '4000', 'aria-describedby': 'memory-source-hint' });
  const hint = el('p', 'Keep all or part of the exact words in your message.', { id: 'memory-source-hint', class: 'memory-note' });
  const save = control('Save', 'memory-save'), correct = control('Save correction', 'memory-correct'), cancel = control('Cancel', 'memory-cancel');
  const editorActions = el('div', undefined, { class: 'memory-actions' }); editorActions.append(save, correct, cancel);
  editor.append(field('From your chat', source), field('Exact words', text), hint, editorActions);
  const add = control('Save from chat', 'memory-add'); add.classList.add('memory-add');
  const status = el('p', '', { id: 'memory-status', role: 'status', 'aria-live': 'polite' });
  body.append(searchForm, map, editor, status, add); dialog.append(header, body); doc.body.append(dialog);

  let disposed = false, busy = false, hits = null, sequence = 0, selected = null, editRecord = null, skipFocusReturn = false;
  let renderer = null, rendererModule = null, rendererPromise = null, rendererGeneration = 0, topology = '', currentMap = { nodes: [], links: [] };
  const nodeButtons = new Map();
  const snapshot = () => conversation.snapshot();
  const scope = () => { const value = snapshot(); return { actorId: value.actorId, conversationId: value.conversationId }; };
  const active = () => memory.active(scope());
  const userTurns = () => snapshot().turns.filter(turn => turn.role === 'user');
  const selectedSource = () => userTurns().find(turn => turn.id === source.value);
  const selectedRecord = () => selected?.kind === 'record' ? active().find(item => item.id === selected.recordId) : null;
  const setStatus = (value, error = false) => { status.textContent = value; status.classList.toggle('memory-error', error); status.setAttribute('role', error ? 'alert' : 'status'); status.hidden = !value; };
  const errorText = error => typeof error?.message === 'string' ? error.message.slice(0, 180) : 'The memory operation could not finish.';
  function buttons() {
    const authored = selectedSource(), valid = Boolean(authored && text.value.length && text.value.length <= 4000 && authored.content.includes(text.value));
    save.disabled = busy || !valid; correct.disabled = busy || !valid || !editRecord;
    for (const node of [source, text, query, recall, clear, add, edit, forget, cancel, back]) node.disabled = busy;
    recall.disabled = busy || !query.value.trim(); clear.hidden = !query.value;
    add.hidden = !editor.hidden || selected !== null || userTurns().length === 0;
  }
  function sourceLinks(ids) {
    detailSources.replaceChildren();
    for (const id of ids) detailSources.append(el('a', 'Open in chat', { href: '#turn-' + id, 'data-memory-source': id }));
  }
  function matchingNodeIds() {
    if (!hits) return [];
    const current = new Map(active().map(item => [item.id, item]));
    return hits.filter(hit => current.get(hit.recordId)?.version === hit.version)
      .flatMap(hit => ['record:' + hit.recordId, ...hit.sourceTurnIds.map(id => 'turn:' + id)])
      .filter(id => currentMap.nodes.some(node => node.id === id));
  }
  function showDetail(node, focus = false) {
    selected = node; editor.hidden = true; map.hidden = false; searchForm.hidden = false; detail.hidden = !node;
    back.hidden = !node; title.textContent = 'Memory'; editRecord = null;
    if (node) {
      const record = node.kind === 'record' ? active().find(item => item.id === node.recordId) : null;
      const original = node.kind === 'source' ? userTurns().find(turn => turn.id === node.sourceTurnId) : null;
      if (!record && !original) { selected = null; detail.hidden = true; back.hidden = true; query.focus(); return; }
      detailTitle.textContent = record ? 'Saved words' : 'From your chat'; detailText.textContent = record?.text ?? original.content;
      sourceLinks(record?.sourceTurnIds ?? [original.id]); edit.hidden = !record; forget.hidden = !record; forgetHint.hidden = !record;
      if (focus) detailTitle.focus({ preventScroll: true });
    }
    for (const [id, target] of nodeButtons) target.setAttribute('aria-pressed', String(selected?.id === id));
    renderer?.setInteractionState(selected?.id ?? null, matchingNodeIds()); buttons();
  }
  function overlayPositions() {
    if (!renderer) return;
    for (const target of renderer.diagnostics().node_targets) {
      const node = nodeButtons.get(target.node_id); if (!node) continue;
      node.style.setProperty('--node-x', target.x + 'px'); node.style.setProperty('--node-y', target.y + 'px'); node.hidden = !target.visible;
    }
  }
  function stopRenderer() {
    ++rendererGeneration; renderer?.dispose(); renderer = null; rendererPromise = null; topology = ''; canvas.hidden = true;
  }
  function fallback(reason = '') {
    renderer?.dispose(); renderer = null; topology = ''; canvas.hidden = true;
    picture.dataset.renderer = 'list'; picture.classList.add('is-fallback');
    for (const node of nodeButtons.values()) node.hidden = false;
    if (reason) setStatus('Graph unavailable. Your saved words are still available.', true);
  }
  function drawRenderer() {
    if (!renderer || !rendererModule) return;
    const key = JSON.stringify(currentMap);
    if (topology !== key) {
      const data = { view: 'evidence', nodes: currentMap.nodes.map(node => ({ ...node, kind: node.kind === 'record' ? 'chunk' : 'source',
        record_id: node.recordId ?? null, source_id: node.sourceTurnId ?? node.recordId, path: 'memory/' + (node.recordId ?? node.sourceTurnId) })),
        links: currentMap.links, total_nodes: currentMap.nodes.length, total_links: currentMap.links.length, omitted_nodes: 0, omitted_links: 0 };
      const positioned = rendererModule.layoutRagGraph(data, hits?.map(hit => hit.recordId) ?? []);
      renderer.render({ ...positioned, nodes: positioned.nodes.map(node => ({ ...node, x: node.x * 2.5, y: node.y * 2.5 })) }); topology = key;
    }
    renderer.setInteractionState(selected?.id ?? null, matchingNodeIds()); renderer.refreshViewport(); overlayPositions();
  }
  async function ensureRenderer() {
    if (!graph || !dialog.open || !editor.hidden || !currentMap.nodes.length || disposed) return;
    if (renderer) { drawRenderer(); return; } if (rendererPromise) return;
    const generation = ++rendererGeneration; picture.dataset.renderer = 'loading'; picture.classList.add('is-fallback');
    rendererPromise = (async () => {
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
      if (generation !== rendererGeneration || disposed || !dialog.open) return;
      canvas.hidden = false;
      const value = await module.createTslRagGraphRenderer({ canvas, backend, onNodeActivate: id => {
        const node = currentMap.nodes.find(node => node.id === id); if (node) showDetail(node, true);
      }, onTerminalFailure: () => fallback('device unavailable') });
      if (generation !== rendererGeneration || disposed || !dialog.open) { value.dispose(); return; }
      renderer = value; rendererModule = module; renderer.setMotionEnabled(!motionPreference.matches);
      picture.dataset.renderer = 'tsl'; picture.dataset.backend = renderer.backend; picture.classList.remove('is-fallback'); drawRenderer();
    })().catch(() => { if (generation === rendererGeneration && !disposed) fallback('initialization failed'); })
      .finally(() => { if (generation === rendererGeneration) rendererPromise = null; });
  }
  function drawMap() {
    currentMap = projectMemoryMap({ active: active(), turns: snapshot().turns, graphData: graph?.snapshot() ?? null, preferredRecordIds: hits?.map(hit => hit.recordId) ?? [] });
    const ids = new Set(currentMap.nodes.map(node => node.id)), matches = new Set(matchingNodeIds());
    for (const [id, button] of nodeButtons) if (!ids.has(id)) {
      const focused = doc.activeElement === button; button.remove(); nodeButtons.delete(id); if (focused) query.focus();
    }
    for (const node of currentMap.nodes) {
      let target = nodeButtons.get(node.id);
      if (!target) {
        target = control('', ''); target.removeAttribute('id'); target.className = 'memory-map-node';
        target.append(el('span', '', { class: 'memory-node-label', 'aria-hidden': 'true' }));
        target.dataset.memoryNode = node.id; target.dataset.memoryKind = node.kind;
        listen(target, 'click', () => { const current = currentMap.nodes.find(item => item.id === node.id); if (current) showDetail(current, true); });
        picture.append(target); nodeButtons.set(node.id, target);
      }
      target.firstChild.textContent = node.label; target.setAttribute('aria-label', (node.kind === 'record' ? 'Memory: ' : 'Source message ' + node.sourceTurnId + ': ') + node.label);
      target.dataset.matched = String(matches.has(node.id)); target.setAttribute('aria-pressed', String(selected?.id === node.id));
    }
    picture.classList.toggle('has-query', hits !== null); empty.hidden = currentMap.nodes.length > 0;
    if (!currentMap.nodes.length) { stopRenderer(); picture.dataset.renderer = 'empty'; }
    else if (!graph) fallback(); else void ensureRenderer();
    if (renderer) drawRenderer();
  }
  function refresh() {
    if (disposed) return;
    button.hidden = options.hidden; if (button.hidden && dialog.open) dialog.close();
    if (hits) hits = hits.filter(hit => active().some(item => item.id === hit.recordId && item.version === hit.version));
    if (selected && editor.hidden) showDetail(currentMap.nodes.find(node => node.id === selected.id) ?? selected);
    drawMap(); buttons();
  }
  function graphView(returnFocus = true) {
    const from = selected?.id; selected = null; editRecord = null; editor.hidden = true; detail.hidden = true; map.hidden = false; searchForm.hidden = false;
    back.hidden = true; title.textContent = 'Memory'; refresh();
    if (returnFocus) (nodeButtons.get(from) ?? query).focus({ preventScroll: true });
  }
  function beginEdit(record = null, sourceId) {
    editRecord = record ? { id: record.id, version: record.version } : null;
    stopRenderer(); editor.hidden = false; map.hidden = true; searchForm.hidden = true; detail.hidden = true; back.hidden = false;
    title.textContent = record ? 'Edit memory' : 'Save from chat'; source.replaceChildren(el('option', 'Choose a message', { value: '' }));
    for (const turn of userTurns()) source.append(el('option', turn.content.replace(/\s+/g, ' ').slice(0, 80), { value: turn.id }));
    source.value = sourceId ?? record?.sourceTurnIds[0] ?? userTurns().at(-1)?.id ?? '';
    text.value = record?.text ?? selectedSource()?.content ?? ''; save.hidden = Boolean(record); correct.hidden = !record;
    setStatus(''); buttons(); source.focus({ preventScroll: true });
  }
  async function write(operation, success) {
    if (busy || disposed) return; busy = true; buttons(); let committed = false;
    try {
      const changed = await operation(); committed = true; hits = null; query.value = '';
      const persisted = await onChange?.();
      if (!disposed) {
        graphView(false); const node = currentMap.nodes.find(node => node.recordId === changed?.id);
        if (node && changed.status === 'active') showDetail(node, true); else query.focus({ preventScroll: true });
        setStatus(persisted?.error ? 'Changed in this session; saving did not finish. ' + String(persisted.error).slice(0, 180) : success, Boolean(persisted?.error));
      }
    } catch (error) { if (!disposed) setStatus((committed ? 'Changed in this session. ' : '') + errorText(error), true); }
    finally { busy = false; if (!disposed) refresh(); }
  }
  listen(source, 'change', () => { text.value = selectedSource()?.content ?? ''; buttons(); }); listen(text, 'input', buttons);
  listen(add, 'click', () => beginEdit()); listen(edit, 'click', () => { const item = selectedRecord(); if (item) beginEdit(item); });
  listen(cancel, 'click', () => graphView()); listen(back, 'click', () => graphView());
  listen(save, 'click', () => write(() => memory.save({ text: text.value, sourceTurnIds: [source.value], scope: scope(), modelSafe: true }), 'Saved from your message.'));
  listen(correct, 'click', () => write(() => memory.correct({ recordId: editRecord.id, text: text.value, sourceTurnIds: [source.value], expectedVersion: editRecord.version }), 'Memory corrected.'));
  listen(forget, 'click', () => {
    const item = selectedRecord(); if (!item || item.version !== selected.version) { graphView(); setStatus('That memory changed. Select it again.', true); return; }
    void write(() => memory.forget({ recordId: item.id }), 'Memory forgotten.');
  });
  listen(query, 'input', () => { hits = null; if (selected) showDetail(null); setStatus(''); drawMap(); buttons(); });
  const clearQuery = () => { query.value = ''; hits = null; if (selected) showDetail(null); setStatus(''); drawMap(); buttons(); query.focus({ preventScroll: true }); };
  listen(clear, 'click', clearQuery);
  listen(searchForm, 'submit', async event => {
    event.preventDefault(); if (busy || !query.value.trim()) return; busy = true; buttons();
    try {
      const result = await retrieval.search({ query: query.value.trim(), records: memory.snapshot().records, scope: scope(), queryId: 'panel-' + Date.now() + '-' + ++sequence });
      if (!disposed) hits = result.hits.filter(hit => active().some(item => item.id === hit.recordId && item.version === hit.version));
      const persisted = await onChange?.();
      if (!disposed) setStatus(persisted?.error ? 'Search completed; saving did not finish.' : hits.length ? 'Matching memories are lit up.' : 'No matching saved memories.', Boolean(persisted?.error));
    } catch (error) { if (!disposed) setStatus(errorText(error), true); }
    finally { busy = false; if (!disposed) { refresh(); query.focus({ preventScroll: true }); } }
  });
  listen(canvas, 'rag-camera-frame', overlayPositions);
  listen(motionPreference, 'change', () => renderer?.setMotionEnabled(!motionPreference.matches));
  const viewport = () => { dialog.style.setProperty('--memory-viewport-height', (window.visualViewport?.height ?? window.innerHeight) + 'px'); renderer?.refreshViewport(); };
  if (window.visualViewport) listen(window.visualViewport, 'resize', viewport); listen(window, 'resize', viewport); viewport();
  listen(button, 'click', () => { options.open = false; graphView(false); dialog.showModal(); refresh(); query.focus({ preventScroll: true }); });
  listen(close, 'click', () => dialog.close());
  listen(dialog, 'cancel', event => { if (!editor.hidden || selected) { event.preventDefault(); graphView(); } else if (query.value) { event.preventDefault(); clearQuery(); } });
  listen(dialog, 'close', () => { stopRenderer(); if (!skipFocusReturn && !button.hidden && !disposed) button.focus({ preventScroll: true }); skipFocusReturn = false; });
  listen(dialog, 'click', event => {
    const anchor = event.target.closest?.('a[data-memory-source]'); if (!anchor) return;
    event.preventDefault(); const target = doc.getElementById('turn-' + anchor.dataset.memorySource);
    if (!target) { setStatus('That source is not in this conversation view.', true); return; }
    skipFocusReturn = true; dialog.close(); const old = target.getAttribute('tabindex');
    target.setAttribute('tabindex', '-1'); target.scrollIntoView({ block: 'center', behavior: 'auto' }); target.focus({ preventScroll: true });
    target.addEventListener('blur', () => { if (old === null) target.removeAttribute('tabindex'); else target.setAttribute('tabindex', old); }, { once: true });
  });
  const observer = new MutationObserver(refresh); observer.observe(options, { attributes: true, attributeFilter: ['hidden'] });
  const unsubscribe = events.subscribe(refresh); refresh();
  return Object.freeze({ button, dialog, refresh, dispose() {
    if (disposed) return; disposed = true; stopRenderer(); observer.disconnect(); unsubscribe(); listeners.abort();
    if (dialog.open) dialog.close(); dialog.remove(); button.remove(); stylesheet?.remove();
  } });
}
