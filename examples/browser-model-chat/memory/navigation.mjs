// Memory-only input adapter. The existing TSL renderer owns projection and paint.
const SLOP = 6;
const HALF_FOV_TANGENT = Math.tan(25 * Math.PI / 180); // Existing renderer: 50deg.
const POLE_MARGIN = 0.01;
const DAMPING_MS = 160;
const MAX_DAMPING_FRAMES = 48;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const point = value => value && finite(value.x) && finite(value.y);
const vector = value => point(value) && finite(value.z);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const copy = pose => ({ position: { ...pose.position }, target: { ...pose.target } });

function distance(pose) {
  if (!pose || !vector(pose.position) || !vector(pose.target)) return null;
  const value = Math.hypot(pose.position.x - pose.target.x, pose.position.y - pose.target.y, pose.position.z - pose.target.z);
  return value >= 0.1 && value <= 100000 ? value : null;
}
const validViewport = value => value && finite(value.width) && finite(value.height) && value.width > 0 && value.height > 0;
function basis(pose, radius) {
  const back = { x: (pose.position.x - pose.target.x) / radius, y: (pose.position.y - pose.target.y) / radius,
    z: (pose.position.z - pose.target.z) / radius };
  const horizontal = Math.hypot(back.x, back.z);
  // The renderer uses world-Y up. At its pole, use the same stable X fallback.
  const right = horizontal > 0.000001 ? { x: back.z / horizontal, y: 0, z: -back.x / horizontal } : { x: 1, y: 0, z: 0 };
  const up = { x: back.y * right.z - back.z * right.y, y: back.z * right.x - back.x * right.z,
    z: back.x * right.y - back.y * right.x };
  return { back, right, up };
}
function sphericalPose(target, radius, theta, phi) {
  const horizontal = Math.sin(phi) * radius;
  const position = { x: target.x + horizontal * Math.sin(theta), y: target.y + Math.cos(phi) * radius,
    z: target.z + horizontal * Math.cos(theta) };
  return vector(position) ? { position, target: { ...target } } : null;
}

/** Fourfold distance either side of the fitted camera, independent of orientation. */
export function memoryNavigationLimits(pose) {
  const value = distance(pose);
  return value === null ? null : { minDistance: Math.max(0.1, value / 4), maxDistance: Math.min(100000, value * 4) };
}

/** Anchor the camera-facing plane through target under a moving pinch centroid. */
export function memoryCameraPose({ pose, viewport, from, to, scale = 1, limits } = {}) {
  const initial = distance(pose);
  if (initial === null || !point(from) || !point(to) || !finite(scale) || scale <= 0
      || !validViewport(viewport)
      || !limits || !finite(limits.minDistance) || !finite(limits.maxDistance)
      || limits.minDistance < 0.1 || limits.maxDistance > 100000 || limits.minDistance > limits.maxDistance) return null;
  const next = clamp(initial / scale, limits.minDistance, limits.maxDistance);
  const { back, right, up } = basis(pose, initial);
  const beforeUnits = 2 * initial * HALF_FOV_TANGENT / viewport.height;
  const afterUnits = 2 * next * HALF_FOV_TANGENT / viewport.height;
  const horizontal = (from.x - viewport.width / 2) * beforeUnits - (to.x - viewport.width / 2) * afterUnits;
  const vertical = -(from.y - viewport.height / 2) * beforeUnits + (to.y - viewport.height / 2) * afterUnits;
  const target = {}, position = {};
  for (const key of ['x', 'y', 'z']) {
    target[key] = pose.target[key] + right[key] * horizontal + up[key] * vertical;
    position[key] = target[key] + back[key] * next;
  }
  return vector(target) && vector(position) ? { position, target } : null;
}

/** Orbit about target without changing the fitted distance or crossing a pole. */
export function memoryOrbitPose({ pose, viewport, from, to } = {}) {
  const radius = distance(pose);
  if (radius === null || !validViewport(viewport) || !point(from) || !point(to)) return null;
  const theta = Math.atan2(pose.position.x - pose.target.x, pose.position.z - pose.target.z)
    - (to.x - from.x) * Math.PI * 2 / viewport.width;
  const phi = Math.acos(clamp((pose.position.y - pose.target.y) / radius, -1, 1))
    - (to.y - from.y) * Math.PI / viewport.height;
  return finite(theta) && finite(phi) ? sphericalPose(pose.target, radius, theta % (Math.PI * 2), clamp(phi, POLE_MARGIN, Math.PI - POLE_MARGIN)) : null;
}

