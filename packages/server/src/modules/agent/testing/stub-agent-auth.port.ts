import type {
  AgentAuthInfo,
  AgentLoginEvent,
  AgentLoginListener,
  AgentLoginSubscription,
} from '../models/agent-auth.model.js';
import type { IAgentAuthPort } from '../ports/agent-auth.port.js';


export class StubAgentAuthPort implements IAgentAuthPort {
  enabled = true;
  infos: AgentAuthInfo[] = [];
  statusError: Error | null = null;
  startError: Error | null = null;
  readonly started: string[] = [];
  readonly inputs: { agentId: string; text: string }[] = [];
  readonly cancelled: string[] = [];
  inputAccepted = true;
  private readonly listeners = new Map<string, Set<AgentLoginListener>>();
  private readonly settle = new Map<string, () => void>();

  isEnabled(): boolean {
    return this.enabled;
  }

  async listAuthInfo(): Promise<readonly AgentAuthInfo[]> {
    if (this.statusError) {
      throw this.statusError;
    }
    return this.enabled ? this.infos : [];
  }

  async getStatus(agentId: string): Promise<AgentAuthInfo | undefined> {
    return this.infos.find(info => info.agentId === agentId);
  }

  startLogin(agentId: string, listener: AgentLoginListener): AgentLoginSubscription {
    if (this.startError) {
      throw this.startError;
    }
    this.started.push(agentId);
    const set = this.listeners.get(agentId) ?? new Set<AgentLoginListener>();
    set.add(listener);
    this.listeners.set(agentId, set);
    const done = new Promise<void>(resolve => this.settle.set(agentId, resolve));
    return { unsubscribe: () => set.delete(listener), done };
  }

  submitInput(agentId: string, text: string): boolean {
    this.inputs.push({ agentId, text });
    return this.inputAccepted;
  }

  cancelLogin(agentId: string): void {
    this.cancelled.push(agentId);
  }

  /** Delivers an event to the listeners of the agent; terminal events also settle `done`. */
  emit(agentId: string, event: AgentLoginEvent): void {
    for (const listener of this.listeners.get(agentId) ?? []) {
      listener(event);
    }
    if (event.kind === 'completed' || event.kind === 'failed' || event.kind === 'cancelled') {
      this.settle.get(agentId)?.();
    }
  }
}
