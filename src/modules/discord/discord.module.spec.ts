import { Test, type TestingModule } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { DiscordModule } from './discord.module.js';
import { DiscordActivityFormatter } from './formatters/discord-activity.formatter.js';
import { DiscordInteractionHandler } from './handlers/discord-interaction.handler.js';
import { DiscordMessageHandler } from './handlers/discord-message.handler.js';
import { DiscordClientService } from './services/discord-client.service.js';

describe('DiscordModule', () => {
  it('should compile the module and resolve all discord providers', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [DiscordModule],
    }).compile();

    const clientService =
      module.get<DiscordClientService>(DiscordClientService);
    const activityFormatter = module.get<DiscordActivityFormatter>(
      DiscordActivityFormatter,
    );
    const messageHandler = module.get<DiscordMessageHandler>(
      DiscordMessageHandler,
    );
    const interactionHandler = module.get<DiscordInteractionHandler>(
      DiscordInteractionHandler,
    );

    expect(clientService).toBeInstanceOf(DiscordClientService);
    expect(activityFormatter).toBeInstanceOf(DiscordActivityFormatter);
    expect(messageHandler).toBeInstanceOf(DiscordMessageHandler);
    expect(interactionHandler).toBeInstanceOf(DiscordInteractionHandler);
  });
});
