export interface AgentSession {
  readonly role: string;
  readonly agentId: string;
  readonly sessionId: string;
  readonly projectName: string | null;
  /** The task the session works on; `null` for the session a role keeps in a project for work without an artifact. */
  readonly artifactId: string | null;
}

/** How a prompt reached its session: one already open in the port, one loaded from the store, or a new one. */
export type AgentSessionState = 'live' | 'resumed' | 'new';
