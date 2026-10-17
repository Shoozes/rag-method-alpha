const phases = new Set(['unmeasured', 'preparing', 'prepared', 'submitted', 'cancelled', 'error', 'stale']);
const scalar = value => typeof value === 'string' || typeof value === 'number' && Number.isFinite(value);

/** Display only supplied inspection fields; this view never performs retrieval. */
export function contextInspectionView(snapshot, preferred = 'prepared') {
  const choices = [];
  if (snapshot?.latestPrepared) choices.push({ value: 'prepared', label: 'Latest prepared', record: snapshot.latestPrepared });
  if (snapshot?.lastSubmitted) choices.push({ value: 'submitted', label: 'Last submitted', record: snapshot.lastSubmitted });
  const selected = choices.find(choice => choice.value === preferred) ?? choices[0];
  const record = selected?.record;
  const phase = phases.has(snapshot?.phase) ? snapshot.phase : 'unmeasured';
  const submitted = selected?.value === 'submitted';
  const memoryAvailable = record?.memoryContextComplete === true && typeof record.exactMemoryContext === 'string';
  const messagesAvailable = record?.complete === true && Array.isArray(record.exactMessages);
  return {
    choices: choices.map(({ value, label }) => ({ value, label })), selected: selected?.value ?? preferred,
    phase, record: record ?? null,
    state: !record ? phase === 'preparing' ? 'Preparing a request. Nothing has been submitted yet.'
      : phase === 'error' ? 'Request preparation failed.' : phase === 'cancelled' ? 'Request preparation was cancelled.'
        : 'No inspected request in this session.'
      : submitted ? 'Submitted to the model Worker. This does not prove the model used any source.'
        : record.phase === 'cancelled' ? 'Prepared · cancelled. This request was not submitted.'
          : record.phase === 'stale' ? 'Prepared · stale. This request was not submitted.' : 'Prepared · not submitted.',
    error: typeof snapshot?.error === 'string' ? snapshot.error : '',
    admissionLabel: submitted ? 'Included in submitted request' : 'Selected for prepared request',
    admitted: Array.isArray(record?.admitted) ? record.admitted : [],
    candidates: Array.isArray(record?.candidates) ? record.candidates : [],
    admittedCount: Number.isSafeInteger(record?.admittedCount) && record.admittedCount >= 0 ? record.admittedCount : null,
    admittedComplete: typeof record?.admittedComplete === 'boolean' ? record.admittedComplete : null,
    candidateCount: Number.isSafeInteger(record?.candidateCount) && record.candidateCount >= 0 ? record.candidateCount : null,
    candidatesComplete: typeof record?.candidatesComplete === 'boolean' ? record.candidatesComplete : null,
    candidateCoverage: typeof record?.candidateCoverage === 'string' ? record.candidateCoverage : '',
    exactMemoryContext: memoryAvailable ? record.exactMemoryContext : null,
    memoryUnavailableReason: memoryAvailable ? '' : record?.memoryContextUnavailableReason ?? 'Exact memory context is unavailable.',
    exactMessages: messagesAvailable ? record.exactMessages : null,
    messagesUnavailableReason: messagesAvailable ? '' : record?.unavailableReason ?? 'The full request is unavailable.',
  };
}

