import { type IAgentPort, PromptCancelledError } from '../../agent/ports/agent.port.js';


export class ActiveTurn {
  private cancelled = false;
  private readonly wakeups = new Set<() => void>();

  constructor(private activePort: IAgentPort) {}

  get isCancelled(): boolean {
    return this.cancelled;
  }

  activate(agentPort: IAgentPort): void {
    this.activePort = agentPort;
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    for (const wake of [...this.wakeups]) {
      wake();
    }
    await this.activePort.cancel();
  }

  reset(): void {
    this.cancelled = false;
  }

  throwIfCancelled(): void {
    if (this.cancelled) {
      throw new PromptCancelledError();
    }
  }

  /** Waits `ms`; a cancellation ends the wait early and throws `PromptCancelledError`. */
  async sleep(ms: number): Promise<void> {
    this.throwIfCancelled();
    await new Promise<void>((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        this.wakeups.delete(wake);
        resolve();
      };
      const timer = setTimeout(wake, ms);
      this.wakeups.add(wake);
    });
    this.throwIfCancelled();
  }
}
