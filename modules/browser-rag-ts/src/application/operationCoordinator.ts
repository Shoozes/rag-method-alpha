export type ForegroundOperation = "query" | "import" | "restore" | "reports" | "diagnostic" | "dispose";

export interface OperationCoordinatorState {
  readonly foreground: ForegroundOperation | null;
  readonly graph_active: boolean;
  readonly graph_pending: boolean;
}

export type GraphScheduleResult = "completed" | "superseded";

type PendingGraph = {
  readonly run: () => Promise<void>;
  readonly resolve: (result: GraphScheduleResult) => void;
  readonly reject: (reason: unknown) => void;
};

export interface ApplicationOperationCoordinatorOptions {
  readonly cancelGraph: () => Promise<void>;
  readonly onStateChange?: (state: OperationCoordinatorState) => void;
}

export class ApplicationOperationCoordinator {
  private readonly cancelGraph: () => Promise<void>;
  private readonly onStateChange: ((state: OperationCoordinatorState) => void) | undefined;
  private foreground: ForegroundOperation | null = null;
  private graphActive = false;
  private pendingGraph: PendingGraph | null = null;
  private disposed = false;

  constructor(options: ApplicationOperationCoordinatorOptions) {
    this.cancelGraph = options.cancelGraph;
    this.onStateChange = options.onStateChange;
  }

  get state(): OperationCoordinatorState {
    return Object.freeze({
      foreground: this.foreground,
      graph_active: this.graphActive,
      graph_pending: this.pendingGraph !== null,
    });
  }

  async runForeground<T>(owner: ForegroundOperation, action: () => Promise<T>): Promise<T> {
    if (this.disposed) throw new Error("application operation coordinator is disposed");
    if (this.foreground !== null) throw new Error(`${this.foreground} is already in progress`);
    this.foreground = owner;
    this.emit();
    try {
      await this.cancelGraph();
      return await action();
    } finally {
      if (this.foreground === owner) {
        this.foreground = null;
        this.emit();
        void this.drainGraph();
      }
    }
  }

  requestGraph(run: () => Promise<void>): Promise<GraphScheduleResult> {
    if (this.disposed) return Promise.reject(new Error("application operation coordinator is disposed"));
    this.pendingGraph?.resolve("superseded");
    const promise = new Promise<GraphScheduleResult>((resolve, reject) => {
      this.pendingGraph = { run, resolve, reject };
    });
    this.emit();
    if (this.graphActive) void this.cancelGraph().catch(() => undefined);
    if (this.foreground === null) void this.drainGraph();
    return promise;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.pendingGraph?.resolve("superseded");
    this.pendingGraph = null;
    this.emit();
    await this.cancelGraph();
  }

  private async drainGraph(): Promise<void> {
    if (this.disposed || this.foreground !== null || this.graphActive || !this.pendingGraph) return;
    const pending = this.pendingGraph;
    this.pendingGraph = null;
    this.graphActive = true;
    this.emit();
    try {
      await pending.run();
      pending.resolve("completed");
    } catch (error) {
      pending.reject(error);
    } finally {
      this.graphActive = false;
      this.emit();
      if (!this.disposed && this.foreground === null && this.pendingGraph) void this.drainGraph();
    }
  }

  private emit(): void {
    this.onStateChange?.(this.state);
  }
}
