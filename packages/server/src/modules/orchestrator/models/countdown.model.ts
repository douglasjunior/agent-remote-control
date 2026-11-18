export type Deadline = {
  /** Epoch milliseconds. */
  readonly expiresAt: number;
  readonly durationMs: number;
};

/** A timer that says when it ends while it runs, for whatever waits on the user for a limited time. */
export class Countdown {
  private timer: NodeJS.Timeout | undefined;
  private running: Deadline | undefined;

  get deadline(): Deadline | undefined {
    return this.running;
  }

  /** Restarts the countdown; `onEnd` runs once the time has passed, after the countdown has stopped. */
  start(durationMs: number, onEnd: () => void): Deadline {
    this.stop();
    const deadline = { expiresAt: Date.now() + durationMs, durationMs };
    this.running = deadline;
    this.timer = setTimeout(() => {
      this.stop();
      onEnd();
    }, durationMs);
    this.timer.unref();
    return deadline;
  }

  stop(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.running = undefined;
  }
}
