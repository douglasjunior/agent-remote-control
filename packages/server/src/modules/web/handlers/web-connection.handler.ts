import { parseClientCommand } from '@agent-remote-control/protocol/client-command';
import type { ClientCommand } from '@agent-remote-control/protocol/client-command';
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { runInLogConversation } from '../../logging/utils/log-conversation.util.js';
import { type IClientConnection, IClientTransportPort } from '../ports/client-transport.port.js';
import { IConversationStorePort } from '../ports/conversation-store.port.js';
import { WebAccessTokenService } from '../services/web-access-token.service.js';
import { WebAgentQuotaService } from '../services/web-agent-quota.service.js';
import { WebConnectionRegistryService } from '../services/web-connection-registry.service.js';
import { WebConversationEventsService } from '../services/web-conversation-events.service.js';
import { WebFileSearchSessionsService } from '../services/web-file-search-sessions.service.js';
import { WebUploadSessionsService } from '../services/web-upload-sessions.service.js';
import { AnswerConversationQuestionUseCase } from '../use-cases/answer-conversation-question.use-case.js';
import { CancelConversationTurnUseCase } from '../use-cases/cancel-conversation-turn.use-case.js';
import { CreateConversationUseCase } from '../use-cases/create-conversation.use-case.js';
import { GetConversationHistoryUseCase } from '../use-cases/get-conversation-history.use-case.js';
import { GetConversationProfilesUseCase } from '../use-cases/get-conversation-profiles.use-case.js';
import { ListAgentOptionsUseCase } from '../use-cases/list-agent-options.use-case.js';
import { ListConversationsUseCase } from '../use-cases/list-conversations.use-case.js';
import { ListPromptHistoryUseCase } from '../use-cases/list-prompt-history.use-case.js';
import { ResumeConversationWorkUseCase } from '../use-cases/resume-conversation-work.use-case.js';
import { SendConversationMessageUseCase } from '../use-cases/send-conversation-message.use-case.js';
import { SetConversationProfilesUseCase } from '../use-cases/set-conversation-profiles.use-case.js';


export const AUTH_TIMEOUT_MS = 5_000;
export const AUTH_FAILED_CLOSE_CODE = 4401;

const LOGGED_COMMANDS: ReadonlySet<ClientCommand['type']> = new Set(['message.send', 'question.answer', 'turn.cancel', 'work.resume']);

