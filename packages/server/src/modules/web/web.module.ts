import { Module } from '@nestjs/common';

import { OrchestratorModule } from '../orchestrator/orchestrator.module.js';
import { PathsModule } from '../paths/paths.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';

import { JsonConversationStoreAdapter } from './adapters/json-conversation-store.adapter.js';
import { JsonPromptHistoryAdapter } from './adapters/json-prompt-history.adapter.js';
import { WsClientTransportAdapter } from './adapters/ws-client-transport.adapter.js';
import { WebConnectionHandler } from './handlers/web-connection.handler.js';
import { IClientTransportPort } from './ports/client-transport.port.js';
import { IConversationStorePort } from './ports/conversation-store.port.js';
import { IPromptHistoryPort } from './ports/prompt-history.port.js';
import { WebAccessTokenService } from './services/web-access-token.service.js';
import { WebAgentQuotaService } from './services/web-agent-quota.service.js';
import { WebConnectionRegistryService } from './services/web-connection-registry.service.js';
import { WebConversationEventsService } from './services/web-conversation-events.service.js';
import { WebConversationTurnsService } from './services/web-conversation-turns.service.js';
import { WebConversationUploadsService } from './services/web-conversation-uploads.service.js';
import { WebFileSearchSessionsService } from './services/web-file-search-sessions.service.js';
import { WebUploadSessionsService } from './services/web-upload-sessions.service.js';
import { AnswerConversationQuestionUseCase } from './use-cases/answer-conversation-question.use-case.js';
import { CancelConversationTurnUseCase } from './use-cases/cancel-conversation-turn.use-case.js';
import { CreateConversationUseCase } from './use-cases/create-conversation.use-case.js';
import { GetConversationHistoryUseCase } from './use-cases/get-conversation-history.use-case.js';
import { GetConversationProfilesUseCase } from './use-cases/get-conversation-profiles.use-case.js';
import { ListAgentOptionsUseCase } from './use-cases/list-agent-options.use-case.js';
import { ListConversationsUseCase } from './use-cases/list-conversations.use-case.js';
import { ListPromptHistoryUseCase } from './use-cases/list-prompt-history.use-case.js';
import { ResumeConversationWorkUseCase } from './use-cases/resume-conversation-work.use-case.js';
import { SendConversationMessageUseCase } from './use-cases/send-conversation-message.use-case.js';
import { SetConversationProfilesUseCase } from './use-cases/set-conversation-profiles.use-case.js';


@Module({
  imports: [OrchestratorModule, PathsModule, WorkspaceModule],
  providers: [
    { provide: IClientTransportPort, useClass: WsClientTransportAdapter },
    { provide: IConversationStorePort, useClass: JsonConversationStoreAdapter },
    { provide: IPromptHistoryPort, useClass: JsonPromptHistoryAdapter },
    WebAccessTokenService,
    WebAgentQuotaService,
    WebConnectionRegistryService,
    WebConversationEventsService,
    WebConversationTurnsService,
    WebConversationUploadsService,
    WebFileSearchSessionsService,
    WebUploadSessionsService,
    CreateConversationUseCase,
    ListConversationsUseCase,
    GetConversationHistoryUseCase,
    SendConversationMessageUseCase,
    ResumeConversationWorkUseCase,
    CancelConversationTurnUseCase,
    ListAgentOptionsUseCase,
    GetConversationProfilesUseCase,
    SetConversationProfilesUseCase,
    AnswerConversationQuestionUseCase,
    ListPromptHistoryUseCase,
    WebConnectionHandler,
  ],
  exports: [WebConnectionRegistryService],
})
export class WebModule {}
