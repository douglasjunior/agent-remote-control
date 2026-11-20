import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

import type { AgentMcpServer, IAgentPort } from '../../agent/ports/agent.port.js';
import { AGENT_TOOLS_SERVER_NAME } from '../constants/agent-tools.constant.js';
import type { AgentInterface } from '../models/agent-interface.model.js';
import type { AgentToolSession, AgentToolsEndpoint } from '../models/agent-tool.model.js';

import { AgentToolsConfigService } from './agent-tools-config.service.js';


const CREDENTIAL_BYTES = 32;

/**
 * The live tool sessions: one per agent port whose session took the tools, reached by an unguessable credential. The
 * classes that dispose of a port close its tool session with it, and a closed credential is refused from then on. A
 * session with a tool session is on the tools interface, and every other one on the tags interface.
 */
@Injectable()
export class AgentToolSessionsService {
  private readonly logger = new Logger(AgentToolSessionsService.name);
  private endpoint: AgentToolsEndpoint | undefined;
  private readonly credentials = new Map<IAgentPort, string>();
  private readonly sessions = new Map<string, AgentToolSession>();

  constructor(private readonly config: AgentToolsConfigService) {}

  serveAt(endpoint: AgentToolsEndpoint): void {
    this.endpoint = endpoint;
  }

  /**
   * Opens the tool session of the session the port is about to create or load, in place of the one it had, and
   * returns the MCP servers to attach: none for an agent without HTTP MCP servers, with the tools turned off or while
   * nothing serves them.
   */
  open(agentPort: IAgentPort, session: AgentToolSession): AgentMcpServer[] {
    this.close(agentPort);
    if (!agentPort.supportsHttpMcp || !this.config.isEnabled()) {
      return [];
    }
    const credential = randomBytes(CREDENTIAL_BYTES).toString('base64url');
    const connection = this.endpoint?.connection(credential);
    if (!connection) {
      return [];
    }
    this.credentials.set(agentPort, credential);
    this.sessions.set(credential, this.onTools(session));
    this.logger.log(`[Agent Tools Opened] Conversation=${session.requester.conversationId}, Role=${session.requester.role}, Agent=${agentPort.agentName}`);
    return [{ name: AGENT_TOOLS_SERVER_NAME, url: connection.url, headers: connection.headers }];
  }

  /** The port's tool session acts for the turn running now, whose channel hears its skill activity. */
  update(agentPort: IAgentPort, session: AgentToolSession): void {
    const credential = this.credentials.get(agentPort);
    if (credential) {
      this.sessions.set(credential, this.onTools(session));
    }
  }

  /** The interface of the session the port holds: `tools` while it has a tool session open. */
  interfaceOf(agentPort: IAgentPort): AgentInterface {
    return this.credentials.has(agentPort) ? 'tools' : 'tags';
  }

  close(agentPort: IAgentPort): void {
    const credential = this.credentials.get(agentPort);
    if (!credential) {
      return;
    }
    const { requester } = this.sessions.get(credential)!;
    this.credentials.delete(agentPort);
    this.sessions.delete(credential);
    this.logger.log(`[Agent Tools Closed] Conversation=${requester.conversationId}, Role=${requester.role}`);
  }

  find(credential: string): AgentToolSession | undefined {
    return this.sessions.get(credential);
  }

  private onTools(session: AgentToolSession): AgentToolSession {
    return { ...session, requester: { ...session.requester, agentInterface: 'tools' } };
  }
}
