import { Injectable } from '@nestjs/common';

import type { AgentToolCallResult, AgentToolCatalog, AgentToolsEndpoint } from '../models/agent-tool.model.js';
import type { IAgentToolsPort } from '../ports/agent-tools.port.js';
import { RunAgentToolUseCase } from '../use-cases/run-agent-tool.use-case.js';

import { AgentToolCatalogService } from './agent-tool-catalog.service.js';
import { AgentToolSessionsService } from './agent-tool-sessions.service.js';


@Injectable()
export class AgentToolsService implements IAgentToolsPort {
  constructor(
    private readonly toolSessions: AgentToolSessionsService,
    private readonly toolCatalog: AgentToolCatalogService,
    private readonly runAgentTool: RunAgentToolUseCase,
  ) {}

  serveAt(endpoint: AgentToolsEndpoint): void {
    this.toolSessions.serveAt(endpoint);
  }

  isOpen(credential: string): boolean {
    return this.toolSessions.find(credential) !== undefined;
  }

  async describe(credential: string): Promise<AgentToolCatalog | undefined> {
    const session = this.toolSessions.find(credential);
    return session && this.toolCatalog.catalog(session.requester.role);
  }

  call(credential: string, name: string, args: Readonly<Record<string, unknown>>): Promise<AgentToolCallResult> {
    return this.runAgentTool.execute(credential, name, args);
  }
}