function interpolatePose(from, to, fraction) {
  if (fraction >= 1) return copy(to);
  const a = distance(from), b = distance(to);
  if (a === null || b === null) return null;
  const theta = pose => Math.atan2(pose.position.x - pose.target.x, pose.position.z - pose.target.z);
  const phi = (pose, radius) => Math.acos(clamp((pose.position.y - pose.target.y) / radius, -1, 1));
  const start = theta(from), angle = Math.atan2(Math.sin(theta(to) - start), Math.cos(theta(to) - start));
  const target = {};
  for (const key of ['x', 'y', 'z']) target[key] = from.target[key] + (to.target[key] - from.target[key]) * fraction;
  return sphericalPose(target, a + (b - a) * fraction, start + angle * fraction,
    phi(from, a) + (phi(to, b) - phi(from, a)) * fraction);
}

/** Native button taps/keyboard activation remain native; only actual gestures capture. */
export function mountMemoryNavigation({ surface, getRenderer, getMotionEnabled } = {}) {
  if (!surface?.addEventListener || typeof getRenderer !== 'function') throw TypeError('Memory navigation needs a graph surface and renderer accessor.');
  if (getMotionEnabled !== undefined && typeof getMotionEnabled !== 'function') throw TypeError('Memory motion preference must be an accessor.');
  const doc = surface.ownerDocument, view = doc?.defaultView;
  if (!view?.addEventListener) throw TypeError('Memory navigation needs the surface document window.');
  const contacts = new Map(), captured = new Set(), off = [];
  let gesture = null, blocked = false, multiple = false, disposed = false, limits = null, limitRenderer = null, suppressUntil = 0;
  let damping = null, frame = null;
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
  const motionEnabled = () => {
    try { return typeof view.requestAnimationFrame === 'function' && typeof view.cancelAnimationFrame === 'function'
      && (getMotionEnabled ? getMotionEnabled() === true : Boolean(view.matchMedia && !view.matchMedia('(prefers-reduced-motion: reduce)').matches)); }
    catch { return false; }
  };
  function stopDamping() {
    if (frame !== null) view.cancelAnimationFrame(frame);
    frame = null; damping = null;
  }
  function flushDamping() {
    const pending = damping; stopDamping();
    if (pending && usable() === pending.renderer) pending.renderer.setCameraPose(pending.target);
  }
  function applyPose(renderer, target, rect) {
    stopDamping();
    const current = renderer.getCameraPose();
    if (!motionEnabled() || distance(current) === null) { renderer.setCameraPose(target); return; }
    // Respond on the input event, then finish a finite ease; never extrapolate velocity.
    const from = interpolatePose(current, target, 0.35);
    if (!from) { renderer.setCameraPose(target); return; }
    renderer.setCameraPose(from);
    const pending = damping = { renderer, from, target, rect, started: null, frames: 0 };
    const tick = time => {
      if (damping !== pending) return;
      frame = null;
      const actualRect = rectangle();
      if (!finite(time) || usable() !== renderer || !actualRect || Object.keys(rect).some(key => actualRect[key] !== rect[key]) || doc.hidden) { stopDamping(); return; }
      if (!motionEnabled()) { renderer.setCameraPose(target); stopDamping(); return; }
      pending.started ??= time;
      const elapsed = Math.max(0, time - pending.started);
      const progress = ++pending.frames >= MAX_DAMPING_FRAMES ? 1 : clamp(elapsed / DAMPING_MS, 0, 1);
      const next = interpolatePose(from, target, 1 - (1 - progress) ** 3);
      if (!next) { stopDamping(); return; }
      renderer.setCameraPose(next);
      if (progress < 1) frame = view.requestAnimationFrame(tick); else damping = null;
    };
    frame = view.requestAnimationFrame(tick);
  }
  const capture = id => {
    try { surface.setPointerCapture(id); captured.add(id); } catch { /* A contact may end before capture. */ }
  };
  function release() {
    const ids = [...captured]; captured.clear();
    for (const id of ids) try { surface.releasePointerCapture(id); } catch { /* Already released by the browser. */ }
  }
  function cancel() {
    if (gesture || contacts.size) suppressUntil = Date.now() + 750;
    stopDamping(); gesture = null; contacts.clear(); blocked = false; multiple = false; release();
    surface.classList?.remove('is-memory-navigating');
  }
  function begin(renderer, rect, moved = false) {
    const pose = renderer.getCameraPose();
    if (renderer !== limitRenderer || !limits) { limitRenderer = renderer; limits = memoryNavigationLimits(pose); }
    if (!limits || distance(pose) === null) return false;
    const values = [...contacts.values()];
    gesture = { renderer, rect, pose, from: values.length === 2 ? middle(values) : values[0],
      span: values.length === 2 ? separation(values) : null, moved };
    if (gesture.moved) { for (const id of contacts.keys()) capture(id); surface.classList?.add('is-memory-navigating'); }
    return true;
  }
  function down(event) {
    if (!Number.isInteger(event.pointerId) || (event.pointerType === 'mouse' && event.button !== 0)
        || !finite(event.clientX) || !finite(event.clientY)) return;
    const renderer = usable(), rect = rectangle();
    if (!renderer || !rect) { cancel(); return; }
    if (!contacts.size) { stopDamping(); suppressUntil = 0; multiple = false; }
    else if (!blocked && contacts.size === 1) flushDamping();
    contacts.set(event.pointerId, location(event, rect));
    if (contacts.size > 2) {
      stopDamping(); blocked = true; gesture = null; suppressUntil = Date.now() + 750; release();
      surface.classList?.remove('is-memory-navigating'); event.preventDefault(); return;
    }
    if (blocked) { event.preventDefault(); return; }
    if (!begin(renderer, rect)) { cancel(); return; }
    if (contacts.size === 2) { multiple = true; event.preventDefault(); }
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
    const span = gesture.span ? separation(values) : null;
    if (!gesture.moved && Math.max(Math.hypot(to.x - gesture.from.x, to.y - gesture.from.y), span ? Math.abs(span - gesture.span) : 0) < SLOP) return;
    if (!gesture.moved) {
      gesture.moved = true; for (const id of contacts.keys()) capture(id); surface.classList?.add('is-memory-navigating');
    }
    const pose = gesture.span ? memoryCameraPose({ pose: gesture.pose, viewport: rect, from: gesture.from, to, scale: span / gesture.span, limits })
      : memoryOrbitPose({ pose: gesture.pose, viewport: rect, from: gesture.from, to });
    if (!pose) { cancel(); return; }
    event.preventDefault(); applyPose(renderer, pose, rect);
  }
  function end(event) {
    if (!contacts.has(event.pointerId)) return;
    const moved = Boolean(gesture?.moved), suppress = moved || multiple || blocked || event.type === 'pointercancel';
    contacts.delete(event.pointerId);
    if (suppress) { suppressUntil = Date.now() + 750; event.preventDefault(); }
    // Clear before releasing, so synchronous lostcapture does not cancel a survivor.
    gesture = null;
    const wasCaptured = captured.delete(event.pointerId);
    if (wasCaptured) try { surface.releasePointerCapture(event.pointerId); } catch { /* Browser already released. */ }
    if (event.type === 'pointercancel') { cancel(); return; }
    if (!contacts.size) { blocked = false; multiple = false; release(); surface.classList?.remove('is-memory-navigating'); return; }
    if (!blocked) {
      flushDamping();
      const renderer = usable(), rect = rectangle();
      if (!renderer || !rect || !begin(renderer, rect, moved)) cancel();
    }
  }
  function wheel(event) {
    if (contacts.size) return;
    const renderer = usable(), rect = rectangle();
    if (!renderer || !rect || !finite(event.deltaY) || !finite(event.clientX) || !finite(event.clientY)) return;
    const pose = damping?.renderer === renderer ? damping.target : renderer.getCameraPose();
    if (renderer !== limitRenderer || !limits) { limitRenderer = renderer; limits = memoryNavigationLimits(pose); }
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
    const at = location(event, rect);
    const next = memoryCameraPose({ pose, viewport: rect, from: at, to: at,
      scale: Math.exp(-Math.max(-240, Math.min(240, delta)) * 0.002), limits });
    if (next) { event.preventDefault(); applyPose(renderer, next, rect); }
  }
  const resized = () => cancel();
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
    /** Bind after the new renderer's initial Fit and before restoring its user pose. */
    bind(nextRenderer, { preserveLimits = false } = {}) {
      cancel();
      if (disposed || typeof preserveLimits !== 'boolean' || !nextRenderer
        || typeof nextRenderer.getCameraPose !== 'function' || typeof nextRenderer.setCameraPose !== 'function') return false;
      let fitted;
      try { fitted = memoryNavigationLimits(nextRenderer.getCameraPose()); } catch { return false; }
      if (!fitted) return false;
      const retained = preserveLimits && limits && finite(limits.minDistance) && finite(limits.maxDistance)
        && limits.minDistance >= 0.1 && limits.maxDistance <= 100000 && limits.minDistance <= limits.maxDistance;
      limits = { ...(retained ? limits : fitted) }; limitRenderer = nextRenderer;
      return true;
    },
    fit() { cancel(); const renderer = usable(); limits = null; if (!renderer?.fit) return false; renderer.fit(); limitRenderer = renderer; limits = memoryNavigationLimits(renderer.getCameraPose()); return true; },
    dispose() { if (disposed) return; cancel(); disposed = true; for (const remove of off) remove(); },
  };
}
