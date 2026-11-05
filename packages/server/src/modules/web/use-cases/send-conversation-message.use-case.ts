import type { Attachment } from '@agent-remote-control/protocol/attachment';
import { Inject, Injectable, Logger } from '@nestjs/common';

import type { TurnAttachment } from '../../orchestrator/models/turn-attachment.model.js';
import { IAgentConfigurationPort } from '../../orchestrator/ports/agent-configuration.port.js';
import { IAgentTurnPort } from '../../orchestrator/ports/agent-turn.port.js';
import { IWorkspacePort } from '../../workspace/ports/workspace.port.js';
import { IConversationStorePort } from '../ports/conversation-store.port.js';
import { IPromptHistoryPort } from '../ports/prompt-history.port.js';
import { WebConversationEventsService } from '../services/web-conversation-events.service.js';
import { WebConversationTurnsService } from '../services/web-conversation-turns.service.js';
import { WebConversationUploadsService } from '../services/web-conversation-uploads.service.js';
import { noticeEntry, userMessageEntry } from '../utils/conversation-entry.util.js';


const TITLE_MAX_LENGTH = 60;
const NOT_CONFIGURED_NOTICE = 'Choose an agent, model and effort for this conversation before sending messages.';
const INVALID_ATTACHMENT_NOTICE = 'An attached file is missing. Attach it again and resend the message.';
const WEB_USER_ID = 'web-local';

@Injectable()
export class SendConversationMessageUseCase {
  private readonly logger = new Logger(SendConversationMessageUseCase.name);

  constructor(
    @Inject(IAgentTurnPort) private readonly agentTurn: IAgentTurnPort,
    @Inject(IAgentConfigurationPort) private readonly configuration: IAgentConfigurationPort,
    private readonly events: WebConversationEventsService,
    @Inject(IConversationStorePort) private readonly store: IConversationStorePort,
    @Inject(IWorkspacePort) private readonly workspace: IWorkspacePort,
    @Inject(IPromptHistoryPort) private readonly promptHistory: IPromptHistoryPort,
    private readonly uploads: WebConversationUploadsService,
    private readonly turns: WebConversationTurnsService,
  ) {}

  /**
   * Never rejects: failures are reported as `notice` entries. Attachments must be files this
   * conversation uploaded; the agent receives them as `@path` mentions after the text.
   */
  async execute(conversationId: string, text: string, attachments: readonly Attachment[] = []): Promise<void> {
    let turnId: string | undefined;
    try {
      if (!await this.isConfigured(conversationId)) {
        await this.events.publishEntry(conversationId, noticeEntry('warning', NOT_CONFIGURED_NOTICE));
        return;
      }
      const files = await this.uploads.resolve(conversationId, attachments);
      if (!files) {
        await this.events.publishEntry(conversationId, noticeEntry('error', INVALID_ATTACHMENT_NOTICE));
        return;
      }
      await this.recordUserMessage(conversationId, text, attachments);
      turnId = this.turns.begin(conversationId);
      await this.runTurn(conversationId, turnId, text, files);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error processing web message for ${conversationId}: ${message}`);
      await this.events.publishEntry(conversationId, noticeEntry('error', `An error occurred while processing your request: ${message}`));
      if (turnId !== undefined) {
        this.turns.end(conversationId, turnId);
      }
    }
  }

  /** Without any installed agent the turn runs with the default one, so only a choosable agent is required. */
  private async isConfigured(conversationId: string): Promise<boolean> {
    return await this.configuration.ensureSettings(conversationId) !== 'missing' || this.configuration.listAgents().length === 0;
  }

  private async recordUserMessage(conversationId: string, text: string, attachments: readonly Attachment[]): Promise<void> {
    const isFirstMessage = !(await this.store.history(conversationId)).some(entry => entry.type === 'user_message');
    await this.events.publishEntry(conversationId, userMessageEntry(text, attachments));
    if (text !== '') {
      await this.promptHistory.append(text);
    }
    const conversation = isFirstMessage
      ? await this.store.rename(conversationId, this.titleFrom(text || attachments[0].name))
      : await this.store.touch(conversationId);
    this.events.publishConversation(conversation);
  }

  private titleFrom(text: string): string {
    const firstLine = text.split('\n').find(line => line.trim())?.trim() ?? text.trim();
    return firstLine.slice(0, TITLE_MAX_LENGTH);
  }

  private runTurn(conversationId: string, turnId: string, prompt: string, attachments: readonly TurnAttachment[]): Promise<void> {
    return this.turns.run(conversationId, turnId, callbacks => this.agentTurn.executeTurn({
      conversationId,
      userId: WEB_USER_ID,
      prompt,
      workspacePath: this.workspace.getBaseDirectory(),
      agentRole: 'CEO',
      attachments,
      resumable: true,
      ...callbacks,
    }));
  }
}
