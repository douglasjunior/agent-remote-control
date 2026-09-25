export interface DiscordThrottlerOptions {
  intervalMs?: number;
}

export class DiscordThrottler {
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private pendingAction: (() => Promise<void>) | null = null;
  private isExecuting = false;
  private executionPromise: Promise<void> | null = null;
  private lastExecutedAt = 0;

  constructor(options?: DiscordThrottlerOptions) {
    this.intervalMs = options?.intervalMs ?? 1000;
  }

  schedule(action: () => Promise<void>): void {
    this.pendingAction = action;

    if (this.isExecuting) {
      return;
    }

    const now = Date.now();
    const elapsed = now - this.lastExecutedAt;

    if (elapsed >= this.intervalMs && !this.timer) {
      void this.executePending();
    } else if (!this.timer) {
      const delay = this.intervalMs - elapsed;
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.executePending();
      }, delay);
    }
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.executionPromise) {
      await this.executionPromise;
    }

    await this.executePending();
  }

  destroy(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pendingAction = null;
  }

  private async executePending(): Promise<void> {
    if (!this.pendingAction || this.isExecuting) {
      return;
    }

    const action = this.pendingAction;
    this.pendingAction = null;
    this.isExecuting = true;

    this.executionPromise = (async () => {
      try {
        await action();
      } catch {
        // Ignored to allow subsequent updates to proceed without halting the throttler
      } finally {
        this.lastExecutedAt = Date.now();
        this.isExecuting = false;
        this.executionPromise = null;

        if (this.pendingAction && !this.timer) {
          this.timer = setTimeout(() => {
            this.timer = null;
            void this.executePending();
          }, this.intervalMs);
        }
      }
    })();

    await this.executionPromise;
  }
}
