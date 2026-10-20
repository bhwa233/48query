import { setTimeout } from "node:timers/promises";

export class CollectionStopped extends Error {
  constructor() { super("Collection budget reached; committed progress is resumable."); this.name = "CollectionStopped"; }
}

// Reuse native AbortSignal/timeouts; the existing page limits cannot bound an
// album page's nested original-message requests or a media retry batch.
export class CollectionBudget {
  private readonly controller = new AbortController();
  constructor(readonly deadline = Infinity, private readonly parent?: CollectionBudget) {}
  get stopped(): boolean { return this.controller.signal.aborted || Boolean(this.parent?.stopped) || Date.now() >= this.deadline; }
  stop() { this.controller.abort(); }
  check() { if (this.stopped) throw new CollectionStopped(); }
  slice(seconds: number) { return new CollectionBudget(Math.min(this.deadline, Date.now() + seconds * 1000), this); }
  signal(timeoutMs: number): AbortSignal {
    this.check();
    return AbortSignal.any([this.controller.signal, ...(this.parent ? [this.parent.signal(timeoutMs)] : []), AbortSignal.timeout(Math.max(1, Math.ceil(Math.min(timeoutMs, this.deadline - Date.now()))))]);
  }
  async wait(milliseconds: number) {
    this.check();
    try { await setTimeout(milliseconds, undefined, { signal: this.signal(milliseconds + 1000) }); }
    catch (error) { this.check(); throw error; }
    this.check();
  }
}
