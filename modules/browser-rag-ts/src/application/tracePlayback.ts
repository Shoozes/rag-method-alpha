/** Presentation ownership only. Stopping a trace never cancels or changes retrieval. */
export class TracePlayback {
  private controller: AbortController | null = null;
  stop(): void { this.controller?.abort(); this.controller = null; }
  async play(ids: readonly string[], step: (ids: readonly string[], current: string) => void, reducedMotion: boolean): Promise<boolean> {
    this.stop();
    const acceptedIds = [...ids];
    if (reducedMotion || !acceptedIds.length) return true;
    const controller = new AbortController();
    this.controller = controller;
    try {
      for (let index = 0; index < acceptedIds.length; index++) {
        if (controller.signal.aborted) return false;
        step(acceptedIds.slice(0, index + 1), acceptedIds[index]!);
        // A synchronous callback can cancel or supersede us before a timer exists.
        if (controller.signal.aborted) return false;
        await new Promise<void>((resolve) => {
          const finish = () => { clearTimeout(timer); controller.signal.removeEventListener("abort", finish); resolve(); };
          const timer = setTimeout(finish, Math.min(360, 2400 / acceptedIds.length));
          controller.signal.addEventListener("abort", finish, { once: true });
        });
      }
      return !controller.signal.aborted;
    } finally { if (this.controller === controller) this.controller = null; }
  }
}