@Injectable()
export class WebConnectionHandler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebConnectionHandler.name);
  private unsubscribe?: () => void;

  constructor(
    @Inject(IClientTransportPort) private readonly transport: IClientTransportPort,
    @Inject(IConversationStorePort) private readonly store: IConversationStorePort,
    private readonly accessToken: WebAccessTokenService,
    private readonly registry: WebConnectionRegistryService,
    private readonly events: WebConversationEventsService,
    private readonly listConversations: ListConversationsUseCase,
    private readonly createConversation: CreateConversationUseCase,
    private readonly getHistory: GetConversationHistoryUseCase,
    private readonly sendMessage: SendConversationMessageUseCase,
    private readonly cancelTurn: CancelConversationTurnUseCase,
    private readonly agentOptions: ListAgentOptionsUseCase,
    private readonly getProfiles: GetConversationProfilesUseCase,
    private readonly setProfiles: SetConversationProfilesUseCase,
    private readonly answerQuestion: AnswerConversationQuestionUseCase,
    private readonly resumeWork: ResumeConversationWorkUseCase,
    private readonly promptHistory: ListPromptHistoryUseCase,
    private readonly fileSearch: WebFileSearchSessionsService,
    private readonly uploads: WebUploadSessionsService,
    private readonly quota: WebAgentQuotaService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.transport.onConnection(connection => this.accept(connection));
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  private accept(connection: IClientConnection): void {
    let authenticated = false;
    let rejected = false;

    const reject = () => {
      rejected = true;
      connection.send({ type: 'auth.failed' });
      connection.close(AUTH_FAILED_CLOSE_CODE, 'unauthorized');
    };

    const timer = setTimeout(reject, AUTH_TIMEOUT_MS);
    connection.onClose(() => {
      clearTimeout(timer);
      this.fileSearch.close(connection.id);
      void this.uploads.releaseConnection(connection.id);
    });

    connection.onMessage((data) => {
      if (rejected) {
        return;
      }
      const parsed = parseClientCommand(data);
      if (!authenticated) {
        clearTimeout(timer);
        if (parsed.ok && parsed.value.type === 'auth' && this.accessToken.verify(parsed.value.token)) {
          authenticated = true;
          connection.send({ type: 'auth.ok' });
          this.registry.register(connection);
        } else {
          reject();
        }
        return;
      }
      if (!parsed.ok) {
        connection.send({ type: 'error', message: 'Invalid command' });
        return;
      }
      const command = parsed.value;
      const conversationId = 'conversationId' in command ? command.conversationId : undefined;
      void runInLogConversation(conversationId, () => this.handle(connection, command)).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`command_failed: ${command.type}: ${message}`);
        connection.send({ type: 'error', message: 'The command failed' });
      });
    });
  }

  /** Commands that change a turn are logged by type only: what the user wrote stays out of the log. */
  private handle(connection: IClientConnection, command: ClientCommand): Promise<void> {
    if (LOGGED_COMMANDS.has(command.type)) {
      this.logger.log(`[Command] ${command.type}`);
    }
    return this.route(connection, command);
  }

  private async route(connection: IClientConnection, command: ClientCommand): Promise<void> {
    switch (command.type) {
      case 'auth':
        return;
      case 'conversation.list':
        connection.send({ type: 'conversation.list', conversations: [...await this.listConversations.execute()] });
        return;
      case 'prompts.history':
        connection.send({ type: 'prompts.list', requestId: command.requestId, prompts: [...await this.promptHistory.execute()] });
        return;
      case 'files.search':
        this.fileSearch.search(connection, command.requestId, command.query);
        return;
      case 'files.close':
        this.fileSearch.close(connection.id, command.requestId);
        return;
      case 'upload.chunk':
        return this.uploads.chunk(connection, command);
      case 'upload.finish':
        return this.uploads.finish(connection, command.uploadId);
      case 'upload.abort':
        return this.uploads.abort(connection.id, command.uploadId);
      case 'agents.list':
        connection.send({ type: 'agents.list', agents: [...this.agentOptions.agents()] });
        return;
      case 'quota.get':
        return this.answerQuota(connection, command.refresh);
      case 'models.list': {
        const models = await this.agentOptions.models(command.agentId);
        connection.send(models
          ? { type: 'models.list', agentId: command.agentId, models: [...models] }
          : { type: 'error', message: 'Unknown agent' });
        return;
      }
      case 'efforts.list': {
        const efforts = await this.agentOptions.efforts(command.agentId, command.modelId);
        connection.send(efforts
          ? { type: 'efforts.list', agentId: command.agentId, modelId: command.modelId, efforts: [...efforts] }
          : { type: 'error', message: 'Unknown agent' });
        return;
      }
      case 'conversation.create': {
        const conversation = await this.createConversation.execute();
        connection.send({ type: 'conversation.created', requestId: command.requestId, conversation });
        this.events.publishConversation(conversation, connection.id);
        return;
      }
    }
    if (!await this.store.exists(command.conversationId)) {
      connection.send({ type: 'error', message: 'Unknown conversation', conversationId: command.conversationId });
      return;
    }
    switch (command.type) {
      case 'conversation.history': {
        const { entries, state, draft, interrupted } = await this.getHistory.execute(command.conversationId);
        connection.send({
          type: 'conversation.history',
          conversationId: command.conversationId,
          entries: [...entries],
          state,
          ...(draft !== '' && { draft }),
          interrupted: [...interrupted],
        });
        return;
      }
      case 'upload.start':
        return this.uploads.start(connection, command);
      case 'message.send':
        void this.sendMessage.execute(command.conversationId, command.text, command.attachments);
        return;
      case 'turn.cancel':
        await this.cancelTurn.execute(command.conversationId);
        return;
      case 'work.resume':
        void this.resumeWork.execute(command.conversationId, command.workId);
        return;
      case 'profiles.get': {
        const { configured, profiles } = await this.getProfiles.execute(command.conversationId);
        connection.send({ type: 'profiles', conversationId: command.conversationId, configured, profiles: [...profiles] });
        return;
      }
      case 'profiles.set': {
        const result = await this.setProfiles.execute(command);
        if (!result.ok) {
          connection.send({ type: 'error', message: result.error, conversationId: command.conversationId });
        }
        return;
      }
      case 'question.answer':
        return this.reportUnless(connection, command.conversationId, 'There is no open question', () =>
          this.answerQuestion.execute(command.conversationId, command.answer));
    }
  }

  /** A background refresh that fails answers `quota.failed`: an `error` event would interrupt the settings sheet, which treats it as its own. */
  private async answerQuota(connection: IClientConnection, refresh: boolean | undefined): Promise<void> {
    try {
      const { reports, fetchedAt } = await this.quota.read(refresh);
      connection.send({ type: 'quota.report', reports, fetchedAt });
    } catch (error) {
      this.logger.warn(`quota_failed: ${error instanceof Error ? error.message : String(error)}`);
      connection.send({ type: 'quota.failed' });
    }
  }

  private async reportUnless(
    connection: IClientConnection,
    conversationId: string,
    message: string,
    attempt: () => Promise<boolean>,
  ): Promise<void> {
    if (!await attempt()) {
      this.logger.warn(`[Command Rejected] ${message}`);
      connection.send({ type: 'error', message, conversationId });
    }
  }
}
