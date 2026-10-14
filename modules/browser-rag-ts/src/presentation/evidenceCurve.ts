export interface EvidencePoint { readonly x: number; readonly y: number }

/** A stable presentation curve between an existing relationship's endpoints. */
export function evidenceCurve(from: EvidencePoint, to: EvidencePoint, linkId: string): string | null {
  if (![from.x, from.y, to.x, to.y].every(Number.isFinite)) return null;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance)) return null;
  if (distance < 0.01) return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  let hash = 2166136261;
  for (let index = 0; index < linkId.length; index++) hash = Math.imul(hash ^ linkId.charCodeAt(index), 16777619);
  const bend = Math.min(60, distance * 0.12) * ((hash & 1) ? 1 : -1);
  const x = from.x + dx * 0.5 - dy / distance * bend;
  const y = from.y + dy * 0.5 + dx / distance * bend;
  return `M ${from.x} ${from.y} Q ${x} ${y} ${to.x} ${to.y}`;
}
