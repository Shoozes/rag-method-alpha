import { FROZEN_PUBLIC_CANCELLATION_CHECKPOINTS } from "../shared/frozenBehaviorPolicy.js";

export type PublicCancellationCheckpoint = typeof FROZEN_PUBLIC_CANCELLATION_CHECKPOINTS[number];
export type InternalSearchYield = "filter.batch" | "rank.batch" | "cross_reference.batch";
export type SearchStep = PublicCancellationCheckpoint | InternalSearchYield;
export type CancellationCheckpoint = (phase: PublicCancellationCheckpoint) => void;

export function checkpoint(callback: CancellationCheckpoint | undefined, phase: PublicCancellationCheckpoint): void {
  callback?.(phase);
}
