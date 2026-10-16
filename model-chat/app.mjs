import { createLoaderController } from './loader-controller.mjs';
import { createRuntimeAdapter } from './runtime-adapter.mjs';
import { MODEL, RUNTIME } from './model-contract.mjs';
import { formatRuntimeError } from './runtime-errors.mjs';

// A read-only view of the existing send-time meter, never a token estimator.
export function contextUsageView(state) {
  const phase = state?.phase || 'unmeasured';
  const capacity = state?.capacity, reserve = state?.reserve, budget = state?.usablePromptTokens;
  const validBudget = Number.isSafeInteger(capacity) && Number.isSafeInteger(reserve) && reserve > 0
    && reserve < capacity && budget === capacity - reserve;
  const measured = state?.measurement;
  const known = validBudget && Number.isSafeInteger(measured?.promptTokens) && measured.promptTokens > 0
    && measured.contextTokens === capacity && typeof measured.overflow === 'boolean';
  const labels = { unmeasured: 'Not measured', measuring: 'Checking context', compacting: 'Compacting context',
    ready: state?.compaction ? 'Compacted' : 'Last prompt', stale: 'Last prompt', error: 'Check failed', cancelled: 'Check stopped' };
  const label = labels[phase] || 'Not measured';
  const quality = measured?.quality === 'estimate' ? 'Estimated' : measured?.quality === 'fixture' ? 'Fixture measurement, not native tokens' : 'Measured';
  const budgetText = validBudget ? `${budget.toLocaleString('en-US')} prompt tokens; ${reserve.toLocaleString('en-US')} reserved for the reply (${capacity.toLocaleString('en-US')} total).` : 'Context budget unavailable.';
  const count = known ? `${quality}: ${measured.promptTokens.toLocaleString('en-US')} of ${budget.toLocaleString('en-US')} usable prompt tokens.` : 'Prompt occupancy is not measured.';
  const status = phase === 'compacting' ? 'Compacting; the bar still shows the before count, not percentage completion.'
    : phase === 'measuring' ? 'Checking the next prompt; previous counts stay visible until a new measurement is available.'
      : phase === 'error' ? 'Context preparation failed; no successful compacted prompt is claimed.'
        : phase === 'cancelled' ? 'Context preparation stopped; no later result is applied.'
          : 'Last checked prompt; the current draft and subsequent reply are not remeasured.';
  return { phase, label, busy: phase === 'measuring' || phase === 'compacting',
    max: validBudget ? budget : null, value: known ? Math.min(measured.promptTokens, budget) : null,
    fraction: known ? Math.min(measured.promptTokens / budget, 1) : null,
    detail: `${count} ${budgetText} System instructions and retrieved text are included, not subtracted again. ${status} The bar endpoint is the prompt limit; compaction selects context and keeps the original transcript.` };
}

