import type { AgentMcpServer } from '../../agent/ports/agent.port.js';
import { AgentToolSessionsService } from '../services/agent-tool-sessions.service.js';
import { AgentToolsConfigService } from '../services/agent-tools-config.service.js';


export const TOOLS_URL = 'http://127.0.0.1:3000/mcp';

/** The real tool session registry, served at an endpoint whose `authorization` header carries the credential. */
export function createServedToolSessions(): AgentToolSessionsService {
  const toolSessions = new AgentToolSessionsService(new AgentToolsConfigService());
  toolSessions.serveAt({ connection: credential => ({ url: TOOLS_URL, headers: { authorization: `Bearer ${credential}` } }) });
  return toolSessions;
}

/** The credential the servers of `createServedToolSessions` carry, or an empty string without one. */
export function credentialOf(servers: readonly AgentMcpServer[] | undefined): string {
  return servers?.[0]?.headers.authorization?.replace('Bearer ', '') ?? '';
}
