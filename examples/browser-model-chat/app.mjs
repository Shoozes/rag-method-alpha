import { createLoaderController } from './loader-controller.mjs';
import { createRuntimeAdapter } from './runtime-adapter.mjs';
import { MODEL, RUNTIME } from './model-contract.mjs';

export function mountApp(adapter = createRuntimeAdapter(), { controllerOptions } = {}) {
  const $ = id => document.getElementById(id);
  const app = $('app');
  const busyPhases = new Set(['checking', 'downloading', 'verifying', 'initializing']);
  const profiles = { memory64: 'Memory64 CPU / WASM', 'memory32-asyncify': 'Memory32 compatibility / Asyncify (may be slower)' };
  const stages = { 'runtime-start': 'Starting the WASM runtime', 'model-read': 'Reading verified model bytes',
    'model-load': 'Loading model tensors', 'context-create': 'Creating the conversation context', warmup: 'Warming up the model', ready: 'Initialization completed' };
  const labels = {
    idle: 'Ready when you are.', checking: 'Checking this browser and its cache…',
    downloading: 'Bringing the model to your device…', verifying: 'Checking the model’s SHA-256…',
    initializing: 'Opening the model in WASM. This can take a moment…',
    ready: 'Your model is ready.', generating: 'Writing a reply on your device…',
    cancelled: 'Stopped. You can try again or choose a local file.', error: 'The model could not finish. You can retry below.',
    unsupported: 'This browser cannot run this runtime.',
  };
  let previousPhase = '', messages = [], pendingMessage;
  const log = $('messages');
  let followTail = true, viewportFrame;
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
  // Use the space actually available above the keyboard. Do not reflow on pinch
  // zoom: the browser keeps its native zoom/pan behavior. Physical iOS is untested.
  function fitViewport() {
    const viewport = window.visualViewport;
    if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
    const wasFollowing = followTail;
    app.style.setProperty('--app-height', `${Math.round(viewport?.height || window.innerHeight)}px`);
    app.style.setProperty('--app-top', `${Math.round(viewport?.offsetTop || 0)}px`);
    cancelAnimationFrame(viewportFrame);
    viewportFrame = requestAnimationFrame(() => scrollLatest(wasFollowing));
  }
  window.addEventListener('resize', fitViewport);
  window.visualViewport?.addEventListener('resize', fitViewport);
  window.visualViewport?.addEventListener('scroll', fitViewport, { passive: true });
  fitViewport();
  const controller = createLoaderController(adapter, render, controllerOptions);
  const reportText = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/https?:\/\/\S+|[A-Za-z]:[\\/]\S+|\/(?:Users|home)\/\S+/g, '[location omitted]').slice(0, 240) : null;
  function render(state) {
    const busy = busyPhases.has(state.phase);
    const unsupported = state.phase === 'unsupported';
    const inChat = state.phase === 'ready' || state.phase === 'generating';
    app.dataset.phase = state.phase;
    if (profiles[state.runtimeProfile]) app.dataset.runtimeProfile = state.runtimeProfile;
    else delete app.dataset.runtimeProfile;
    $('runtime-profile').textContent = profiles[state.runtimeProfile] || 'Automatic WASM runtime selection';
    app.classList.toggle('is-loading', busy);
    $('loading-stage').hidden = inChat;
    $('chat-stage').hidden = !inChat;
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
    $('init-stage').textContent = `Last confirmed stage: ${stages[state.initStage] || 'Opening the model'}${state.initDetail ? ' — ' + state.initDetail : ''}`;
    $('init-timing').textContent = `${Math.floor(state.initElapsedMs / 1000)}s elapsed · ${Math.floor(state.lastProgressAgeMs / 1000)}s since the last engine stage update. No percentage estimate.`;
    $('init-guidance').hidden = state.phase !== 'initializing' || state.initElapsedMs < 30_000;
    const initRecovery = state.phase === 'error' && (hasInit || state.errorCode === 'INIT_WAIT_LIMIT');
    $('recovery-hint').hidden = !initRecovery;
    $('diagnostics').hidden = state.phase === 'idle' || inChat;
    $('diagnostic-report').value = JSON.stringify({ kind: 'rag-model-chat-loading', runtimeVersion: RUNTIME.version,
      model: { file: MODEL.file, revision: MODEL.revision, bytes: MODEL.bytes, sha256: MODEL.sha256 },
      runtimeProfile: state.runtimeProfile, phase: state.phase, source: state.source, cachedBytesReported: state.cached,
      lastConfirmedStage: state.initStage, stageDetail: reportText(state.initDetail),
      stageEvents: state.initEvents.map(({ stage, detail, atMs }) => ({ stage, detail: reportText(detail), atMs })),
      initializationElapsedSeconds: Math.floor(state.initElapsedMs / 1000), secondsSinceEngineStage: Math.floor(state.lastProgressAgeMs / 1000),
      errorCode: state.errorCode, errorDetail: reportText(state.error), browser: reportText(navigator.userAgent), pageVisible: !document.hidden,
    }, null, 2);
    $('send').disabled = state.phase !== 'ready';
    $('stop').hidden = state.phase !== 'generating';
    $('unload').disabled = state.phase === 'generating';
    $('clear').disabled = state.phase === 'generating';
    $('download').textContent = ['error', 'cancelled'].includes(state.phase) ? 'Retry download / cached load' : 'Download & open chat';
    $('error').hidden = !state.error;
    $('error').textContent = state.error || '';
    if (state.phase !== previousPhase) {
      $('load-status').textContent = state.errorCode === 'INIT_WAIT_LIMIT' ? 'Initialization waiting limit reached. Cached bytes can be retried.' : labels[state.phase] || state.phase;
      $('session-status').textContent = inChat ? (state.phase === 'generating' ? 'Writing locally' : 'Ready · CPU / WASM') : busy ? 'Preparing model' : unsupported ? 'Browser unsupported' : 'Model not loaded';
      if (unsupported || initRecovery) $('error').focus();
    }
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
      $('chat-heading').focus();
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
  function message(role, text, pending = false) {
    $('chat-empty').hidden = true;
    const node = document.createElement('article');
    node.className = `message ${role}${pending ? ' pending' : ''}`;
    const name = document.createElement('p'); name.className = 'speaker'; name.textContent = role === 'user' ? 'You' : 'LFM2.5 · local model';
    const content = document.createElement('p'); content.className = 'content'; content.textContent = text;
    node.append(name, content); log.append(node); scrollLatest(); return node;
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
  $('cancel').addEventListener('click', () => controller.cancel());
  $('copy-report').addEventListener('click', async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText($('diagnostic-report').value);
      $('copy-status').textContent = 'Report copied.';
    } catch {
      $('diagnostic-report').focus(); $('diagnostic-report').select();
      $('copy-status').textContent = 'Select and copy the report above.';
    }
  });
  $('effects').addEventListener('change', () => app.classList.toggle('quiet', !$('effects').checked));
  const visibility = () => app.classList.toggle('is-hidden', document.hidden);
  document.addEventListener('visibilitychange', visibility); visibility();
  $('unload').addEventListener('click', async () => { $('draft').value = $('prompt').value; await controller.cancel(); });
  $('stop').addEventListener('click', () => controller.cancel());
  $('clear').addEventListener('click', () => {
    messages = [];
    $('chat-error').hidden = true;
    for (const node of $('messages').querySelectorAll('.message')) node.remove();
    $('chat-empty').hidden = false;
    scrollLatest(true);
  });
  $('composer').addEventListener('submit', async event => {
    event.preventDefault();
    if (controller.getState().phase !== 'ready') return;
    const text = $('prompt').value.trim();
    if (!text) { $('prompt').focus(); return; }
    // Keep this preview bounded; no attachment/context injection or tool execution.
    if (messages.length >= 12 || messages.reduce((sum, item) => sum + item.content.length, text.length) > 6000) {
      $('chat-error').hidden = false; $('chat-error').textContent = 'This preview has reached its conversation limit. Clear the conversation to start fresh.'; return;
    }
    $('chat-error').hidden = true;
    messages.push({ role: 'user', content: text }); message('user', text);
    $('prompt').value = ''; $('draft').value = '';
    $('prompt').focus({ preventScroll: true });
    pendingMessage = message('assistant', '', true);
    try {
      const answer = await controller.send([{ role: 'system', content: 'You are a concise, helpful assistant. Answer in plain text.' }, ...messages]);
      pendingMessage.querySelector('.content').textContent = answer;
      pendingMessage.classList.remove('pending');
      scrollLatest();
      messages.push({ role: 'assistant', content: answer });
    } catch {
      pendingMessage.classList.remove('pending'); pendingMessage.classList.add('interrupted');
      if (!pendingMessage.querySelector('.content').textContent) pendingMessage.querySelector('.content').textContent = 'No completed answer.';
      // Incomplete attempts remain visible, but are not silently sent as accepted history.
      messages.pop();
    } finally { pendingMessage = null; }
  });
  window.addEventListener('pagehide', () => {
    void controller.dispose(); document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('resize', fitViewport);
    window.visualViewport?.removeEventListener('resize', fitViewport);
    window.visualViewport?.removeEventListener('scroll', fitViewport);
    cancelAnimationFrame(viewportFrame);
  }, { once: true });
  render(controller.getState());
  return { controller, getMessages: () => structuredClone(messages) };
}
