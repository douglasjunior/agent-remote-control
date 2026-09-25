import { Module } from '@nestjs/common';
import { OrchestratorModule } from '../orchestrator/orchestrator.module.js';
import { DiscordActivityFormatter } from './formatters/discord-activity.formatter.js';
import { DiscordInteractionHandler } from './handlers/discord-interaction.handler.js';
import { DiscordMessageHandler } from './handlers/discord-message.handler.js';
import { DiscordClientService } from './services/discord-client.service.js';

@Module({
  imports: [OrchestratorModule],
  providers: [
    DiscordClientService,
    DiscordActivityFormatter,
    DiscordMessageHandler,
    DiscordInteractionHandler,
  ],
  exports: [DiscordClientService, DiscordMessageHandler],
})
export class DiscordModule {}
