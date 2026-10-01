/** Yield real tasks on a time budget; microtask-only yields cannot deliver cancellation. */
export function cooperativeScheduler(
  check: () => void,
  budgetMs = 8,
  now: () => number = () => performance.now(),
  yieldTask: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 0)),
): (force?: boolean) => Promise<void> {
  let deadline = now() + budgetMs;
  return async (force = false) => {
    check();
    if (force || now() >= deadline) {
      await yieldTask();
      check();
      deadline = now() + budgetMs;
    }
  };
}
