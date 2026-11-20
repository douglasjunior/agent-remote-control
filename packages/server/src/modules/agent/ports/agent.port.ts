export type AgentUpdate = { readonly kind: 'text'; readonly text: string };

export type AgentToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export type AgentActivity =
  | {
    /** A block of what the agent wrote, whole at every change and as it wrote it, protocol tags included. */
    readonly kind: 'thought';
    readonly id: string;
    readonly text: string;
    /** The block is closed: the agent went on to something else. */
    readonly final?: boolean;
    /** The agent's reasoning, which is not part of its answer. */
    readonly reasoning?: boolean;
  }
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

export type AgentQuotaBucket = {
  readonly id: string;
  readonly name: string;
  readonly window: string;
  readonly remainingFraction: number;
  readonly resetTime?: string;
  readonly description?: string;
};

export type AgentQuotaGroup = {
  readonly name: string;
  readonly description?: string;
  readonly buckets: readonly AgentQuotaBucket[];
};

export type AgentQuota = {
  readonly description?: string;
  readonly groups: readonly AgentQuotaGroup[];
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

/** A Streamable HTTP MCP server the agent CLI connects to for the tools of one session. */
export type AgentMcpServer = {
  readonly name: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
};

export type AgentSessionOptions = {
  readonly mcpServers?: readonly AgentMcpServer[];
};

/**
 * What became of a text sent into the running prompt: `injected` reached it, `not_running` found no prompt running
 * (the text was not delivered), `unsupported` comes from an agent without steering, and `failed` from an error.
 */
export type SteeringOutcome = 'injected' | 'not_running' | 'unsupported' | 'failed';

export class PromptCancelledError extends Error {
  constructor() {
    super('Prompt cancelled by user');
    this.name = 'PromptCancelledError';
  }
}

/** `session/new` was refused because the agent CLI has no valid login. */
export class AgentAuthRequiredError extends Error {
  constructor(readonly agentId: string, detail: string) {
    super(
      `The ${agentId} agent is not logged in. Authenticate it from the web interface or with /agent-auth in Discord.\n${detail}`,
    );
    this.name = 'AgentAuthRequiredError';
  }
}

export interface IAgentPort {
  readonly agentName: string;
  readonly lastAgentMessage: string;
  readonly currentSessionId?: string;
  readonly supportsSteering: boolean;
  /** Whether the agent advertised HTTP MCP servers in `initialize`; `false` before `connect()`. */
  readonly supportsHttpMcp: boolean;
  getLastRoundUsage(): Promise<AgentUsage | undefined>;
  /** Resolves `undefined` when the agent does not expose quota or the query fails. */
  getQuota(): Promise<AgentQuota | undefined>;
  connect(): Promise<void>;
  /** An agent without `supportsHttpMcp` gets none of `options.mcpServers`. */
  createSession(cwd: string, options?: AgentSessionOptions): Promise<void>;
  /** The agent process forgets the MCP servers of the session it loads, so the caller sends them again. */
  loadSession(cwd: string, sessionId: string, options?: AgentSessionOptions): Promise<boolean>;
  prompt(text: string): AsyncGenerator<AgentUpdate>;
  cancel(): Promise<void>;
  /** Only `injected` delivers the text; on any other outcome the caller still holds it. */
  sendSteeringPrompt(text: string): Promise<SteeringOutcome>;
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
