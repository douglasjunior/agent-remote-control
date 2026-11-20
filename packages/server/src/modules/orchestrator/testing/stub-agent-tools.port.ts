import type { AgentToolCallResult, AgentToolCatalog, AgentToolsEndpoint } from '../models/agent-tool.model.js';
import type { IAgentToolsPort } from '../ports/agent-tools.port.js';


export class StubAgentToolsPort implements IAgentToolsPort {
  endpoint?: AgentToolsEndpoint;
  /** The credentials open; any other is refused. */
  openCredentials = new Set<string>(['open-credential']);
  catalog: AgentToolCatalog = {
    instructions: 'First line.\n\nSkills:\n- a: b',
    tools: [{ name: 'artifact_list', description: 'Lists.', inputSchema: { type: 'object', properties: {} } }],
  };

  /** The result of a call to a tool of `catalog`; any other is unknown. */
  callResult: AgentToolCallResult = { status: 'done', text: 'Listed.', isError: false };
  callError?: Error;
  readonly calls: { credential: string; name: string; args: Readonly<Record<string, unknown>> }[] = [];

  serveAt(endpoint: AgentToolsEndpoint): void {
    this.endpoint = endpoint;
  }

  isOpen(credential: string): boolean {
    return this.openCredentials.has(credential);
  }

  async describe(credential: string): Promise<AgentToolCatalog | undefined> {
    return this.isOpen(credential) ? this.catalog : undefined;
  }

  async call(credential: string, name: string, args: Readonly<Record<string, unknown>>): Promise<AgentToolCallResult> {
    this.calls.push({ credential, name, args });
    if (this.callError) {
      throw this.callError;
    }
    if (!this.isOpen(credential)) {
      return { status: 'closed' };
    }
    return this.catalog.tools.some(tool => tool.name === name) ? this.callResult : { status: 'unknown_tool' };
  }
}
