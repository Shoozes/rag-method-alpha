// Presentation only. The caller authorizes a fresh committed summary and its exact lineage.
// This helper never creates graph nodes, summaries, memories, permissions or model requests.
export const SUMMARY_EFFECT_MS = 1320;
export const SUMMARY_EFFECT_MAX_SOURCES = 12;
export const SUMMARY_EFFECT_MAX_PARTICLES = 24;
export const SUMMARY_NODE_MERGE_MS = 1080;
export const SUMMARY_NODE_MERGE_MAX_FRAMES = 90;
export const SUMMARY_START_MAX_FRAMES = 8;
const BLUE = 'var(--memory-scope-conversation, #0ea5ff)';
const SUMMARY = 'var(--memory-summary-color, #22e37f)';
const identity = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
const turnIdentity = value => identity(value) && value.startsWith('turn:') && value.length > 5;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const freeze = Object.freeze;

/** Wait for the host's own status/layout work before borrowing real mesh positions. */
export function createSummaryStartGate({ getLayout, isCurrent, start, onUnavailable = () => {},
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis), cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis) } = {}) {
  if ([getLayout, isCurrent, start, onUnavailable, requestFrame, cancelFrame].some(port => typeof port !== 'function')) {
    throw new TypeError('Summary start needs layout, lifecycle and frame ports.');
  }
  let pending = null, disposed = false;
  function cancel() {
    const run = pending; pending = null;
    if (run?.frame !== null && run) cancelFrame(run.frame);
  }
  function unavailable(run) { if (pending !== run) return; cancel(); onUnavailable(run.eventId); }
  return freeze({
    queue(eventId) {
      if (disposed || !identity(eventId) || pending?.eventId === eventId) return false;
      cancel();
      const run = pending = { eventId, frame: null, frames: 0, prior: null, stable: 0 };
      const tick = () => {
        run.frame = null;
        if (pending !== run) return;
        try {
          if (!isCurrent(eventId)) { unavailable(run); return; }
          const layout = getLayout();
          if (!layout || !finite(layout.width) || !finite(layout.height) || layout.width <= 0 || layout.height <= 0
            || !Number.isSafeInteger(layout.revision) || layout.revision < 0) { unavailable(run); return; }
          const key = JSON.stringify([layout.width, layout.height, layout.revision]);
          run.stable = key === run.prior ? run.stable + 1 : 1; run.prior = key; run.frames++;
          if (run.stable >= 2) { pending = null; start(eventId); return; }
          if (run.frames >= SUMMARY_START_MAX_FRAMES) { unavailable(run); return; }
          run.frame = requestFrame(tick);
        } catch { unavailable(run); }
      };
      run.frame = requestFrame(tick); return true;
    },
    cancel,
    diagnostics() { return freeze({ pending: Boolean(pending), eventId: pending?.eventId ?? null,
      frameCount: pending?.frames ?? 0, scheduledFrames: pending?.frame !== null && pending ? 1 : 0 }); },
    dispose() { cancel(); disposed = true; },
  });
}

/** Intersect caller-validated lineage with actual visible projected centers; never invent endpoints. */
export function planSummaryEffects(input, targets, viewport) {
  if (!input || !identity(input.eventId) || !identity(input.targetNodeId)
    || !Array.isArray(input.sourceNodeIds) || !input.sourceNodeIds.length || input.sourceNodeIds.length > 256
    || !input.sourceNodeIds.every(turnIdentity) || input.sourceNodeIds.includes(input.targetNodeId)
    || !Array.isArray(targets) || targets.length > 4096
    || !finite(viewport?.width) || !finite(viewport?.height) || viewport.width <= 0 || viewport.height <= 0) return null;
  const projected = new Map(), ambiguous = new Set();
  for (const point of targets) {
    if (!identity(point?.node_id)) continue;
    if (projected.has(point.node_id) || ambiguous.has(point.node_id)) {
      projected.delete(point.node_id); ambiguous.add(point.node_id); continue;
    }
    projected.set(point.node_id, point);
  }
  const pointFor = id => {
    const point = projected.get(id);
    if (!point?.visible || !finite(point.x) || !finite(point.y) || point.x < 0 || point.y < 0
      || point.x > viewport.width || point.y > viewport.height) return null;
    return freeze({ nodeId: id, x: point.x, y: point.y });
  };
  const target = pointFor(input.targetNodeId), requestedIds = [...new Set(input.sourceNodeIds)];
  const sources = target ? requestedIds.map(pointFor).filter(Boolean).slice(0, SUMMARY_EFFECT_MAX_SOURCES) : [];
  return freeze({ eventId: input.eventId, targetNodeId: input.targetNodeId, target,
    sources: freeze(sources), requestedSourceCount: requestedIds.length,
    omittedSourceCount: requestedIds.length - sources.length, width: viewport.width, height: viewport.height });
}