export function mountApp(adapter = createRuntimeAdapter(), { controllerOptions, workspace } = {}) {
  const $ = id => document.getElementById(id);
  const app = $('app');
  const busyPhases = new Set(['checking', 'downloading', 'verifying', 'initializing']);
  const profiles = { memory64: 'Memory64 CPU / WASM', 'memory32-asyncify': 'Memory32 compatibility / Asyncify (may be slower)' };
  const stages = { 'runtime-start': 'Starting the WASM runtime', 'model-read': 'Reading verified model bytes',
    'model-load': 'Loading model tensors', 'context-create': 'Creating the conversation context', warmup: 'Warming up the model', ready: 'Initialization completed' };
  const labels = {
    idle: 'Ready when you are.', checking: 'Checking browser and cache.',
    downloading: 'Downloading model.', verifying: 'Verifying model bytes.',
    initializing: 'Opening model.', ready: 'Ready.', generating: 'Writing a reply.',
    cancelled: 'Stopped. Ready to retry.', error: 'Could not load. Try again below.',
    unsupported: 'This browser cannot run this runtime.',
  };
  let previousPhase = '', messages = [], pendingMessage, latestReport = '';
  let preparingContext = false, preparationController, unsubscribeUsage = () => {};
  function showContextUsage(state) {
    const node = $('context-usage');
    if (!node) return;
    const view = contextUsageView(state);
    node.hidden = false; node.dataset.phase = view.phase;
    node.dataset.measured = String(view.value !== null);
    node.setAttribute('role', view.value === null ? 'group' : 'meter');
    node.setAttribute('aria-label', 'Prompt context'); node.setAttribute('aria-busy', String(view.busy));
    node.title = view.detail; $('context-detail').textContent = view.detail;
    if (view.value === null) {
      for (const name of ['aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'aria-valuetext']) node.removeAttribute(name);
      node.setAttribute('aria-describedby', 'context-detail');
    } else {
      node.removeAttribute('aria-describedby'); node.setAttribute('aria-valuemin', '0');
      node.setAttribute('aria-valuemax', String(view.max)); node.setAttribute('aria-valuenow', String(view.value));
      node.setAttribute('aria-valuetext', view.detail);
    }
    $('context-fill').style.width = view.fraction === null ? '0%' : `${view.fraction * 100}%`;
    if ($('context-state').textContent !== view.label) $('context-announcement').textContent = view.label;
    $('context-state').textContent = view.label;
  }
  function stopContextPreparation() {
    preparationController?.abort();
    workspace?.context?.invalidateUsage?.();
  }
  async function persistWorkspace() {
    const result = await workspace.persist();
    if (result.error) { $('chat-error').hidden = false; $('chat-error').textContent = 'Memory changed in this session, but saving failed: ' + result.error; }
    return result;
  }
  const log = $('messages');
  let followTail = true, viewportFrame, documentFrame, loadingScrollY = 0;
  function scrollLatest(force = false) {
    if (force) followTail = true;
    if (followTail) log.scrollTop = log.scrollHeight;
    $('new-messages').hidden = followTail;
  }
  log.addEventListener('scroll', () => {
    followTail = log.scrollHeight - log.scrollTop - log.clientHeight < 64;
    if (followTail) $('new-messages').hidden = true;
  }, { passive: true });
  $('new-messages').addEventListener('click', () => scrollLatest(true));
  // The transcript owns scrolling in chat. Restore the setup reading position
  // when unloading, and never carry its document pan into the fixed chat view.
  function setChatDocument(inChat) {
    if (inChat === document.documentElement.classList.contains('chat-open')) return;
    cancelAnimationFrame(documentFrame);
    if (inChat) {
      loadingScrollY = window.scrollY;
      document.documentElement.classList.add('chat-open');
      window.scrollTo({ left: 0, top: 0, behavior: 'instant' });
    } else {
      document.documentElement.classList.remove('chat-open');
      documentFrame = requestAnimationFrame(() => {
        if (!document.documentElement.classList.contains('chat-open')) window.scrollTo({ left: 0, top: loadingScrollY, behavior: 'instant' });
      });
    }
    $('chat-options').open = false;
  }
  // Resize for the keyboard, not ordinary page pan or browser rubber-banding.
  // Native pinch zoom stays untouched; viewport fixtures are not device proof.
  function fitViewport() {
    cancelAnimationFrame(viewportFrame);
    viewportFrame = requestAnimationFrame(() => {
      const viewport = window.visualViewport;
      if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
      const height = Math.round(viewport?.height || window.innerHeight);
      const layoutHeight = Math.max(document.documentElement.clientHeight, window.innerHeight);
      const editing = document.activeElement === $('prompt');
      const keyboard = editing && height < layoutHeight - 80;
      const top = keyboard ? Math.max(0, Math.min(Math.round(viewport?.offsetTop || 0), layoutHeight - height)) : 0;
      if (app.style.getPropertyValue('--app-height') === `${height}px` && app.style.getPropertyValue('--app-top') === `${top}px`) return;
      const wasFollowing = followTail;
      app.style.setProperty('--app-height', `${height}px`);
      app.style.setProperty('--app-top', `${top}px`);
      scrollLatest(wasFollowing);
    });
  }
  window.addEventListener('resize', fitViewport);
  window.visualViewport?.addEventListener('resize', fitViewport);
  window.visualViewport?.addEventListener('scroll', fitViewport, { passive: true });
  fitViewport();
  const controller = createLoaderController(adapter, render, controllerOptions);
  const reportText = value => value === null || value === undefined ? null : formatRuntimeError(value).slice(0, 240);
  function render(state) {
    const busy = busyPhases.has(state.phase);
    const unsupported = state.phase === 'unsupported';
    const inChat = state.phase === 'ready' || state.phase === 'generating';
    setChatDocument(inChat);
    app.dataset.phase = state.phase;
    if (profiles[state.runtimeProfile]) app.dataset.runtimeProfile = state.runtimeProfile;
    else delete app.dataset.runtimeProfile;
    $('runtime-profile').textContent = profiles[state.runtimeProfile] || 'Automatic WASM runtime selection';
    app.classList.toggle('is-loading', busy);
    $('loading-stage').hidden = inChat;
    $('chat-stage').hidden = !inChat;
    $('chat-options').hidden = !inChat;
    $('download').disabled = busy || unsupported;
    $('download').hidden = unsupported;
    $('local-file').disabled = busy || unsupported;
    $('local-file').closest('.file-choice').hidden = unsupported;
    $('unsupported-hint').hidden = !unsupported;
    if (unsupported) $('error').setAttribute('aria-describedby', 'unsupported-hint');
    else $('error').removeAttribute('aria-describedby');
    $('load-progress').hidden = unsupported;
    document.querySelector('.progress-notes').hidden = unsupported;
    document.querySelector('.stages').hidden = unsupported;
    $('cancel').hidden = !busy;
    $('cancel').textContent = state.phase === 'initializing' ? 'Stop initialization' : 'Cancel';
    const hasInit = state.initStage !== null || state.phase === 'initializing';
    $('init-status').hidden = !hasInit || inChat;
    $('init-stage').textContent = stages[state.initStage] || 'Opening the model';
    $('init-timing').textContent = `${Math.floor(state.initElapsedMs / 1000)}s elapsed; last stage ${Math.floor(state.lastProgressAgeMs / 1000)}s ago`;
    $('init-guidance').hidden = state.phase !== 'initializing' || state.initElapsedMs < 30_000;
    const initRecovery = state.phase === 'error' && (hasInit || state.errorCode === 'INIT_WAIT_LIMIT');
    $('recovery-hint').hidden = !initRecovery;
    $('diagnostics').hidden = state.phase === 'idle' || inChat;
    latestReport = JSON.stringify({ kind: 'rag-model-chat-loading', runtimeVersion: RUNTIME.version,
      model: { file: MODEL.file, revision: MODEL.revision, bytes: MODEL.bytes, sha256: MODEL.sha256 },
      runtimeProfile: state.runtimeProfile, phase: state.phase, source: state.source, cachedBytesReported: state.cached,
      lastConfirmedStage: state.initStage, stageDetail: reportText(state.initDetail),
      stageEvents: state.initEvents.map(({ stage, detail, atMs }) => ({ stage, detail: reportText(detail), atMs })),
      initializationElapsedSeconds: Math.floor(state.initElapsedMs / 1000), secondsSinceEngineStage: Math.floor(state.lastProgressAgeMs / 1000),
      errorCode: state.errorCode, errorDetail: reportText(state.error), browser: reportText(navigator.userAgent), pageVisible: !document.hidden,
    }, null, 2);
    if (document.activeElement !== $('diagnostic-report')) $('diagnostic-report').value = latestReport;
    $('send').disabled = state.phase !== 'ready' || preparingContext;
    $('stop').hidden = state.phase !== 'generating' && !preparingContext;
    $('unload').disabled = state.phase === 'generating';
    $('clear').disabled = state.phase === 'generating';
    $('download').textContent = ['error', 'cancelled'].includes(state.phase) ? 'Retry cached load' : 'Load model';
    $('error').hidden = !state.error;
    $('error').textContent = state.error || '';
    if (state.phase !== previousPhase) {
      $('load-status').textContent = state.errorCode === 'INIT_WAIT_LIMIT' ? 'Initialization waiting limit reached. Cached bytes can be retried.' : labels[state.phase] || state.phase;
      if (unsupported || initRecovery) $('error').focus();
    }
    $('session-status').textContent = inChat ? (state.phase === 'generating' ? 'Writing' : preparingContext ? 'Preparing context' : 'On device') : busy ? 'Loading' : unsupported ? 'Unavailable' : 'Not loaded';
    if (state.determinate) {
      $('load-progress').value = state.progress;
      $('percent').textContent = `${Math.floor(state.progress * 100)}%`;
      $('byte-status').textContent = `${(state.loaded / 1e6).toFixed(1)} / ${(state.total / 1e6).toFixed(1)} MB · ${state.phase === 'verifying' ? 'integrity' : 'download'}`;
    } else {
      if (busy) $('load-progress').removeAttribute('value'); else $('load-progress').value = 0;
      $('percent').textContent = '';
      $('byte-status').textContent = state.phase === 'initializing' ? 'Initialization · no percentage estimate' : state.cached ? 'Using cached bytes · no model download' : 'One pinned model · SHA-256 checked';
    }
    $('arc').style.strokeDashoffset = state.phase === 'downloading' && state.determinate ? String(855 * (1 - state.progress)) : '855';
    for (const step of document.querySelectorAll('[data-step]')) {
      if (step.dataset.step === state.phase) step.setAttribute('aria-current', 'step'); else step.removeAttribute('aria-current');
    }
    if (state.phase === 'ready' && previousPhase !== 'ready' && previousPhase !== 'generating') {
      if (!$('prompt').value) $('prompt').value = $('draft').value;
      $('runtime-label').textContent = `${MODEL.file} · ${profiles[state.runtimeProfile] || 'Automatic WASM runtime selection'} · ${state.cached ? 'cached bytes' : state.source === 'file' ? 'local file' : 'download verified'} · 2,048-token context`;
      $('chat-heading').focus({ preventScroll: true });
      resizePrompt();
    }
    if (state.phase === 'generating' && pendingMessage) {
      pendingMessage.querySelector('.content').textContent = state.text || '';
      scrollLatest();
    }
    if (inChat && previousPhase !== 'ready' && previousPhase !== 'generating') {
      fitViewport();
      requestAnimationFrame(() => scrollLatest(true));
    }
    previousPhase = state.phase;
  }
  function message(role, text, pending = false, turnId) {
    $('chat-empty').hidden = true;
    const node = document.createElement('article');
    node.className = `message ${role}${pending ? ' pending' : ''}`;
    if (turnId) { node.id = 'turn-' + turnId; node.tabIndex = -1; }
    const name = document.createElement('p'); name.className = 'speaker'; name.textContent = role === 'user' ? 'You' : 'LFM2.5';
    const content = document.createElement('p'); content.className = 'content'; content.textContent = text;
    node.append(name, content); log.append(node); scrollLatest(); return node;
  }
  function answerSources(node, turnId) {
    const references = workspace?.sourcesForAnswer(turnId) || [];
    if (!references.length) return;
    const sources = document.createElement('p'); sources.className = 'memory-sources';
    sources.append('Sources sent at the time: ');
    for (const source of references) {
      const link = document.createElement('a'); link.href = '#turn-' + source.turnId;
      const label = source.kind === 'saved-record' ? `${source.recordId} v${source.version}` : source.key;
      link.textContent = `${label} · ${source.turnId}`; sources.append(link, ' ');
    }
    node.append(sources);
  }
  async function load(source, file) {
    try { await controller.load({ source, file }); }
    catch { /* controller exposes the error and keeps chat gated */ }
  }
  $('download').addEventListener('click', () => load('remote'));
  $('local-file').addEventListener('change', () => {
    const file = $('local-file').files?.[0];
    if (file) load('file', file);
    $('local-file').value = '';
  });
  $('cancel').addEventListener('click', () => { stopContextPreparation(); void controller.cancel(); });
  $('diagnostic-report').addEventListener('blur', () => { $('diagnostic-report').value = latestReport; });
  $('copy-report').addEventListener('click', async () => {
    const snapshot = latestReport;
    $('diagnostic-report').value = snapshot;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(snapshot);
      $('copy-status').textContent = 'Report copied.';
    } catch {
      $('diagnostic-report').value = latestReport;
      $('diagnostic-report').focus(); $('diagnostic-report').select();
      $('copy-status').textContent = 'Select and copy the report above.';
    }
  });
  $('effects').addEventListener('change', () => app.classList.toggle('quiet', !$('effects').checked));
  function resizePrompt() {
    const prompt = $('prompt');
    prompt.style.height = '48px';
    prompt.style.height = `${Math.max(48, Math.min(prompt.scrollHeight, parseFloat(getComputedStyle(prompt).maxHeight) || 140))}px`;
  }
  $('prompt').addEventListener('input', resizePrompt);
  $('prompt').addEventListener('focus', fitViewport);
  $('prompt').addEventListener('blur', fitViewport);
  const options = $('chat-options');
  const closeOptions = event => {
    if (!options.open) return;
    if (event.type === 'keydown' && event.key === 'Escape') {
      options.open = false; options.querySelector('summary').focus({ preventScroll: true });
    } else if (event.type === 'pointerdown' && !options.contains(event.target)) options.open = false;
  };
  document.addEventListener('keydown', closeOptions);
  document.addEventListener('pointerdown', closeOptions);
  const visibility = () => app.classList.toggle('is-hidden', document.hidden);
  document.addEventListener('visibilitychange', visibility); visibility();
  $('unload').addEventListener('click', async () => { $('draft').value = $('prompt').value; stopContextPreparation(); await controller.cancel(); });
  $('stop').addEventListener('click', () => { stopContextPreparation(); void controller.cancel(); });
  $('clear').addEventListener('click', () => {
    if (workspace) return; // Canonical preview history stays intact; no silent reset.
    options.open = false;
    messages = [];
    $('chat-error').hidden = true;
    for (const node of $('messages').querySelectorAll('.message')) node.remove();
    $('chat-empty').hidden = false;
    scrollLatest(true);
    $('prompt').focus({ preventScroll: true });
  });
  $('composer').addEventListener('submit', async event => {
    event.preventDefault();
    if (controller.getState().phase !== 'ready' || preparingContext) return;
    const text = $('prompt').value.trim();
    if (!text) { $('prompt').focus(); return; }
    // Keep this preview bounded; no attachment/context injection or tool execution.
    if (!workspace && (messages.length >= 12 || messages.reduce((sum, item) => sum + item.content.length, text.length) > 6000)) {
      $('chat-error').hidden = false; $('chat-error').textContent = 'This preview has reached its conversation limit. Clear the conversation to start fresh.'; return;
    }
    preparingContext = Boolean(workspace); // Reserve before persistence can yield.
    preparationController = workspace ? new AbortController() : undefined;
    render(controller.getState());
    $('chat-error').hidden = true;
    const userTurn = workspace?.conversation.append({ role: 'user', content: text });
    messages.push({ role: 'user', content: text }); message('user', text, false, userTurn?.id);
    $('prompt').value = ''; $('draft').value = '';
    resizePrompt();
    $('prompt').focus({ preventScroll: true });
    pendingMessage = message('assistant', '', true);
    try {
      if (workspace) await persistWorkspace();
      if (workspace) { $('send').disabled = true; $('session-status').textContent = 'Preparing context'; }
      preparationController?.signal.throwIfAborted();
      const prepared = workspace ? await workspace.prepare({ signal: preparationController.signal }) : null;
      preparationController?.signal.throwIfAborted();
      const answer = await controller.send(prepared?.messages || [{ role: 'system', content: 'You are a concise, helpful assistant. Answer in plain text.' }, ...messages]);
      pendingMessage.querySelector('.content').textContent = answer;
      pendingMessage.classList.remove('pending');
      if (workspace) {
        const accepted = workspace.conversation.append({ role: 'assistant', content: answer });
        pendingMessage.id = 'turn-' + accepted.id; pendingMessage.tabIndex = -1;
        await workspace.captureAnswerSources({ answerTurnId: accepted.id, requestSha256: prepared.measurement.requestSha256 });
        answerSources(pendingMessage, accepted.id);
        await persistWorkspace();
      }
      scrollLatest();
      messages.push({ role: 'assistant', content: answer });
    } catch (error) {
      pendingMessage.classList.remove('pending'); pendingMessage.classList.add('interrupted');
      if (!pendingMessage.querySelector('.content').textContent) pendingMessage.querySelector('.content').textContent = 'No completed answer.';
      // Incomplete attempts remain visible, but are not silently sent as accepted history.
      if (workspace) { $('chat-error').hidden = false; $('chat-error').textContent = error.message; await persistWorkspace(); }
      else messages.pop();
    } finally { pendingMessage = null; preparingContext = false; preparationController = undefined; render(controller.getState()); }
  });
  window.addEventListener('pagehide', () => {
    stopContextPreparation(); unsubscribeUsage();
    void controller.dispose(); document.removeEventListener('visibilitychange', visibility);
    workspace?.dispose();
    document.removeEventListener('keydown', closeOptions);
    document.removeEventListener('pointerdown', closeOptions);
    window.removeEventListener('resize', fitViewport);
    window.visualViewport?.removeEventListener('resize', fitViewport);
    window.visualViewport?.removeEventListener('scroll', fitViewport);
    cancelAnimationFrame(viewportFrame);
    cancelAnimationFrame(documentFrame);
  }, { once: true });
  if (workspace) {
    if (typeof workspace.context.subscribeUsage === 'function') {
      unsubscribeUsage = workspace.context.subscribeUsage(showContextUsage);
      showContextUsage(workspace.context.usageSnapshot());
    }
    const turns = workspace.conversation.snapshot().turns;
    messages = turns.map(({ role, content }) => ({ role, content }));
    for (const turn of turns) {
      const node = message(turn.role, turn.content, false, turn.id);
      if (turn.role === 'assistant') answerSources(node, turn.id);
    }
    $('clear').hidden = true;
  }
  render(controller.getState());
  return { controller, getMessages: () => structuredClone(messages) };
}
