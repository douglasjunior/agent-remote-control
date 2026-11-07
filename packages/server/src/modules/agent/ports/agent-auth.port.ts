import type {
  AgentAuthInfo,
  AgentAuthStatus,
  AgentLoginListener,
  AgentLoginSubscription,
} from '../models/agent-auth.model.js';


export interface IAgentAuthPort {
  isEnabled(): boolean;
  /** Login state of every available agent that has a CLI login. Probes run in parallel and never throw. */
  listAuthInfo(): Promise<readonly AgentAuthInfo[]>;
  getStatus(agentId: string): Promise<AgentAuthInfo | undefined>;
  /**
   * Starts the CLI login of the agent, or joins the one already running. A joining listener receives the
   * last link and prompt first. Throws when the feature is disabled or the agent has no CLI login.
   */
  startLogin(agentId: string, listener: AgentLoginListener): AgentLoginSubscription;
  /** Writes a line to the running login's stdin. Returns `false` when no login of that agent is running. */
  submitInput(agentId: string, text: string): boolean;
  cancelLogin(agentId: string): void;
}

export const IAgentAuthPort = Symbol('IAgentAuthPort');

export type { AgentAuthStatus };
