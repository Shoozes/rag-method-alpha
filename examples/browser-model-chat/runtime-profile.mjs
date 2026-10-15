const boundaryError = () => Object.assign(new Error('The pinned runtime resource boundary has changed. No model was opened.'), { code: 'ENGINE_BOUNDARY_ERROR' });

// Bind the app's binary feature decision to both WASM and glue. setCompat()
// alone lets wllama 3.5.1 reselect with its weaker constructor-only probe.
export function runtimeResources(profile, workerCode, baseURL) {
  if (!['memory32-asyncify', 'memory64'].includes(profile)) throw boundaryError();
  const compat = profile === 'memory32-asyncify';
  if (compat && (typeof workerCode !== 'string' || !workerCode.trim())) throw boundaryError();
  let wasmPath;
  try { wasmPath = new URL(compat ? './runtime/compat/wllama.wasm' : './runtime/wllama.wasm', baseURL).href; }
  catch { throw boundaryError(); }
  return Object.freeze({ wasmPath, compat, ...(compat ? { jsPath: Object.freeze({ code: workerCode }) } : {}) });
}

export function bindRuntimeResources(engine, resources) {
  try {
    const own = Object.getOwnPropertyDescriptor(engine, 'getWorkerResources');
    if (typeof engine.getWorkerResources !== 'function' || (own && (!own.configurable || !('value' in own)))) throw boundaryError();
    if (!resources || !Object.isFrozen(resources) || typeof resources.wasmPath !== 'string' || typeof resources.compat !== 'boolean') throw boundaryError();
    const url = new URL(resources.wasmPath);
    const suffix = resources.compat ? '/runtime/compat/wllama.wasm' : '/runtime/wllama.wasm';
    if (!url.pathname.endsWith(suffix) || url.search || url.hash) throw boundaryError();
    if (resources.compat
      ? !Object.isFrozen(resources.jsPath) || typeof resources.jsPath?.code !== 'string' || !resources.jsPath.code.trim()
      : resources.jsPath !== undefined) throw boundaryError();
    Object.defineProperty(engine, 'getWorkerResources', { value: () => resources, configurable: false, writable: false });
    return resources;
  } catch { throw boundaryError(); }
}
