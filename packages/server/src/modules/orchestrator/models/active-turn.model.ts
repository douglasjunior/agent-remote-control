import { type IAgentPort, PromptCancelledError } from '../../agent/ports/agent.port.js';


export class ActiveTurn {
  private cancelled = false;

  constructor(private activePort: IAgentPort) {}

  get isCancelled(): boolean {
    return this.cancelled;
  }

  activate(agentPort: IAgentPort): void {
    this.activePort = agentPort;
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
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
}
