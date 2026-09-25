import type {
  AgentActivity,
  AgentConfig,
  AgentEffortState,
  AgentModelState,
  AgentUpdate,
  AgentUsage,
  IAgentPort,
} from '../../agent/ports/agent.port.js';


export class StubAgentPort implements IAgentPort {
  lastAgentMessage = '';
  currentSessionId?: string = undefined;
  connected = false;
  connectCalls = 0;
  createSessionCalls: string[] = [];
  promptCalls: string[] = [];
  cancelCalls = 0;
  closeSessionCalls = 0;
  steeringPrompts: string[] = [];
  configCalls: AgentConfig[] = [];
  usageToReturn: AgentUsage | undefined = undefined;
  updatesToYield: AgentUpdate[] = [];
  errorToThrowOnPrompt: Error | null = null;
  errorToThrowOnConnect: Error | null = null;
  errorToThrowOnCreateSession: Error | null = null;
  activityListeners: ((activity: AgentActivity) => void)[] = [];

  mockResponses: string[] = [];
  promptErrorToThrow: Error | null = null;

  async connect(): Promise<void> {
    this.connectCalls++;
    if (this.errorToThrowOnConnect) {
      throw this.errorToThrowOnConnect;
    }
    this.connected = true;
  }

  async createSession(cwd: string): Promise<void> {
    this.createSessionCalls.push(cwd);
    if (this.errorToThrowOnCreateSession) {
      throw this.errorToThrowOnCreateSession;
    }
    this.currentSessionId = `session-${this.createSessionCalls.length}`;
  }

  async* prompt(text: string): AsyncGenerator<AgentUpdate> {
    this.promptCalls.push(text);
    if (this.promptErrorToThrow) {
      throw this.promptErrorToThrow;
    }
    if (this.errorToThrowOnPrompt) {
      throw this.errorToThrowOnPrompt;
    }
    const response = this.mockResponses.shift();
    if (response) {
      this.lastAgentMessage = response;
      yield { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: response } } } as any;
    } else {
      for (const update of this.updatesToYield) {
        yield update;
      }
    }
  }

  async cancel(): Promise<void> {
    this.cancelCalls++;
  }

  sendSteeringPrompt(text: string): void {
    this.steeringPrompts.push(text);
  }

  onActivity(listener: (activity: AgentActivity) => void): () => void {
    this.activityListeners.push(listener);
    return () => {
      const index = this.activityListeners.indexOf(listener);
      if (index >= 0) {
        this.activityListeners.splice(index, 1);
      }
    };
  }

  emitActivity(activity: AgentActivity): void {
    for (const listener of this.activityListeners) {
      listener(activity);
    }
  }

  async closeSession(): Promise<void> {
    this.closeSessionCalls++;
    this.currentSessionId = undefined;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.currentSessionId = undefined;
  }

  getAvailableModels(): AgentModelState | null {
    return null;
  }

  async getAvailableEffortsForModel(
    _modelId?: string,
  ): Promise<AgentEffortState | null> {
    return null;
  }

  async setConfig(config: AgentConfig): Promise<void> {
    this.configCalls.push(config);
  }

  async getLastRoundUsage(): Promise<AgentUsage | undefined> {
    return this.usageToReturn;
  }
}