/** Resolve world endpoints from the same real renderer nodes used by the screen overlay. */
export function planSummaryNodeMerge(plan, positions) {
  if (!plan?.target || !Array.isArray(plan.sources) || !plan.sources.length
    || plan.sources.length > SUMMARY_EFFECT_MAX_SOURCES || !Array.isArray(positions) || positions.length > 4096) return null;
  const points = new Map(), ambiguous = new Set();
  for (const point of positions) {
    if (!identity(point?.node_id)) continue;
    if (points.has(point.node_id) || ambiguous.has(point.node_id)) { points.delete(point.node_id); ambiguous.add(point.node_id); continue; }
    if ([point.x, point.y, point.z].every(value => finite(value) && Math.abs(value) <= 100000)) {
      points.set(point.node_id, freeze({ node_id: point.node_id, x: point.x, y: point.y, z: point.z }));
    }
  }
  const target = points.get(plan.targetNodeId), sources = plan.sources.map(source => points.get(source.nodeId));
  if (!target || sources.some(source => !source)) return null;
  return freeze({ target, sources: freeze(sources) });
}

/** Source identities stay fixed while their actual meshes converge on the retained target. */
export function sampleSummaryNodeMerge(plan, elapsedMs) {
  if (!plan || !finite(elapsedMs)) return null;
  const progress = Math.max(0, Math.min(1, elapsedMs / SUMMARY_NODE_MERGE_MS));
  const fraction = 1 - (1 - Math.min(1, progress / .82)) ** 3;
  return freeze({ progress, phase: fraction === 1 ? 'merged' : 'merging',
    positions: freeze(plan.sources.map(source => freeze({ node_id: source.node_id,
      x: source.x + (plan.target.x - source.x) * fraction,
      y: source.y + (plan.target.y - source.y) * fraction,
      z: source.z + (plan.target.z - source.z) * fraction }))) });
}

const style = (element, values) => Object.assign(element.style, values);
const translate = (x, y, scale = 1) => `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${scale})`;
function arcPoint(source, target, bend, t) {
  const dx = target.x - source.x, dy = target.y - source.y, length = Math.hypot(dx, dy) || 1;
  const cx = (source.x + target.x) / 2 - dy / length * bend;
  const cy = (source.y + target.y) / 2 + dx / length * bend;
  return { x: (1 - t) ** 2 * source.x + 2 * (1 - t) * t * cx + t ** 2 * target.x,
    y: (1 - t) ** 2 * source.y + 2 * (1 - t) * t * cy + t ** 2 * target.y, cx, cy };
}

/**
 * play({ eventId, sourceNodeIds, targetNodeId }) is for a newly committed, retained summary only.
 * Seed restored IDs with initialEventIds. stop() on navigation, visibility, camera or motion changes.
 * A consumed event never replays, including unavailable/offscreen/interrupted presentations.
 * Web Animations own the light overlay. One bounded frame loop moves actual renderer nodes.
 */
