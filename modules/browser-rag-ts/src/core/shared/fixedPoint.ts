export const MICRO_UNITS = 1_000_000;

export function clampMicro(value: number): number {
  return Math.max(-MICRO_UNITS, Math.min(MICRO_UNITS, Math.trunc(value)));
}

export function quantizeCosine(value: number): number {
  if (!Number.isFinite(value)) throw new Error("cosine must be finite");
  return Math.max(0, Math.min(MICRO_UNITS, Math.floor(Math.max(0, Math.min(1, value)) * MICRO_UNITS + 0.5)));
}

export function weightedComponent(componentMicro: number, weightMicro: number): number {
  return componentMicro * weightMicro;
}

export function truncateTowardZero(value: number): number {
  return value < 0 ? Math.ceil(value) : Math.floor(value);
}
