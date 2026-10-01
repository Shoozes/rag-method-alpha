export class WorkerCancelledError extends Error {
  constructor() {
    super("worker operation cancelled");
    this.name = "WorkerCancelledError";
  }
}