export function createSummaryEffects({ container, getTargets, getMotionEnabled = () => false,
  getNodeColor = () => undefined,
  getNodePositions = () => [], beginNodePresentation = () => null, onFinish = () => {},
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis), cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
  initialEventIds = [], document = container?.ownerDocument, schedule = setTimeout, unschedule = clearTimeout } = {}) {
  if (!container || !document?.createElement || !document?.createElementNS || typeof getTargets !== 'function'
    || typeof getMotionEnabled !== 'function' || typeof schedule !== 'function' || typeof unschedule !== 'function'
    || typeof getNodePositions !== 'function' || typeof beginNodePresentation !== 'function' || typeof onFinish !== 'function'
    || !Array.isArray(initialEventIds)) throw new TypeError('Summary effects need a container, projection and motion ports.');
  const seen = new Set(initialEventIds.filter(identity));
  let disposed = false, active = null;
  const outcome = (reason, plan, extra = {}) => freeze({ played: false, reason, sourceCount: plan?.sources.length ?? 0,
    omittedSourceCount: plan?.omittedSourceCount ?? 0, particleCount: 0, reducedMotion: false, ...extra });
  function finish(eventId) { try { onFinish(eventId); } catch { /* A visual callback cannot undo a committed summary. */ } }
  function stop() {
    if (!active) return;
    const run = active; active = null;
    if (run.timer !== null) unschedule(run.timer);
    run.timer = null;
    if (run.frame !== null && typeof cancelFrame === 'function') cancelFrame(run.frame);
    run.frame = null;
    for (const animation of run.animations) { try { animation.cancel(); } catch { /* Optional presentation only. */ } }
    run.animations.clear(); run.overlay.remove();
    // The owning projection removes represented sources in this same task before paint.
    // The lease also restores originals on interruption, topology changes and disposal.
    finish(run.eventId);
    try { run.nodePresentation?.restore(); } catch { /* Renderer may already be gone. */ }
  }
  function animate(run, element, frames, timing) {
    const animation = element.animate(frames, { ...timing, fill: 'both' });
    run.animations.add(animation);
  }
  function ringFor(overlay, target) {
    const ring = document.createElement('span'); ring.className = 'memory-summary-formation';
    ring.dataset.nodeId = target.nodeId;
    style(ring, { position: 'absolute', left: '0', top: '0', width: '44px', height: '44px', borderRadius: '50%',
      border: `1.5px solid ${SUMMARY}`, boxShadow: `0 0 16px ${SUMMARY}, inset 0 0 10px ${SUMMARY}`,
      transform: translate(target.x, target.y), opacity: '.8' });
    overlay.append(ring); return ring;
  }
  return freeze({
    play(input) {
      if (disposed) return outcome('disposed');
      if (!identity(input?.eventId)) return outcome('invalid-lineage');
      if (seen.has(input.eventId)) return outcome('already-seen');
      // Consume before any optional layout/DOM work: an interrupted success must stay historical.
      seen.add(input.eventId); stop();
      let motion = false;
      try { motion = getMotionEnabled() === true; } catch { /* Fail to static feedback. */ }
      // Reduced motion settles the real graph immediately, then locates its real target.
      if (!motion) finish(input.eventId);
      let plan;
      try { plan = planSummaryEffects(input, getTargets(), { width: container.clientWidth, height: container.clientHeight }); }
      catch { return outcome('unavailable'); }
      if (!plan) return outcome('invalid-lineage');
      if (!plan.target) return outcome('target-not-visible', plan);
      if (!plan.sources.length && motion) return outcome('sources-not-visible', plan);
      const overlay = document.createElement('div'); overlay.className = 'memory-summary-effects';
      overlay.setAttribute('aria-hidden', 'true'); overlay.dataset.eventId = plan.eventId;
      overlay.dataset.targetNodeId = plan.targetNodeId; overlay.dataset.reducedMotion = String(!motion);
      style(overlay, { position: 'absolute', inset: '0', zIndex: '25', pointerEvents: 'none', overflow: 'hidden' });
      const run = active = { overlay, animations: new Set(), timer: null, frame: null, nodePresentation: null,
        eventId: plan.eventId, particleCount: 0, trailCount: 0, movingNodeCount: 0, frameCount: 0, phase: 'static' };
      let reason = motion ? 'played' : 'reduced-motion';
      try {
        container.append(overlay);
        const ring = ringFor(overlay, plan.target);
        if (motion && typeof ring.animate === 'function') {
          const merge = typeof requestFrame === 'function' && typeof cancelFrame === 'function'
            ? planSummaryNodeMerge(plan, getNodePositions()) : null;
          if (merge) {
            const presentation = beginNodePresentation(merge.sources.map(source => source.node_id), { targetColor: getNodeColor(plan.targetNodeId) });
            if (presentation?.active && Array.isArray(presentation.positions)
              && presentation.positions.length === merge.sources.length
              && presentation.positions.every((point, index) => ['node_id', 'x', 'y', 'z'].every(key => point[key] === merge.sources[index][key]))) {
              run.nodePresentation = presentation; run.movingNodeCount = merge.sources.length;
              overlay.dataset.movingNodeCount = String(run.movingNodeCount);
              overlay.dataset.sourceNodeIds = JSON.stringify(merge.sources.map(source => source.node_id));
              let started = null;
              const tick = time => {
                run.frame = null;
                if (active !== run) return;
                try {
                  if (!finite(time) || !presentation.active || document.visibilityState === 'hidden' || getMotionEnabled() !== true) { stop(); return; }
                  started ??= time;
                  const elapsed = ++run.frameCount >= SUMMARY_NODE_MERGE_MAX_FRAMES ? SUMMARY_NODE_MERGE_MS : Math.max(0, time - started);
                  overlay.dataset.nodeMergeFrameCount = String(run.frameCount);
                  const sample = sampleSummaryNodeMerge(merge, elapsed);
                  if (!presentation.update(sample.positions, sample.progress)) { stop(); return; }
                  run.phase = sample.phase; overlay.dataset.nodeMergePhase = sample.phase;
                  if (sample.progress < 1) run.frame = requestFrame(tick);
                } catch { stop(); }
              };
              run.frame = requestFrame(tick);
            } else presentation?.restore?.();
          }
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('viewBox', `0 0 ${plan.width} ${plan.height}`);
          svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%');
          style(svg, { position: 'absolute', inset: '0', overflow: 'hidden' }); overlay.prepend(svg);
          for (const [index, source] of plan.sources.entries()) {
            const bend = Math.min(34, Math.hypot(plan.target.x - source.x, plan.target.y - source.y) * .14) * (index % 2 ? -1 : 1);
            const mid = arcPoint(source, plan.target, bend, .5), delay = index * 9;
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.dataset.sourceNodeId = source.nodeId; path.dataset.targetNodeId = plan.targetNodeId;
            path.setAttribute('d', `M ${source.x} ${source.y} Q ${mid.cx} ${mid.cy} ${plan.target.x} ${plan.target.y}`);
            path.setAttribute('fill', 'none'); path.setAttribute('stroke', SUMMARY); path.setAttribute('stroke-width', '1');
            path.setAttribute('stroke-linecap', 'round'); path.style.opacity = '0'; svg.append(path); run.trailCount++;
            animate(run, path, [{ opacity: 0 }, { opacity: .46, offset: .2 }, { opacity: .24, offset: .7 }, { opacity: 0 }],
              { duration: 1000, delay, easing: 'ease-out' });
            for (let spark = 0; spark < 2; spark++) {
              const particle = document.createElement('span'); particle.className = 'memory-summary-particle';
              particle.dataset.sourceNodeId = source.nodeId; particle.dataset.targetNodeId = plan.targetNodeId;
              style(particle, { position: 'absolute', left: '0', top: '0', width: spark ? '3px' : '4px',
                height: spark ? '3px' : '4px', borderRadius: '50%', background: BLUE,
                boxShadow: `0 0 5px 2px ${BLUE}, 0 0 13px ${BLUE}`, opacity: '0' });
              overlay.append(particle); run.particleCount++;
              const frames = [0, .25, .5, .75, 1].map(t => {
                const point = arcPoint(source, plan.target, bend, t);
                return { transform: translate(point.x, point.y, 1 - t * .35), background: t < .5 ? BLUE : SUMMARY,
                  boxShadow: `0 0 5px 2px ${t < .5 ? BLUE : SUMMARY}, 0 0 13px ${t < .5 ? BLUE : SUMMARY}`,
                  opacity: t === 0 || t === 1 ? 0 : .95, offset: t };
              });
              animate(run, particle, frames, { duration: 850, delay: delay + spark * 100, easing: 'cubic-bezier(.32,.05,.3,1)' });
            }
          }
          animate(run, ring, [{ transform: translate(plan.target.x, plan.target.y, .55), opacity: 0 },
            { transform: translate(plan.target.x, plan.target.y, 1), opacity: .95, offset: .35 },
            { transform: translate(plan.target.x, plan.target.y, 1.45), opacity: 0 }],
          { duration: 540, delay: 690, easing: 'ease-out' });
        } else if (motion) reason = 'static-fallback';
        // One bounded expiry, no per-frame callbacks or promise continuation after settling.
        run.timer = schedule(() => { if (active === run) stop(); }, SUMMARY_EFFECT_MS);
        return outcome(reason, plan, { played: true, particleCount: run.particleCount,
          movingNodeCount: run.movingNodeCount, reducedMotion: !motion });
      } catch {
        stop(); return outcome('unavailable', plan);
      }
    },
    stop,
    diagnostics() { return freeze({ disposed, active: Boolean(active), eventId: active?.eventId ?? null,
      particleCount: active?.particleCount ?? 0, trailCount: active?.trailCount ?? 0,
      animationCount: active?.animations.size ?? 0, scheduledCallbacks: active?.timer === null || !active ? 0 : 1,
      movingNodeCount: active?.movingNodeCount ?? 0, framePending: active?.frame !== null && Boolean(active),
      frameCount: active?.frameCount ?? 0, nodeMergePhase: active?.phase ?? null,
      consumedEventCount: seen.size }); },
    dispose() { if (disposed) return; stop(); disposed = true; seen.clear(); },
  });
}
