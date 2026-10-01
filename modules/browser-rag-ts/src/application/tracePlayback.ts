/** Presentation ownership only. Stopping a trace never cancels or changes retrieval. */
export class TracePlayback {
  private controller: AbortController | null = null;
  stop(): void { this.controller?.abort(); this.controller = null; }
  async play(ids: readonly string[], step: (ids: readonly string[], current: string) => void, reducedMotion: boolean): Promise<boolean> {
    this.stop();
    if (reducedMotion || !ids.length) return true;
    const controller = new AbortController();
    this.controller = controller;
    try {
      for (let index = 0; index < ids.length; index++) {
        if (controller.signal.aborted) return false;
        step(ids.slice(0, index + 1), ids[index]!);
        await new Promise<void>((resolve) => {
          const finish = () => { clearTimeout(timer); controller.signal.removeEventListener("abort", finish); resolve(); };
          const timer = setTimeout(finish, Math.min(360, 2400 / ids.length));
          controller.signal.addEventListener("abort", finish, { once: true });
        });
      }
      return !controller.signal.aborted;
    } finally { if (this.controller === controller) this.controller = null; }
  }
}
