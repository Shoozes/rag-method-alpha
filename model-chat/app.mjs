import { createLoaderController } from './loader-controller.mjs';
import { createRuntimeAdapter } from './runtime-adapter.mjs';
import { MODEL } from './model-contract.mjs';

export function mountApp(adapter = createRuntimeAdapter()) {
  const $ = id => document.getElementById(id);
  const app = $('app');
  const busyPhases = new Set(['checking', 'downloading', 'verifying', 'initializing']);
  const labels = {
    idle: 'Ready when you are.', checking: 'Checking this browser and its cache…',
    downloading: 'Bringing the model to your device…', verifying: 'Checking the model’s SHA-256…',
    initializing: 'Opening the model in WASM. This can take a moment…',
    ready: 'Your model is ready.', generating: 'Writing a reply on your device…',
    cancelled: 'Stopped. You can try again or choose a local file.', error: 'The model could not finish. You can retry below.',
  };
  let previousPhase = '', messages = [], pendingMessage;
  const controller = createLoaderController(adapter, render);
  function render(state) {
    const busy = busyPhases.has(state.phase);
    const inChat = state.phase === 'ready' || state.phase === 'generating';
    app.dataset.phase = state.phase;
    app.classList.toggle('is-loading', busy);
    $('loading-stage').hidden = inChat;
    $('chat-stage').hidden = !inChat;
    $('download').disabled = busy;
    $('local-file').disabled = busy;
    $('cancel').hidden = !busy;
    $('send').disabled = state.phase !== 'ready';
    $('stop').hidden = state.phase !== 'generating';
    $('unload').disabled = state.phase === 'generating';
    $('clear').disabled = state.phase === 'generating';
    $('download').textContent = ['error', 'cancelled'].includes(state.phase) ? 'Retry download / cached load' : 'Download & open chat';
    $('error').hidden = !state.error;
    $('error').textContent = state.error || '';
    if (state.phase !== previousPhase) {
      $('load-status').textContent = labels[state.phase] || state.phase;
      $('session-status').textContent = inChat ? (state.phase === 'generating' ? 'Writing locally' : 'Ready · CPU / WASM') : busy ? 'Preparing model' : 'Model not loaded';
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
      $('runtime-label').textContent = `${MODEL.file} · ${state.cached ? 'cached bytes' : state.source === 'file' ? 'local file' : 'download verified'} · 2,048-token context`;
      $('chat-heading').focus();
    }
    if (state.phase === 'generating' && pendingMessage) pendingMessage.querySelector('.content').textContent = state.text || '';
    previousPhase = state.phase;
  }
  function message(role, text, pending = false) {
    $('chat-empty').hidden = true;
    const node = document.createElement('article');
    node.className = `message ${role}${pending ? ' pending' : ''}`;
    const name = document.createElement('p'); name.className = 'speaker'; name.textContent = role === 'user' ? 'You' : 'LFM2.5 · local model';
    const content = document.createElement('p'); content.className = 'content'; content.textContent = text;
    node.append(name, content); $('messages').append(node); return node;
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
  $('effects').addEventListener('change', () => app.classList.toggle('quiet', !$('effects').checked));
  const visibility = () => app.classList.toggle('is-hidden', document.hidden);
  document.addEventListener('visibilitychange', visibility); visibility();
  $('unload').addEventListener('click', async () => { $('draft').value = $('prompt').value; await controller.cancel(); });
  $('stop').addEventListener('click', () => controller.cancel());
  $('clear').addEventListener('click', () => {
    messages = [];
    for (const node of $('messages').querySelectorAll('.message')) node.remove();
    $('chat-empty').hidden = false;
  });
  $('composer').addEventListener('submit', async event => {
    event.preventDefault();
    if (controller.getState().phase !== 'ready') return;
    const text = $('prompt').value.trim();
    if (!text) { $('prompt').focus(); return; }
    // Keep this preview bounded; no attachment/context injection or tool execution.
    if (messages.length >= 12 || messages.reduce((sum, item) => sum + item.content.length, text.length) > 6000) {
      $('error').hidden = false; $('error').textContent = 'This preview has reached its conversation limit. Clear the conversation to start fresh.'; return;
    }
    messages.push({ role: 'user', content: text }); message('user', text);
    $('prompt').value = ''; $('draft').value = '';
    pendingMessage = message('assistant', '', true);
    try {
      const answer = await controller.send([{ role: 'system', content: 'You are a concise, helpful assistant. Answer in plain text.' }, ...messages]);
      pendingMessage.querySelector('.content').textContent = answer;
      pendingMessage.classList.remove('pending');
      messages.push({ role: 'assistant', content: answer });
      $('prompt').focus();
    } catch {
      pendingMessage.classList.remove('pending'); pendingMessage.classList.add('interrupted');
      if (!pendingMessage.querySelector('.content').textContent) pendingMessage.querySelector('.content').textContent = 'No completed answer.';
      // Incomplete attempts remain visible, but are not silently sent as accepted history.
      messages.pop();
    } finally { pendingMessage = null; }
  });
  window.addEventListener('pagehide', () => { void controller.dispose(); document.removeEventListener('visibilitychange', visibility); }, { once: true });
  render(controller.getState());
  return { controller, getMessages: () => structuredClone(messages) };
}
