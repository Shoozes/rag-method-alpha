// Memory-only input adapter. The existing TSL renderer owns projection and paint.
const SLOP = 6;
const HALF_FOV_TANGENT = Math.tan(25 * Math.PI / 180); // Existing renderer: 50deg.
const finite = value => typeof value === 'number' && Number.isFinite(value);
const point = value => value && finite(value.x) && finite(value.y);

function distance(pose) {
  if (!pose || !point(pose.position) || !point(pose.target)
      || !finite(pose.position.z) || !finite(pose.target.z)
      || Math.abs(pose.position.x - pose.target.x) > 0.000001
      || Math.abs(pose.position.y - pose.target.y) > 0.000001) return null;
  const value = pose.position.z - pose.target.z;
  return value >= 0.1 && value <= 100000 ? value : null;
}

/** Fourfold zoom either side of the fitted front-facing camera. */
export function memoryNavigationLimits(pose) {
  const value = distance(pose);
  return value === null ? null : { minDistance: Math.max(0.1, value / 4), maxDistance: Math.min(100000, value * 4) };
}

/** Keep the graph-plane point under `from` anchored under `to`, without mutation. */
export function memoryCameraPose({ pose, viewport, from, to, scale = 1, limits } = {}) {
  const initial = distance(pose);
  if (initial === null || !point(from) || !point(to) || !finite(scale) || scale <= 0
      || !viewport || !finite(viewport.width) || !finite(viewport.height)
      || viewport.width <= 0 || viewport.height <= 0
      || !limits || !finite(limits.minDistance) || !finite(limits.maxDistance)
      || limits.minDistance < 0.1 || limits.maxDistance > 100000 || limits.minDistance > limits.maxDistance) return null;
  const next = Math.max(limits.minDistance, Math.min(limits.maxDistance, initial / scale));
  const beforeUnits = 2 * initial * HALF_FOV_TANGENT / viewport.height;
  const afterUnits = 2 * next * HALF_FOV_TANGENT / viewport.height;
  const x = pose.target.x + (from.x - viewport.width / 2) * beforeUnits - (to.x - viewport.width / 2) * afterUnits;
  const y = pose.target.y - (from.y - viewport.height / 2) * beforeUnits + (to.y - viewport.height / 2) * afterUnits;
  if (![x, y, next + pose.target.z].every(finite)) return null;
  return { position: { x, y, z: pose.target.z + next }, target: { x, y, z: pose.target.z } };
}

