import { Module } from '@nestjs/common';

import { AgentModule } from '../agent/agent.module.js';
import { OrchestratorModule } from '../orchestrator/orchestrator.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';

import { InMemoryAgentConfigSelectionStoreAdapter } from './adapters/in-memory-agent-config-selection-store.adapter.js';
import { DiscordActivityFormatter } from './formatters/discord-activity.formatter.js';
import { DiscordInteractionHandler } from './handlers/discord-interaction.handler.js';
import { DiscordMessageHandler } from './handlers/discord-message.handler.js';
import { IAgentConfigSelectionStorePort } from './ports/agent-config-selection-store.port.js';
import { AgentProfileListService } from './services/agent-profile-list.service.js';
import { DiscordAttachmentService } from './services/discord-attachment.service.js';
import { DiscordClientService } from './services/discord-client.service.js';
import { DiscordConversationService } from './services/discord-conversation.service.js';
import { LanguageChangeRequestService } from './services/language-change-request.service.js';
import { CancelAgentConfigSelectionUseCase } from './use-cases/cancel-agent-config-selection.use-case.js';
import { ResolveConversationInputUseCase } from './use-cases/resolve-conversation-input.use-case.js';
import { StartAgentConfigSelectionUseCase } from './use-cases/start-agent-config-selection.use-case.js';
import { SubmitAgentConfigSelectionUseCase } from './use-cases/submit-agent-config-selection.use-case.js';


@Module({
  imports: [AgentModule, OrchestratorModule, WorkspaceModule],
  providers: [
    { provide: IAgentConfigSelectionStorePort, useClass: InMemoryAgentConfigSelectionStoreAdapter },
    AgentProfileListService,
    LanguageChangeRequestService,
    StartAgentConfigSelectionUseCase,
    SubmitAgentConfigSelectionUseCase,
    ResolveConversationInputUseCase,
    CancelAgentConfigSelectionUseCase,
    DiscordConversationService,
    DiscordClientService,
    DiscordAttachmentService,
    DiscordMessageHandler,
    DiscordInteractionHandler,
    DiscordActivityFormatter,
  ],
})
export class DiscordModule {}
