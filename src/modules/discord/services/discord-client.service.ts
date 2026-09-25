import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  Optional,
} from '@nestjs/common';
import { Client, type ClientEvents, GatewayIntentBits } from 'discord.js';


@Injectable()
export class DiscordClientService
implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DiscordClientService.name);
  private readonly client: Client;

  constructor(@Optional() client?: Client) {
    this.client =
      client
      ?? new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.DirectMessages,
        ],
      });
  }

  getClient(): Client {
    return this.client;
  }

  on<Event extends keyof ClientEvents>(
    event: Event,
    listener: (...args: ClientEvents[Event]) => void,
  ): void {
    this.client.on(event, listener);
  }

  async onApplicationBootstrap(): Promise<void> {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) {
      this.logger.warn(
        'DISCORD_BOT_TOKEN is not set. Discord bot client will not connect.',
      );
      return;
    }

    try {
      await this.client.login(token);
      this.logger.log('Discord client logged in successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to login Discord client: ${message}`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.client.destroy();
      this.logger.log('Discord client destroyed');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error destroying Discord client: ${message}`);
    }
  }
}