/** Native button taps/keyboard activation remain native; only actual gestures capture. */
export function mountMemoryNavigation({ surface, getRenderer } = {}) {
  if (!surface?.addEventListener || typeof getRenderer !== 'function') throw TypeError('Memory navigation needs a graph surface and renderer accessor.');
  const doc = surface.ownerDocument, view = doc?.defaultView;
  if (!view?.addEventListener) throw TypeError('Memory navigation needs the surface document window.');
  const contacts = new Map(), captured = new Set(), off = [];
  let gesture = null, blocked = false, disposed = false, limits = null, limitRenderer = null, suppressUntil = 0;
  const listen = (target, name, callback, options) => {
    target.addEventListener(name, callback, options);
    off.push(() => target.removeEventListener(name, callback, options));
  };
  const usable = () => {
    const renderer = disposed ? null : getRenderer();
    return renderer && typeof renderer.getCameraPose === 'function' && typeof renderer.setCameraPose === 'function' ? renderer : null;
  };
  const rectangle = () => {
    const value = surface.getBoundingClientRect();
    return [value.left, value.top, value.width, value.height].every(finite) && value.width > 0 && value.height > 0
      ? { left: value.left, top: value.top, width: value.width, height: value.height } : null;
  };
  const location = (event, rect) => ({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  const middle = values => ({ x: (values[0].x + values[1].x) / 2, y: (values[0].y + values[1].y) / 2 });
  const separation = values => Math.max(8, Math.hypot(values[1].x - values[0].x, values[1].y - values[0].y));
  const capture = id => {
    try { surface.setPointerCapture(id); captured.add(id); } catch { /* A contact may end before capture. */ }
  };
  function release() {
    const ids = [...captured]; captured.clear();
    for (const id of ids) try { surface.releasePointerCapture(id); } catch { /* Already released by the browser. */ }
  }
  function cancel() {
    if (gesture || contacts.size) suppressUntil = Date.now() + 750;
    gesture = null; contacts.clear(); blocked = false; release();
    surface.classList?.remove('is-memory-navigating');
  }
  function begin(renderer, rect, moved = false) {
    const pose = renderer.getCameraPose();
    if (renderer !== limitRenderer || !limits) { limitRenderer = renderer; limits = memoryNavigationLimits(pose); }
    if (!limits || distance(pose) === null) return false;
    const values = [...contacts.values()];
    gesture = { renderer, rect, pose, from: values.length === 2 ? middle(values) : values[0],
      span: values.length === 2 ? separation(values) : null, moved: moved || values.length === 2 };
    if (gesture.moved) { for (const id of contacts.keys()) capture(id); surface.classList?.add('is-memory-navigating'); }
    return true;
  }
  function down(event) {
    if (!Number.isInteger(event.pointerId) || (event.pointerType === 'mouse' && event.button !== 0)
        || !finite(event.clientX) || !finite(event.clientY)) return;
    const renderer = usable(), rect = rectangle();
    if (!renderer || !rect) { cancel(); return; }
    if (!contacts.size) suppressUntil = 0;
    contacts.set(event.pointerId, location(event, rect));
    if (contacts.size > 2) {
      blocked = true; gesture = null; suppressUntil = Date.now() + 750; release();
      surface.classList?.remove('is-memory-navigating'); event.preventDefault(); return;
    }
    if (blocked) { event.preventDefault(); return; }
    if (!begin(renderer, rect)) { cancel(); return; }
    if (contacts.size === 2) event.preventDefault();
  }
  function move(event) {
    if (!contacts.has(event.pointerId)) return;
    if (blocked) { event.preventDefault(); return; }
    const renderer = usable(), rect = rectangle();
    if (!gesture || renderer !== gesture.renderer || !rect
        || Object.keys(rect).some(key => rect[key] !== gesture.rect[key])
        || !finite(event.clientX) || !finite(event.clientY)) { cancel(); return; }
    contacts.set(event.pointerId, location(event, rect));
    const values = [...contacts.values()], to = values.length === 2 ? middle(values) : values[0];
    if (!gesture.moved && Math.hypot(to.x - gesture.from.x, to.y - gesture.from.y) < SLOP) return;
    if (!gesture.moved) {
      gesture.moved = true; for (const id of contacts.keys()) capture(id); surface.classList?.add('is-memory-navigating');
    }
    const pose = memoryCameraPose({ pose: gesture.pose, viewport: rect, from: gesture.from, to,
      scale: gesture.span ? separation(values) / gesture.span : 1, limits });
    if (!pose) { cancel(); return; }
    event.preventDefault(); renderer.setCameraPose(pose);
  }
  function end(event) {
    if (!contacts.has(event.pointerId)) return;
    const moved = Boolean(gesture?.moved) || blocked || event.type === 'pointercancel';
    contacts.delete(event.pointerId);
    if (moved) { suppressUntil = Date.now() + 750; event.preventDefault(); }
    // Clear before releasing, so synchronous lostcapture does not cancel a survivor.
    gesture = null;
    const wasCaptured = captured.delete(event.pointerId);
    if (wasCaptured) try { surface.releasePointerCapture(event.pointerId); } catch { /* Browser already released. */ }
    if (event.type === 'pointercancel') { cancel(); return; }
    if (!contacts.size) { blocked = false; release(); surface.classList?.remove('is-memory-navigating'); return; }
    if (!blocked) {
      const renderer = usable(), rect = rectangle();
      if (!renderer || !rect || !begin(renderer, rect, moved)) cancel();
    }
  }
  function wheel(event) {
    if (contacts.size) return;
    const renderer = usable(), rect = rectangle();
    if (!renderer || !rect || !finite(event.deltaY) || !finite(event.clientX) || !finite(event.clientY)) return;
    const pose = renderer.getCameraPose();
    if (renderer !== limitRenderer || !limits) { limitRenderer = renderer; limits = memoryNavigationLimits(pose); }
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
    const at = location(event, rect);
    const next = memoryCameraPose({ pose, viewport: rect, from: at, to: at,
      scale: Math.exp(-Math.max(-240, Math.min(240, delta)) * 0.002), limits });
    if (next) { event.preventDefault(); renderer.setCameraPose(next); }
  }
  const resized = () => { cancel(); limits = null; };
  listen(surface, 'pointerdown', down);
  listen(view, 'pointermove', move, { passive: false });
  listen(view, 'pointerup', end, { passive: false });
  listen(view, 'pointercancel', end, { passive: false });
  // Overlay buttons can lose their implicit capture when this surface takes it.
  listen(surface, 'lostpointercapture', event => { if (event.target === surface && captured.has(event.pointerId)) cancel(); });
  listen(surface, 'click', event => {
    // Enter/Space and assistive activation use detail=0; never suppress them.
    if (event.detail !== 0 && Date.now() < suppressUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, { capture: true });
  listen(surface, 'wheel', wheel, { passive: false });
  listen(surface, 'dragstart', event => { if (usable()) event.preventDefault(); });
  listen(view, 'blur', cancel);
  listen(view, 'resize', resized);
  listen(view, 'orientationchange', resized);
  listen(doc, 'visibilitychange', () => { if (doc.hidden) cancel(); });
  return {
    cancel, resetGesture: cancel,
    fit() { cancel(); const renderer = usable(); limits = null; if (!renderer?.fit) return false; renderer.fit(); return true; },
    dispose() { if (disposed) return; cancel(); disposed = true; for (const remove of off) remove(); },
  };
}
