export interface TypingChannel {
  sendTyping?: () => Promise<unknown>;
}

export interface DiscordTypingIndicatorOptions {
  intervalMs?: number;
  idleTimeoutMs?: number;
}

const DEFAULT_INTERVAL_MS = 8000;
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

export class DiscordTypingIndicator {
  private readonly intervalMs: number;
  private readonly idleTimeoutMs: number;
  private intervalTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private readonly channel: TypingChannel,
    options?: DiscordTypingIndicatorOptions,
  ) {
    this.intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.idleTimeoutMs = options?.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  }

  start(): void {
    this.stop();
    this.isRunning = true;
    this.triggerTyping();

    this.intervalTimer = setInterval(() => {
      this.triggerTyping();
    }, this.intervalMs);

    this.resetIdleTimer();
  }

  keepAlive(): void {
    if (!this.isRunning) {
      return;
    }
    this.resetIdleTimer();
  }

  stop(): void {
    this.isRunning = false;
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => {
      this.stop();
    }, this.idleTimeoutMs);
  }

  private triggerTyping(): void {
    try {
      void this.channel.sendTyping?.().catch(() => undefined);
    } catch {
      return;
    }
  }
}
