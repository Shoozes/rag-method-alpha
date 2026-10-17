// Presentation only. The caller authorizes a fresh committed summary and its exact lineage.
// This helper never creates graph nodes, summaries, memories, permissions or model requests.
export const SUMMARY_EFFECT_MS = 1320;
export const SUMMARY_EFFECT_MAX_SOURCES = 12;
export const SUMMARY_EFFECT_MAX_PARTICLES = 24;
const BLUE = 'var(--memory-scope-conversation, #0ea5ff)';
const identity = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
const turnIdentity = value => identity(value) && value.startsWith('turn:') && value.length > 5;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const freeze = Object.freeze;

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
 * Web Animations own the bounded interpolation; there is no application animation-frame loop.
 */
export function createSummaryEffects({ container, getTargets, getMotionEnabled = () => false,
  initialEventIds = [], document = container?.ownerDocument, schedule = setTimeout, unschedule = clearTimeout } = {}) {
  if (!container || !document?.createElement || !document?.createElementNS || typeof getTargets !== 'function'
    || typeof getMotionEnabled !== 'function' || typeof schedule !== 'function' || typeof unschedule !== 'function'
    || !Array.isArray(initialEventIds)) throw new TypeError('Summary effects need a container, projection and motion ports.');
  const seen = new Set(initialEventIds.filter(identity));
  let disposed = false, active = null;
  const outcome = (reason, plan, extra = {}) => freeze({ played: false, reason, sourceCount: plan?.sources.length ?? 0,
    omittedSourceCount: plan?.omittedSourceCount ?? 0, particleCount: 0, reducedMotion: false, ...extra });
  function stop() {
    if (!active) return;
    const run = active; active = null;
    if (run.timer !== null) unschedule(run.timer);
    run.timer = null;
    for (const animation of run.animations) { try { animation.cancel(); } catch { /* Optional presentation only. */ } }
    run.animations.clear(); run.overlay.remove();
  }
  function animate(run, element, frames, timing) {
    const animation = element.animate(frames, { ...timing, fill: 'both' });
    run.animations.add(animation);
  }
  function ringFor(overlay, target) {
    const ring = document.createElement('span'); ring.className = 'memory-summary-formation';
    ring.dataset.nodeId = target.nodeId;
    style(ring, { position: 'absolute', left: '0', top: '0', width: '44px', height: '44px', borderRadius: '50%',
      border: `1.5px solid ${BLUE}`, boxShadow: `0 0 16px ${BLUE}, inset 0 0 10px ${BLUE}`,
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
      let plan;
      try { plan = planSummaryEffects(input, getTargets(), { width: container.clientWidth, height: container.clientHeight }); }
      catch { return outcome('unavailable'); }
      if (!plan) return outcome('invalid-lineage');
      if (!plan.target) return outcome('target-not-visible', plan);
      if (!plan.sources.length) return outcome('sources-not-visible', plan);
      let motion = false;
      try { motion = getMotionEnabled() === true; } catch { /* Fail to static feedback. */ }
      const overlay = document.createElement('div'); overlay.className = 'memory-summary-effects';
      overlay.setAttribute('aria-hidden', 'true'); overlay.dataset.eventId = plan.eventId;
      overlay.dataset.targetNodeId = plan.targetNodeId; overlay.dataset.reducedMotion = String(!motion);
      style(overlay, { position: 'absolute', inset: '0', zIndex: '25', pointerEvents: 'none', overflow: 'hidden' });
      const run = active = { overlay, animations: new Set(), timer: null, eventId: plan.eventId, particleCount: 0, trailCount: 0 };
      let reason = motion ? 'played' : 'reduced-motion';
      try {
        container.append(overlay);
        const ring = ringFor(overlay, plan.target);
        if (motion && typeof ring.animate === 'function') {
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
            path.setAttribute('fill', 'none'); path.setAttribute('stroke', BLUE); path.setAttribute('stroke-width', '1');
            path.setAttribute('stroke-linecap', 'round'); path.style.opacity = '0'; svg.append(path); run.trailCount++;
            animate(run, path, [{ opacity: 0 }, { opacity: .46, offset: .2 }, { opacity: .24, offset: .7 }, { opacity: 0 }],
              { duration: 1000, delay, easing: 'ease-out' });
            for (let spark = 0; spark < 2; spark++) {
              const particle = document.createElement('span'); particle.className = 'memory-summary-particle';
              particle.dataset.sourceNodeId = source.nodeId; particle.dataset.targetNodeId = plan.targetNodeId;
              style(particle, { position: 'absolute', left: '0', top: '0', width: spark ? '3px' : '4px',
                height: spark ? '3px' : '4px', borderRadius: '50%', background: '#e3f7ff',
                boxShadow: `0 0 5px 2px ${BLUE}, 0 0 13px ${BLUE}`, opacity: '0' });
              overlay.append(particle); run.particleCount++;
              const frames = [0, .25, .5, .75, 1].map(t => {
                const point = arcPoint(source, plan.target, bend, t);
                return { transform: translate(point.x, point.y, 1 - t * .35), opacity: t === 0 || t === 1 ? 0 : .95, offset: t };
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
        return outcome(reason, plan, { played: true, particleCount: run.particleCount, reducedMotion: !motion });
      } catch {
        stop(); return outcome('unavailable', plan);
      }
    },
    stop,
    diagnostics() { return freeze({ disposed, active: Boolean(active), eventId: active?.eventId ?? null,
      particleCount: active?.particleCount ?? 0, trailCount: active?.trailCount ?? 0,
      animationCount: active?.animations.size ?? 0, scheduledCallbacks: active?.timer === null || !active ? 0 : 1,
      consumedEventCount: seen.size }); },
    dispose() { if (disposed) return; stop(); disposed = true; seen.clear(); },
  });
}
