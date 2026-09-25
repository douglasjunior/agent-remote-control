import { Module } from '@nestjs/common';

import { AgentModule } from '../agent/agent.module.js';
import { OrchestratorModule } from '../orchestrator/orchestrator.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';

import { DiscordActivityFormatter } from './formatters/discord-activity.formatter.js';
import { DiscordInteractionHandler } from './handlers/discord-interaction.handler.js';
import { DiscordMessageHandler } from './handlers/discord-message.handler.js';
import { DiscordClientService } from './services/discord-client.service.js';


@Module({
  imports: [AgentModule, OrchestratorModule, WorkspaceModule],
  providers: [
    DiscordClientService,
    DiscordMessageHandler,
    DiscordInteractionHandler,
    DiscordActivityFormatter,
  ],
})
export class DiscordModule {}
