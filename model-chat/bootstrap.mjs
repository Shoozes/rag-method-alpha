import { mountApp } from './app.mjs';
import { createRuntimeAdapter } from './runtime-adapter.mjs';

if (new URL(location.href).searchParams.get('memory') === '1') {
  const adapter = createRuntimeAdapter();
  let workspace, app, mountPanel;
  try {
    const [{ createWorkspace }, { mountMemoryPanel }, core] = await Promise.all([
      import('./memory/workspace.mjs'), import('./memory/panel.mjs'), import('./memory/rag-core.mjs'),
    ]);
    mountPanel = mountMemoryPanel;
    workspace = await createWorkspace({ adapter, core, storage: localStorage, graphEnabled: new URL(location.href).searchParams.get('graph') !== '0',
      getControllerState: () => app?.controller.getState() });
    app = mountApp(workspace.provider, { workspace });
  } catch (error) {
    workspace?.dispose();
    const warning = document.createElement('p'); warning.setAttribute('role', 'alert');
    warning.textContent = 'Local memory is unavailable. Basic chat is available. ' + error.message;
    document.getElementById('loading-stage').prepend(warning);
    mountApp(adapter);
  }
  if (app) {
    try { workspace.attachPanel(mountPanel({ ...workspace, onChange: () => workspace.persist() })); }
    catch {
      const warning = document.createElement('p'); warning.setAttribute('role', 'alert');
      warning.textContent = 'Memory controls are unavailable. Your conversation is retained.';
      document.querySelector('.masthead').append(warning);
    }
    // Inspectable browser-local preview state; no remote endpoint or cross-repo service.
    window.localMemoryPreview = { workspace, app };
  }
} else mountApp();
