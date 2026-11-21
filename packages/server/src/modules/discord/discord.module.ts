import { Module } from '@nestjs/common';

import { AgentModule } from '../agent/agent.module.js';
import { OrchestratorModule } from '../orchestrator/orchestrator.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';

import { InMemoryAgentConfigSelectionStoreAdapter } from './adapters/in-memory-agent-config-selection-store.adapter.js';
import { RestDiscordConnectionTesterAdapter } from './adapters/rest-discord-connection-tester.adapter.js';
import { DiscordActivityFormatter } from './formatters/discord-activity.formatter.js';
import { DiscordInteractionHandler } from './handlers/discord-interaction.handler.js';
import { DiscordMessageHandler } from './handlers/discord-message.handler.js';
import { IAgentConfigSelectionStorePort } from './ports/agent-config-selection-store.port.js';
import { IDiscordConnectionTesterPort } from './ports/discord-connection-tester.port.js';
import { AgentAuthRequestService } from './services/agent-auth-request.service.js';
import { AgentProfileListService } from './services/agent-profile-list.service.js';
import { DiscordAgentAuthNotifierService } from './services/discord-agent-auth-notifier.service.js';
import { DiscordAttachmentService } from './services/discord-attachment.service.js';
import { DiscordClientService } from './services/discord-client.service.js';
import { DiscordConversationService } from './services/discord-conversation.service.js';
import { LanguageChangeRequestService } from './services/language-change-request.service.js';
import { CancelAgentConfigSelectionUseCase } from './use-cases/cancel-agent-config-selection.use-case.js';
import { ResolveConversationInputUseCase } from './use-cases/resolve-conversation-input.use-case.js';
import { StartAgentConfigSelectionUseCase } from './use-cases/start-agent-config-selection.use-case.js';
import { SubmitAgentConfigSelectionUseCase } from './use-cases/submit-agent-config-selection.use-case.js';
import { TestDiscordConnectionUseCase } from './use-cases/test-discord-connection.use-case.js';


@Module({
  imports: [AgentModule, OrchestratorModule, SettingsModule, WorkspaceModule],
  providers: [
    { provide: IAgentConfigSelectionStorePort, useClass: InMemoryAgentConfigSelectionStoreAdapter },
    { provide: IDiscordConnectionTesterPort, useClass: RestDiscordConnectionTesterAdapter },
    TestDiscordConnectionUseCase,
    AgentProfileListService,
    LanguageChangeRequestService,
    AgentAuthRequestService,
    DiscordAgentAuthNotifierService,
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
  exports: [TestDiscordConnectionUseCase],
})
export class DiscordModule {}
