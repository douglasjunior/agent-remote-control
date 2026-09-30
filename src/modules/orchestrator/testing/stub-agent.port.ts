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
  agentName = 'stub';
  lastAgentMessage = '';
  currentSessionId?: string = undefined;
  supportsSteering = false;
  connected = false;
  connectCalls = 0;
  createSessionCalls: string[] = [];
  loadSessionCalls: { cwd: string; sessionId: string }[] = [];
  loadSessionResult = true;
  modelsToReturn: AgentModelState | null = null;
  effortsByModel: Record<string, AgentEffortState | null> = {};
  promptCalls: string[] = [];
  cancelCalls = 0;
  closeSessionCalls = 0;
  steeringPrompts: string[] = [];
  steeringResult = true;
  configCalls: AgentConfig[] = [];
  usageToReturn: AgentUsage | undefined = undefined;
  usageErrorToThrow: Error | null = null;
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

  async loadSession(cwd: string, sessionId: string): Promise<boolean> {
    this.loadSessionCalls.push({ cwd, sessionId });
    if (this.loadSessionResult) {
      this.currentSessionId = sessionId;
    }
    return this.loadSessionResult;
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
      yield { kind: 'text', text: response };
    } else {
      for (const update of this.updatesToYield) {
        yield update;
      }
    }
  }

  async cancel(): Promise<void> {
    this.cancelCalls++;
  }

  async sendSteeringPrompt(text: string): Promise<boolean> {
    this.steeringPrompts.push(text);
    return this.steeringResult;
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
    return this.modelsToReturn;
  }

  async getAvailableEffortsForModel(
    modelId: string,
  ): Promise<AgentEffortState | null> {
    return this.effortsByModel[modelId] ?? null;
  }

  async setConfig(config: AgentConfig): Promise<void> {
    this.configCalls.push(config);
  }

  async getLastRoundUsage(): Promise<AgentUsage | undefined> {
    if (this.usageErrorToThrow) {
      throw this.usageErrorToThrow;
    }
    return this.usageToReturn;
  }
}
