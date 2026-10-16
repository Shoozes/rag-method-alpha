import { mountMemoryNavigation } from './navigation.mjs';

export const MEMORY_SCOPE_COLORS = Object.freeze({ conversation: '#bce4ff', persona: '#d3a5ed', global: '#e8c991' });
export function memoryScopeColor(scope) {
  const color = Object.hasOwn(MEMORY_SCOPE_COLORS, scope) ? MEMORY_SCOPE_COLORS[scope] : undefined;
  return color === undefined ? undefined : Number.parseInt(color.slice(1), 16);
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
export function mountMemoryPanel({ conversation, memory, retrieval, events, graph, automaticMemory, onChange, rendererBackend = 'auto' } = {}) {
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
  const back = control('Back', 'memory-back'), fit = control('Fit', 'memory-fit'), close = control('Close', 'memory-close'); back.hidden = true; fit.hidden = true;
  fit.setAttribute('aria-label', 'Fit memory graph');
  const title = el('h2', 'Memory', { id: 'memory-title' }); header.append(back, title, fit, close);
  const body = el('div', undefined, { class: 'memory-panel-body' });
  const searchForm = el('form', undefined, { id: 'memory-recall-form', class: 'memory-search-form' });
  const query = el('input', undefined, { id: 'memory-query', type: 'search', maxlength: '1024', placeholder: automaticMemory ? 'Search memory' : 'Search saved words', 'aria-label': automaticMemory ? 'Search memory' : 'Search saved words', enterkeyhint: 'search' });
  const pocket = el('select', undefined, { id: 'memory-pocket', 'aria-label': 'Memory pocket' });
  for (const [value, label] of [['all', 'All pockets'], ['global', 'Global'], ['persona', 'Persona'], ['conversation', 'Conversation']]) pocket.append(el('option', label, { value }));
  pocket.hidden = !automaticMemory;
  const clear = control('×', 'memory-query-clear'); clear.setAttribute('aria-label', 'Clear search'); clear.hidden = true;
  const recall = control('Search', 'memory-recall'); recall.type = 'submit'; searchForm.append(pocket, query, clear, recall);
  const map = el('div', undefined, { class: 'memory-map' });
  const picture = el('div', undefined, { id: 'memory-graph', class: 'memory-graph', 'aria-label': automaticMemory ? 'Memory from your active pockets' : 'Saved memories and their sources' });
  const canvas = el('canvas', undefined, { class: 'memory-canvas', 'aria-hidden': 'true', draggable: 'false' }); canvas.hidden = true;
  const empty = el('p', 'No saved memories yet.', { class: 'memory-empty' }); picture.append(canvas, empty); map.append(picture);
  const detail = el('section', undefined, { id: 'memory-detail', class: 'memory-detail', 'aria-labelledby': 'memory-detail-title' }); detail.hidden = true;
  const detailTitle = el('h3', 'Saved words', { id: 'memory-detail-title', tabindex: '-1' });
  const detailProvenance = el('p', '', { id: 'memory-detail-provenance', class: 'memory-note' }); detailProvenance.hidden = true;
  const detailText = el('p', '', { id: 'memory-detail-text', class: 'memory-record-text' });
  const detailSources = el('div', undefined, { id: 'memory-detail-sources', class: 'memory-sources' });
  const edit = control('Edit', 'memory-edit'), forget = control('Forget saved record', 'memory-forget'), remember = control('Remember for persona', 'memory-remember-persona'); remember.hidden = true;
  const forgetHint = el('p', 'Forgetting a saved record does not erase the transcript or other messages that repeat it.', { id: 'memory-forget-hint', class: 'memory-note' });
  forget.setAttribute('aria-describedby', 'memory-forget-hint');
  const detailActions = el('div', undefined, { class: 'memory-actions' }); detailActions.append(remember, edit, forget);
  detail.append(detailTitle, detailProvenance, detailText, detailSources, detailActions, forgetHint); map.append(detail);
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
  const legend = el('div', undefined, { class: 'memory-scope-legend', role: 'list', 'aria-label': 'Memory scopes' }); legend.hidden = !automaticMemory;
  for (const [scope] of Object.entries(MEMORY_SCOPE_COLORS)) {
    const label = el('span', scope[0].toUpperCase() + scope.slice(1), { role: 'listitem' });
    label.style.setProperty('--memory-node-color', 'var(--memory-scope-' + scope + ')'); legend.append(label);
  }
  const status = el('p', '', { id: 'memory-status', role: 'status', 'aria-live': 'polite' });
  body.append(searchForm, legend, map, editor, status, footer); dialog.append(header, body); doc.body.append(dialog);

  let disposed = false, busy = false, hits = null, sequence = 0, selected = null, editRecord = null, skipFocusReturn = false;
  let renderer = null, rendererModule = null, rendererPromise = null, rendererGeneration = 0, topology = '', currentMap = { nodes: [], links: [] };
  let legacyView = false;
  const nodeButtons = new Map();
  const snapshot = () => conversation.snapshot();
  const scope = () => { const value = snapshot(); return { actorId: value.actorId, conversationId: value.conversationId }; };
  const active = () => memory.active(scope());
  const userTurns = () => snapshot().turns.filter(turn => turn.role === 'user');
  const selectedSource = () => userTurns().find(turn => turn.id === source.value);
  const selectedRecord = () => selected?.kind === 'record' ? active().find(item => item.id === selected.recordId) : null;
  const isAutomaticView = () => Boolean(automaticMemory && !legacyView);
  const navigation = mountMemoryNavigation({ surface: picture,
    getRenderer: () => dialog.open && editor.hidden && detail.hidden && picture.dataset.renderer === 'tsl' ? renderer : null });
  const autoSnapshot = () => automaticMemory.snapshot({ preferredNodeIds: hits?.map(hit => hit.nodeId) ?? [], limit: 12 });
  const setStatus = (value, error = false) => { status.textContent = value; status.classList.toggle('memory-error', error); status.setAttribute('role', error ? 'alert' : 'status'); status.hidden = !value; };
  const errorText = error => typeof error?.message === 'string' ? error.message.slice(0, 180) : 'The memory operation could not finish.';
  function buttons() {
    const authored = selectedSource(), valid = Boolean(authored && text.value.length && text.value.length <= 4000 && authored.content.includes(text.value));
    save.disabled = busy || !valid; correct.disabled = busy || !valid || !editRecord;
    for (const node of [source, text, query, recall, clear, add, edit, forget, remember, savedWords, pocket, cancel, back, fit]) node.disabled = busy;
    recall.disabled = busy || !query.value.trim(); clear.hidden = !query.value;
    add.hidden = !editor.hidden || selected !== null || userTurns().length === 0;
    savedWords.hidden = !automaticMemory || legacyView || !editor.hidden || selected !== null || active().length === 0;
    pocket.hidden = !isAutomaticView();
    legend.hidden = !isAutomaticView() || !editor.hidden;
    fit.hidden = !renderer || !detail.hidden || !editor.hidden;
    searchForm.classList.toggle('has-pockets', isAutomaticView());
  }
  function sourceLinks(ids) {
    detailSources.replaceChildren();
    for (const id of ids) detailSources.append(el('a', 'Open in chat', { href: '#turn-' + id, 'data-memory-source': id }));
  }
  function matchingNodeIds() {
    if (isAutomaticView()) return (hits ? hits.map(hit => hit.nodeId) : currentMap.usedNodeIds ?? []).filter(id => currentMap.nodes.some(node => node.id === id));
    if (!hits) return [];
    const current = new Map(active().map(item => [item.id, item]));
    return hits.filter(hit => current.get(hit.recordId)?.version === hit.version)
      .flatMap(hit => ['record:' + hit.recordId, ...hit.sourceTurnIds.map(id => 'turn:' + id)])
      .filter(id => currentMap.nodes.some(node => node.id === id));
  }
  function showDetail(node, focus = false) {
    navigation.cancel();
    selected = node; editor.hidden = true; map.hidden = false; searchForm.hidden = false; detail.hidden = !node;
    back.hidden = !node && !legacyView; title.textContent = legacyView ? 'Saved words' : 'Memory'; editRecord = null;
    detailProvenance.hidden = !node || !isAutomaticView(); remember.hidden = true;
    if (node) {
      if (isAutomaticView()) {
        const current = currentMap.nodes.find(item => item.id === node.id);
        if (!current) { showDetail(null); return; }
        selected = current;
        detailTitle.textContent = current.kind === 'global' ? 'Space starter · Global' : current.role === 'assistant' ? 'Assistant · generated' : current.scope === 'persona' ? 'Your words · Persona' : 'Your message';
        detailProvenance.textContent = current.kind === 'global' ? 'Shared starter knowledge · NASA source' : (current.role === 'assistant' ? 'Generated text · ' : 'Exact source words · ') + (current.scope === 'persona' ? 'Current persona' : 'Current conversation');
        const origin = current.provenance?.origin;
        if (current.scope === 'persona' && origin?.conversationId && origin?.turnId) detailProvenance.textContent += ' · Source ' + origin.conversationId + '/' + origin.turnId;
        if (currentMap.usedNodeIds?.includes(current.id)) detailProvenance.textContent += ' · Sent with last reply';
        detailText.textContent = current.text; sourceLinks(current.turnId ? [current.turnId] : []);
        const sourceUrl = current.sourceUrl ?? current.sourceURL;
        if (sourceUrl) {
          // Only ordinary HTTPS sources from the data port become clickable links.
          try { const url = new URL(sourceUrl); if (url.protocol === 'https:') detailSources.append(el('a', 'Open source', { href: url.href, target: '_blank', rel: 'noopener noreferrer', title: current.sourceTitle ?? 'Source' })); } catch { /* The exact text remains available. */ }
        }
        edit.hidden = true; forget.hidden = false; forgetHint.hidden = false;
        forget.textContent = current.kind === 'global' ? 'Remove starter' : current.scope === 'persona' ? 'Forget persona memory' : 'Forget from memory';
        forgetHint.textContent = current.kind === 'global' ? 'Removes this starter from your local memory pockets.' : current.scope === 'persona' ? 'Removes this persona memory. Your original message stays in chat.' : 'Excludes this message from memory and retrieval. The original message stays in chat.';
        remember.hidden = current.kind !== 'message' || current.role !== 'user' || !current.turnId;
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
    for (const target of renderer.diagnostics().node_targets) {
      const node = nodeButtons.get(target.node_id); if (!node) continue;
      node.style.setProperty('--node-x', target.x + 'px'); node.style.setProperty('--node-y', target.y + 'px'); node.hidden = !target.visible;
    }
  }
  function stopRenderer() {
    navigation.cancel(); fit.hidden = true;
    ++rendererGeneration; renderer?.dispose(); renderer = null; rendererPromise = null; topology = ''; canvas.hidden = true;
  }
  function fallback(reason = '') {
    navigation.cancel(); fit.hidden = true;
    renderer?.dispose(); renderer = null; topology = ''; canvas.hidden = true;
    picture.dataset.renderer = 'list'; picture.classList.add('is-fallback');
    for (const node of nodeButtons.values()) node.hidden = false;
    if (reason) setStatus(isAutomaticView() ? 'Graph unavailable. Your memory is still available below.' : 'Graph unavailable. Your saved words are still available.', true);
  }
  function drawRenderer() {
    if (!renderer || !rendererModule) return;
    const width = Math.max(1, canvas.clientWidth), height = Math.max(1, canvas.clientHeight), count = currentMap.nodes.length;
    const compact = isAutomaticView() && count > 6 && (width < 600 || height < 360);
    const columns = compact ? Math.max(2, Math.min(count, Math.ceil(Math.sqrt(count * width / height)))) : 0;
    canvas.dataset.memoryPacking = compact ? 'compact' : 'force';
    const key = JSON.stringify({ nodes: currentMap.nodes, links: currentMap.links, packing: canvas.dataset.memoryPacking, columns });
    if (topology !== key) {
      navigation.cancel();
      const data = { view: 'evidence', nodes: currentMap.nodes.map(node => ({ ...node, kind: node.kind === 'source' || node.kind === 'global' ? 'source' : 'chunk',
        record_id: node.recordId ?? null, source_id: node.turnId ?? node.sourceTurnId ?? node.recordId ?? node.id, path: 'memory/' + (node.recordId ?? node.sourceTurnId ?? node.id) })),
        links: currentMap.links, total_nodes: currentMap.nodes.length, total_links: currentMap.links.length, omitted_nodes: 0, omitted_links: 0 };
      const positioned = rendererModule.layoutRagGraph(data, hits?.map(hit => hit.recordId) ?? []);
      let nodes = positioned.nodes.map(node => ({ ...node, x: node.x * 2.5, y: node.y * 2.5 }));
      if (compact) {
        // Keep dense touch controls apart in graph coordinates; native projection and camera fit still own the screen positions.
        nodes = positioned.nodes.map((node, index) => {
          const row = Math.floor(index / columns);
          return { ...node, x: (index % columns) * 50 + (row % 2) * 25, y: row * 43.30127018922193 };
        });
        const centerX = (Math.min(...nodes.map(node => node.x)) + Math.max(...nodes.map(node => node.x))) / 2;
        const centerY = (Math.min(...nodes.map(node => node.y)) + Math.max(...nodes.map(node => node.y))) / 2;
        nodes = nodes.map(node => ({ ...node, x: node.x - centerX, y: node.y - centerY }));
      }
      renderer.render({ ...positioned, nodes }); topology = key;
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
      }, nodeColor: id => memoryScopeColor(currentMap.nodes.find(node => node.id === id)?.scope), preserveNodeColors: true,
      onTerminalFailure: () => fallback('device unavailable') });
      if (generation !== rendererGeneration || disposed || !dialog.open) { value.dispose(); return; }
      renderer = value; rendererModule = module; renderer.setMotionEnabled(!motionPreference.matches);
      picture.dataset.renderer = 'tsl'; picture.dataset.backend = renderer.backend; picture.classList.remove('is-fallback'); drawRenderer(); buttons();
    })().catch(() => { if (generation === rendererGeneration && !disposed) fallback('initialization failed'); })
      .finally(() => { if (generation === rendererGeneration) rendererPromise = null; });
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
        picture.append(target); nodeButtons.set(node.id, target);
      }
      target.firstChild.textContent = node.label;
      const provenance = isAutomaticView() ? node.kind === 'global' ? 'Space starter · Global: ' : (node.role === 'assistant' ? 'Assistant · generated' : 'Your words') + ' · ' + node.scope + ': ' : node.kind === 'record' ? 'Memory: ' : 'Source message ' + node.sourceTurnId + ': ';
      target.setAttribute('aria-label', provenance + node.label);
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
    button.hidden = options.hidden; if (button.hidden && dialog.open) dialog.close();
    if (hits && !isAutomaticView()) hits = hits.filter(hit => active().some(item => item.id === hit.recordId && item.version === hit.version));
    drawMap();
    if (selected && editor.hidden) showDetail(currentMap.nodes.find(node => node.id === selected.id) ?? null);
    buttons();
  }
  function graphView(returnFocus = true) {
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
    if (busy || disposed) return; busy = true; buttons(); let committed = false;
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
  listen(cancel, 'click', () => graphView()); listen(back, 'click', () => { if (legacyView && !selected && editor.hidden) { legacyView = false; hits = null; query.value = ''; } graphView(); });
  listen(savedWords, 'click', () => { legacyView = true; hits = null; query.value = ''; setStatus(''); graphView(); });
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
      const node = selected; if (!node || !currentMap.nodes.some(item => item.id === node.id)) return;
      void write(() => automaticMemory.forget(node), node.kind === 'global' ? 'Starter removed.' : 'Forgotten from memory. The chat is unchanged.', true); return;
    }
    const item = selectedRecord(); if (!item || item.version !== selected.version) { graphView(); setStatus('That memory changed. Select it again.', true); return; }
    void write(() => memory.forget({ recordId: item.id }), 'Memory forgotten.');
  });
  listen(query, 'input', () => { hits = null; if (selected) showDetail(null); setStatus(''); drawMap(); buttons(); });
  const clearQuery = () => { query.value = ''; hits = null; if (selected) showDetail(null); setStatus(''); drawMap(); buttons(); query.focus({ preventScroll: true }); };
  listen(clear, 'click', clearQuery);
  listen(searchForm, 'submit', async event => {
    event.preventDefault(); if (busy || !query.value.trim()) return; busy = true; buttons();
    try {
      const automatic = isAutomaticView();
      const result = automatic ? await automaticMemory.search({ query: query.value.trim() }) : await retrieval.search({ query: query.value.trim(), records: memory.snapshot().records, scope: scope(), queryId: 'panel-' + Date.now() + '-' + ++sequence });
      if (!disposed) hits = automatic ? result.hits : result.hits.filter(hit => active().some(item => item.id === hit.recordId && item.version === hit.version));
      const persisted = automatic ? result : await onChange?.();
      if (!disposed) setStatus(persisted?.error ? 'Search completed; saving did not finish. ' + String(persisted.error).slice(0, 180) : result.status?.message ?? (hits.length ? 'Matching memories are lit up.' : automatic ? 'No matching memories.' : 'No matching saved memories.'), Boolean(persisted?.error));
    } catch (error) { if (!disposed) setStatus(errorText(error), true); }
    finally { busy = false; if (!disposed) { refresh(); query.focus({ preventScroll: true }); } }
  });
  listen(canvas, 'rag-camera-frame', overlayPositions);
  listen(fit, 'click', () => navigation.fit());
  for (const type of ['dragstart', 'selectstart', 'contextmenu']) listen(picture, type, event => {
    if (picture.dataset.renderer === 'tsl') event.preventDefault();
  });
  listen(motionPreference, 'change', () => renderer?.setMotionEnabled(!motionPreference.matches));
  const viewport = () => { dialog.style.setProperty('--memory-viewport-height', (window.visualViewport?.height ?? window.innerHeight) + 'px'); drawRenderer(); renderer?.refreshViewport(); };
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
  const unsubscribe = events.subscribe(refresh), unsubscribeAutomatic = automaticMemory?.subscribe?.(refresh); refresh();
  return Object.freeze({ button, dialog, refresh, dispose() {
    if (disposed) return; disposed = true; stopRenderer(); navigation.dispose(); observer.disconnect(); unsubscribe(); unsubscribeAutomatic?.(); listeners.abort();
    if (dialog.open) dialog.close(); dialog.remove(); button.remove(); stylesheet?.remove();
  } });
}
