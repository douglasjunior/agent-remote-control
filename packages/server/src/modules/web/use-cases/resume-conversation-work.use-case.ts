import { Inject, Injectable, Logger } from '@nestjs/common';

import type { TurnRequest } from '../../orchestrator/models/turn-request.model.js';
import type { TurnResult } from '../../orchestrator/models/turn-result.model.js';
import type { RestoredWorkAnswers } from '../../orchestrator/models/user-question.model.js';
import { IAgentTurnPort } from '../../orchestrator/ports/agent-turn.port.js';
import { IWorkspacePort } from '../../workspace/ports/workspace.port.js';
import { WebConversationEventsService } from '../services/web-conversation-events.service.js';
import { WebConversationTurnsService } from '../services/web-conversation-turns.service.js';
import { noticeEntry } from '../utils/conversation-entry.util.js';


const WEB_USER_ID = 'web-local';

@Injectable()
export class ResumeConversationWorkUseCase {
  private readonly logger = new Logger(ResumeConversationWorkUseCase.name);

  constructor(
    @Inject(IAgentTurnPort) private readonly agentTurn: IAgentTurnPort,
    @Inject(IWorkspacePort) private readonly workspace: IWorkspacePort,
    private readonly events: WebConversationEventsService,
    private readonly turns: WebConversationTurnsService,
  ) {}

  /** A repeated request finds the work taken and does nothing. */
  async execute(conversationId: string, workId: string): Promise<void> {
    if (this.agentTurn.listInterruptedWork(conversationId).some(work => work.id === workId)) {
      await this.run(conversationId, request => this.agentTurn.resumeWork(workId, request));
    }
  }

  deliverAnswers(conversationId: string, answers: RestoredWorkAnswers): Promise<void> {
    return this.run(conversationId, request => this.agentTurn.deliverAnswers(answers, request));
  }

  /** Never rejects: failures are reported as `notice` entries. */
  private async run(conversationId: string, execute: (request: TurnRequest) => Promise<TurnResult>): Promise<void> {
    const turnId = this.turns.begin(conversationId);
    try {
      const running = this.turns.run(conversationId, turnId, callbacks => execute({
        conversationId,
        userId: WEB_USER_ID,
        prompt: '',
        workspacePath: this.workspace.getBaseDirectory(),
        agentRole: 'CEO',
        ...callbacks,
      }));
      this.turns.publishInterrupted(conversationId);
      await running;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error resuming work for ${conversationId}: ${message}`);
      await this.events.publishEntry(conversationId, noticeEntry('error', `An error occurred while resuming the work: ${message}`));
      this.turns.end(conversationId, turnId);
    }
  }
}
