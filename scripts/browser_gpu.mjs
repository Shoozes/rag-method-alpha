const SOFTWARE = /swiftshader|llvmpipe|softpipe|lavapipe|software|microsoft basic render|\bwarp\b/iu;
const HARDWARE = /nvidia|geforce|quadro|radeon|\bamd\b|\bati\b|intel|apple|adreno|qualcomm|\bmali\b/iu;
const text = value => typeof value === 'string' ? value.slice(0, 512) : '';

export function classifyGraphics(canvas, browserGpu, softwareRequested = false) {
  const strings = [canvas?.unmasked_renderer, canvas?.unmasked_vendor, browserGpu?.renderer];
  if (strings.some(value => typeof value === 'string' && SOFTWARE.test(value))) return 'software';
  const native = canvas?.backend === 'webgl2' && canvas?.context_lost === false
    && canvas?.debug_renderer_info === true && HARDWARE.test(text(canvas?.unmasked_renderer))
    && HARDWARE.test(text(browserGpu?.renderer)) && /^(?:enabled|enabled_on)$/u.test(text(browserGpu?.webgl));
  return native && !softwareRequested ? 'native' : 'unverified';
}

export function requireNativeGraphics(graphics) {
  if (graphics?.status !== 'native' || classifyGraphics(graphics.canvas, graphics.browser_gpu, graphics.software_webgl_requested) !== 'native') {
    throw new Error(`Native GPU WebGL2 evidence is required: ${JSON.stringify(graphics)}`);
  }
}

export async function readBrowserGpu(browser, timeoutMs = 5000) {
  let session;
  let timer;
  let result;
  try {
    session = await browser.newBrowserCDPSession();
    const { gpu } = await Promise.race([
      session.send('SystemInfo.getInfo'),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('GPU diagnostics timed out')), timeoutMs); }),
    ]);
    result = {
      renderer: text(gpu?.auxAttributes?.glRenderer),
      webgl: text(gpu?.featureStatus?.webgl),
      gpu_compositing: text(gpu?.featureStatus?.gpu_compositing),
      devices: (Array.isArray(gpu?.devices) ? gpu.devices : []).slice(0, 8).map(device => ({
        name: text(device?.deviceString), driver_vendor: text(device?.driverVendor), driver_version: text(device?.driverVersion),
      })),
    };
  } catch (error) {
    result = { unavailable: text(error instanceof Error ? error.message : String(error)) };
  } finally {
    clearTimeout(timer);
    if (session) {
      try { await session.detach(); }
      catch (error) { result = { unavailable: `GPU diagnostics did not detach: ${text(error?.message)}` }; }
    }
  }
  return result;
}

export async function readCanvasGraphics(page, browserGpu, softwareRequested = false) {
  const canvas = await page.locator('#graph-tsl-canvas').evaluate(element => {
    const backend = JSON.parse(element.dataset.rendererDiagnostics ?? '{}').selected_backend ?? 'unavailable';
    if (backend !== 'webgl2') return { backend };
    const gl = element.getContext('webgl2');
    if (!gl || gl.isContextLost()) return { backend, context_lost: true };
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      backend, context_lost: false, debug_renderer_info: Boolean(debug),
      vendor: String(gl.getParameter(gl.VENDOR)).slice(0, 512),
      renderer: String(gl.getParameter(gl.RENDERER)).slice(0, 512),
      version: String(gl.getParameter(gl.VERSION)).slice(0, 512),
      unmasked_vendor: debug ? String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)).slice(0, 512) : '',
      unmasked_renderer: debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)).slice(0, 512) : '',
    };
  });
  return { status: classifyGraphics(canvas, browserGpu, softwareRequested),
    software_webgl_requested: softwareRequested, canvas, browser_gpu: browserGpu };
}
