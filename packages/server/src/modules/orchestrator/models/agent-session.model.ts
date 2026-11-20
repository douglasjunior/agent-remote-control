export interface AgentSession {
  readonly role: string;
  readonly agentId: string;
  readonly sessionId: string;
  readonly projectName: string | null;
  /** The task the session works on; `null` for the session a role keeps in a project for work without an artifact. */
  readonly artifactId: string | null;
  /** When the last delegation in this session on its artifact ended: what changed on the artifact since, the session has not seen. */
  readonly workEndedAt?: string;
  /**
   * Set until the session shows the agent at work on a prompt (a thought, a tool call, or the prompt ending): nothing
   * says the instructions of an unanswered session reached the agent.
   */
  readonly unanswered?: true;
}

/**
 * How a prompt reached its session: one already open in the port, one loaded from the store, or a new one. A session
 * still `unanswered` is new however it was reached, since it may hold none of its instructions.
 */
export type AgentSessionState = 'live' | 'resumed' | 'new';

/** The session a prompt reached, with the moment its work on the artifact last ended when it was resumed and records one. */
export type OpenedAgentSession = {
  readonly state: AgentSessionState;
  readonly workEndedAt?: string;
};
