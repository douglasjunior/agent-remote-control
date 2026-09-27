export type AgentUpdate = { readonly kind: 'text'; readonly text: string };

export type AgentToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export type AgentActivity =
  | {
    readonly kind: 'thought';
    readonly id: string;
    readonly text: string;
    readonly removed?: boolean;
    readonly final?: boolean;
  }
  | { readonly kind: 'steering'; readonly id: string; readonly text: string }
  | { readonly kind: 'cancelled'; readonly id: string }
  | {
    readonly kind: 'tool';
    readonly toolCallId: string;
    readonly title: string;
    readonly status: AgentToolStatus;
    readonly result?: string;
    readonly details?: string;
  };

export type AgentUsage = {
  readonly totalTokens: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly thoughtTokens?: number;
  readonly cachedReadTokens?: number;
  readonly cachedWriteTokens?: number;
};

export type AgentModelInfo = {
  readonly modelId: string;
  readonly name: string;
  readonly displayName: string;
  readonly description?: string;
};

export type AgentModelState = {
  readonly availableModels: readonly AgentModelInfo[];
  readonly currentModelId: string;
};

export type AgentEffortInfo = {
  readonly effortId: string;
  readonly name: string;
  readonly description?: string;
};

export type AgentEffortState = {
  readonly availableEfforts: readonly AgentEffortInfo[];
  readonly currentEffortId: string;
};

export type AgentConfig = {
  readonly modelId?: string;
  readonly effortId?: string;
};

export class PromptCancelledError extends Error {
  constructor() {
    super('Prompt cancelled by user');
    this.name = 'PromptCancelledError';
  }
}

export interface IAgentPort {
  readonly agentName: string;
  readonly lastAgentMessage: string;
  readonly currentSessionId?: string;
  readonly supportsSteering: boolean;
  getLastRoundUsage(): Promise<AgentUsage | undefined>;
  connect(): Promise<void>;
  createSession(cwd: string): Promise<void>;
  loadSession(cwd: string, sessionId: string): Promise<boolean>;
  prompt(text: string): AsyncGenerator<AgentUpdate>;
  cancel(): Promise<void>;
  sendSteeringPrompt(text: string): void;
  onActivity(listener: (activity: AgentActivity) => void): () => void;
  closeSession(): Promise<void>;
  disconnect(): Promise<void>;
  getAvailableModels(): AgentModelState | null;
  getAvailableEffortsForModel(
    modelId: string,
  ): Promise<AgentEffortState | null>;
  setConfig(config: AgentConfig): Promise<void>;
}

export const IAgentPort = Symbol('IAgentPort');
