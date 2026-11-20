import { Injectable, Logger } from '@nestjs/common';

import { ConversationLogContextService } from '../../logging/services/conversation-log-context.service.js';
import { AGENT_TOOL_NAMES, type AgentToolName } from '../constants/agent-tools.constant.js';
import type { AgentToolCallResult } from '../models/agent-tool.model.js';
import { AgentToolRequestService } from '../services/agent-tool-request.service.js';
import { AgentToolSessionsService } from '../services/agent-tool-sessions.service.js';

import { RunAgentRequestsUseCase } from './run-agent-requests.use-case.js';


/**
 * Carries out a tool call as the request of the same name, for the agent of the tool session and under its access,
 * and returns the request's result as the text of the call. A tool the role was not given still runs, and the access
 * checks refuse it with the message its tag gets.
 */
@Injectable()
export class RunAgentToolUseCase {
  private readonly logger = new Logger(RunAgentToolUseCase.name);

  constructor(
    private readonly toolSessions: AgentToolSessionsService,
    private readonly toolRequests: AgentToolRequestService,
    private readonly runAgentRequests: RunAgentRequestsUseCase,
    private readonly logContext: ConversationLogContextService,
  ) {}

  async execute(credential: string, name: string, args: Readonly<Record<string, unknown>>): Promise<AgentToolCallResult> {
    const session = this.toolSessions.find(credential);
    if (!session) {
      return { status: 'closed' };
    }
    if (!this.isToolName(name)) {
      return { status: 'unknown_tool' };
    }
    const { requester, onSkill } = session;
    return this.logContext.run(requester.conversationId, async () => {
      const request = this.toolRequests.toRequest(name, args);
      const { body, failed } = await this.runAgentRequests.executeOne(request, requester, onSkill);
      this.logger.log(`[Agent Tool Call] Conversation=${requester.conversationId}, Role=${requester.role}, Tool=${name}, Failed=${failed}`);
      return { status: 'done', text: body, isError: failed };
    });
  }

  private isToolName(name: string): name is AgentToolName {
    return (AGENT_TOOL_NAMES as readonly string[]).includes(name);
  }
}
