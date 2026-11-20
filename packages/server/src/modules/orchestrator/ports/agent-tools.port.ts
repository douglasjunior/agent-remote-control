import type { AgentToolCallResult, AgentToolCatalog, AgentToolsEndpoint } from '../models/agent-tool.model.js';


/**
 * The board and skill requests as tools an agent calls in the middle of its turn, for the inbound adapter that serves
 * them over MCP. Each agent session that takes an HTTP MCP server gets a credential of its own, open while the agent
 * that holds it works; every method refuses any other.
 */
export interface IAgentToolsPort {
  /** Until the adapter says where it is reached, no agent gets the tools. */
  serveAt(endpoint: AgentToolsEndpoint): void;
  isOpen(credential: string): boolean;
  /** `undefined` for a credential that is not open. */
  describe(credential: string): Promise<AgentToolCatalog | undefined>;
  /** Unknown arguments are ignored. */
  call(credential: string, name: string, args: Readonly<Record<string, unknown>>): Promise<AgentToolCallResult>;
}

export const IAgentToolsPort = Symbol('IAgentToolsPort');
