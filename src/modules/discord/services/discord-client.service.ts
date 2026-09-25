import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  Optional,
} from '@nestjs/common';
import {
  Client,
  type ClientEvents,
  GatewayIntentBits,
  Partials,
} from 'discord.js';


@Injectable()
export class DiscordClientService implements OnApplicationBootstrap, OnApplicationShutdown {
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
        partials: [Partials.Channel, Partials.Message],
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
      await this.registerSlashCommands();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to login Discord client: ${message}`);
    }
  }

  private async registerSlashCommands(): Promise<void> {
    try {
      const commands = [
        {
          name: 'cancel',
          description: 'Cancela o turno ativo do agente de IA',
        },
      ];

      const guildId = process.env.DISCORD_GUILD_ID;
      if (guildId) {
        const guild =
          this.client.guilds.cache.get(guildId)
          ?? (await this.client.guilds.fetch(guildId).catch(() => null));
        if (guild) {
          await guild.commands.set(commands);
          this.logger.log(`Slash commands registered for guild ${guildId}`);
        }
      }

      if (this.client.application) {
        await this.client.application.commands.set(commands);
        this.logger.log('Global slash commands registered successfully');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to register slash commands: ${message}`);
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