/** Root owns the existing graph region and its CSS; this module owns only tabs and inspection text. */
export function createContextInspector({ context, document: doc = globalThis.document,
  graphPanelId = 'memory-graph-view', onViewChange } = {}) {
  if (!doc?.createElement || typeof context?.inspectionSnapshot !== 'function' || typeof context?.subscribeInspection !== 'function') {
    throw TypeError('A context inspector needs a document and the request inspection API.');
  }
  const listeners = new AbortController();
  const el = (tag, value, attrs = {}) => {
    const node = doc.createElement(tag);
    if (value !== undefined) node.textContent = value;
    for (const [key, item] of Object.entries(attrs)) node.setAttribute(key, item);
    return node;
  };
  const listen = (node, name, callback) => node.addEventListener(name, callback, { signal: listeners.signal });
  const tabs = el('div', undefined, { class: 'memory-view-tabs', role: 'tablist', 'aria-label': 'Memory view' });
  const graphTab = el('button', 'Graph', { id: 'memory-graph-tab', type: 'button', role: 'tab', 'aria-selected': 'true', 'aria-controls': graphPanelId, tabindex: '0' });
  const contextTab = el('button', 'Context', { id: 'memory-context-tab', type: 'button', role: 'tab', 'aria-selected': 'false', 'aria-controls': 'memory-context-view', tabindex: '-1' });
  tabs.append(graphTab, contextTab);
  const panel = el('section', undefined, { id: 'memory-context-view', class: 'memory-context-panel', role: 'tabpanel', 'aria-labelledby': 'memory-context-tab', tabindex: '0' }); panel.hidden = true;
  const requestLabel = el('label', undefined, { class: 'memory-context-request-choice' });
  const requestChoice = el('select', undefined, { id: 'memory-context-request', 'aria-label': 'Inspected request' });
  requestLabel.append(el('span', 'Request'), requestChoice);
  const state = el('p', '', { class: 'memory-note', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const error = el('p', '', { class: 'memory-note memory-error', role: 'status' }); error.hidden = true;
  const identity = el('dl', undefined, { class: 'memory-context-identity' });
  const memoryTitle = el('h3', 'Exact memory context');
  const memoryNote = el('p', 'Exact leading system/memory messages, including the instruction and any supplied summary. This is request text, not model reasoning.', { class: 'memory-note' });
  const memoryText = el('pre', '', { class: 'memory-context-text', tabindex: '0', 'aria-label': 'Exact memory context' });
  const memoryUnavailable = el('p', '', { class: 'memory-note' });
  const admittedTitle = el('h3', 'Selected sources');
  const admitted = el('ol', undefined, { class: 'memory-context-sources' });
  const admittedNote = el('p', '', { class: 'memory-note' });
  const candidateNote = el('p', '', { class: 'memory-note' });
  const candidatesDisclosure = el('details', undefined, { class: 'memory-context-candidates' });
  const coverage = el('p', '', { class: 'memory-note' });
  const candidates = el('ol', undefined, { class: 'memory-context-sources' });
  candidatesDisclosure.append(el('summary', 'Retrieval candidates · not all admitted'), coverage, candidates);
  const messagesDisclosure = el('details', undefined, { class: 'memory-context-full-request' });
  const messagesText = el('pre', '', { class: 'memory-context-text', tabindex: '0', 'aria-label': 'Exact full request' });
  messagesDisclosure.append(el('summary', 'Full request · exact messages'), messagesText);
  const messagesUnavailable = el('p', '', { class: 'memory-note' });
  const ephemeral = el('p', 'Session inspection only. Reload clears this view. Scores and reasons appear only when supplied by retrieval.', { class: 'memory-note' });
  panel.append(requestLabel, state, error, identity, memoryTitle, memoryNote, memoryText, memoryUnavailable,
    admittedTitle, admitted, admittedNote, candidateNote, candidatesDisclosure, messagesDisclosure, messagesUnavailable, ephemeral);
  let disposed = false, selectedTab = 'graph', preferredRequest = 'prepared';

  function metadata(list, name, value) {
    if (value === undefined || value === null || value === '') return;
    if (typeof value === 'object' && Object.keys(value).length === 0) return;
    list.append(el('dt', name), el('dd', scalar(value) ? String(value) : JSON.stringify(value)));
  }
  function rowsNote(rows, total, complete, kind) {
    const retained = rows.length;
    if (complete === false || total !== null && retained < total) {
      return (total === null ? `${retained} ${kind} rows retained; total count was not supplied.` : `${retained} of ${total} ${kind} rows retained.`)
        + (retained === 0 ? ' All source details were omitted or unavailable within the inspection limit.' : ' Some source details were omitted by the inspection limit.');
    }
    if (total === 0 && complete === true) return `No ${kind} sources were recorded.`;
    if (total !== null) return `${retained} of ${total} ${kind} rows retained.`;
    return `${retained} ${kind} rows retained. Total count was not supplied.`;
  }
  function sourceRows(target, rows) {
    target.replaceChildren();
    for (const row of rows) {
      const item = el('li');
      const heading = [row.scope, row.role === 'assistant' ? 'Assistant · generated' : row.role, row.nodeId].filter(scalar).join(' · ');
      item.append(el('p', heading || 'Source identity unavailable'));
      if (typeof row.text === 'string') item.append(el('pre', row.text, { class: 'memory-context-text' }));
      else if (typeof row.textUnavailableReason === 'string') item.append(el('p', row.textUnavailableReason, { class: 'memory-note' }));
      const fields = el('dl', undefined, { class: 'memory-context-source-fields' });
      for (const [field, label] of [['kind', 'Kind'], ['turnId', 'Message'], ['sourceTurnIds', 'Source messages'], ['sourceIds', 'Sources'],
        ['recordId', 'Record'], ['version', 'Version'], ['offsets', 'Offsets'], ['turnHash', 'Message SHA-256'],
        ['lineHash', 'Excerpt SHA-256'], ['contentHash', 'Content SHA-256'], ['provenance', 'Provenance'],
        ['score_micro', 'Retrieval score (micro units)'], ['keyword_micro', 'Keyword score (micro units)'],
        ['components', 'Score components'], ['reasons', 'Supplied reasons'], ['admitted', 'Admitted'],
        ['admissionReason', 'Admission reason'], ['textBytes', 'Source text bytes']]) metadata(fields, label, row[field]);
      if (fields.childNodes.length) item.append(fields);
      target.append(item);
    }
  }
  function render(snapshot) {
    if (disposed) return;
    const view = contextInspectionView(snapshot, preferredRequest);
    requestChoice.replaceChildren();
    for (const choice of view.choices) requestChoice.append(el('option', choice.label, { value: choice.value }));
    requestChoice.value = view.selected; requestLabel.hidden = view.choices.length < 2;
    state.textContent = view.state; error.textContent = view.error; error.hidden = !view.error;
    identity.replaceChildren();
    const record = view.record;
    for (const [key, label] of [['queryId', 'Query'], ['requestSha256', 'Request SHA-256'], ['conversationVersion', 'Conversation version'],
      ['replyTurnId', 'Reply message'], ['scope', 'Scope']]) metadata(identity, label, record?.[key]);
    identity.hidden = !record;
    memoryTitle.hidden = memoryNote.hidden = admittedTitle.hidden = ephemeral.hidden = !record;
    memoryText.hidden = view.exactMemoryContext === null; memoryText.textContent = view.exactMemoryContext ?? '';
    memoryUnavailable.hidden = !record || view.exactMemoryContext !== null; memoryUnavailable.textContent = String(view.memoryUnavailableReason);
    admittedTitle.textContent = view.admissionLabel;
    sourceRows(admitted, view.admitted); admitted.hidden = !record || !view.admitted.length;
    admittedNote.hidden = !record; admittedNote.textContent = rowsNote(view.admitted, view.admittedCount, view.admittedComplete, 'admitted');
    candidateNote.hidden = !record; candidateNote.textContent = rowsNote(view.candidates, view.candidateCount, view.candidatesComplete, 'candidate');
    sourceRows(candidates, view.candidates); candidatesDisclosure.hidden = !record || !view.candidates.length && !view.candidateCoverage;
    coverage.textContent = view.candidateCoverage; coverage.hidden = !view.candidateCoverage;
    messagesDisclosure.hidden = !record || view.exactMessages === null;
    messagesText.textContent = view.exactMessages === null ? '' : JSON.stringify(view.exactMessages);
    messagesUnavailable.hidden = !record || view.exactMessages !== null; messagesUnavailable.textContent = String(view.messagesUnavailableReason);
  }
  function select(tab, focus = false) {
    if (disposed) return;
    selectedTab = tab;
    for (const [value, button] of [['graph', graphTab], ['context', contextTab]]) {
      button.setAttribute('aria-selected', String(value === tab)); button.tabIndex = value === tab ? 0 : -1;
    }
    panel.hidden = tab !== 'context';
    if (tab === 'context') render(context.inspectionSnapshot());
    onViewChange?.(tab);
    if (focus) (tab === 'graph' ? graphTab : contextTab).focus();
  }
  listen(graphTab, 'click', () => select('graph')); listen(contextTab, 'click', () => select('context'));
  listen(tabs, 'keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    select(event.key === 'Home' ? 'graph' : event.key === 'End' ? 'context' : selectedTab === 'graph' ? 'context' : 'graph', true);
  });
  listen(requestChoice, 'change', () => { preferredRequest = requestChoice.value; render(context.inspectionSnapshot()); });
  const unsubscribe = context.subscribeInspection(render); render(context.inspectionSnapshot());
  return Object.freeze({ tabs, panel, get selectedTab() { return selectedTab; },
    showGraph() { select('graph'); },
    dispose() { if (disposed) return; disposed = true; unsubscribe?.(); listeners.abort(); tabs.remove(); panel.remove(); },
  });
}
