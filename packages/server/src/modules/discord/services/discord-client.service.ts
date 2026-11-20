import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  Optional,
} from '@nestjs/common';
import {
  type ApplicationCommandDataResolvable,
  ApplicationCommandOptionType,
  Client,
  type ClientEvents,
  GatewayIntentBits,
  Partials,
} from 'discord.js';

import { IAgentAuthPort } from '../../agent/ports/agent-auth.port.js';
import { IAgentTurnPort } from '../../orchestrator/ports/agent-turn.port.js';
import { IRuntimeSettingsPort } from '../../settings/ports/runtime-settings.port.js';
import { ISettingsChangeNotifierPort } from '../../settings/ports/settings-change-notifier.port.js';


/** The settings the connection is made with: a change restarts the client. */
const CONNECTION_SETTINGS: ReadonlySet<string> = new Set(['DISCORD_ENABLED', 'DISCORD_BOT_TOKEN', 'DISCORD_GUILD_ID']);
/** The settings that decide which slash commands exist: a change registers them again. */
const COMMAND_SETTINGS: ReadonlySet<string> = new Set(['SHELL_COMMAND_ENABLED', 'AGENT_AUTH_ENABLED']);

function createDiscordClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel, Partials.Message],
  });
}

/**
 * Owns the discord.js client and its connection, which follows the Discord settings while the server runs. A client
 * that has logged in, or tried to, is never logged in again: discord.js keeps a destroyed gateway from reconnecting
 * and keeps the caches of the previous bot, so a restart builds a new client and attaches the listeners registered
 * with `on` to it.
 */
@Injectable()
export class DiscordClientService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DiscordClientService.name);
  private readonly createClient: () => Client;
  /** Attaches one listener registered with `on` to a client. */
  private readonly listeners: ((client: Client) => void)[] = [];
  private client: Client;
  private loginAttempted = false;
  private connected = false;
  /** Start, stop, restart and command registration run one after the other. */
  private lifecycle: Promise<void> = Promise.resolve();
  private unsubscribe?: () => void;

  constructor(
    @Inject(IAgentTurnPort) private readonly agentTurn: IAgentTurnPort,
    @Inject(IAgentAuthPort) private readonly agentAuth: IAgentAuthPort,
    @Inject(IRuntimeSettingsPort) private readonly settings: IRuntimeSettingsPort,
    @Inject(ISettingsChangeNotifierPort) private readonly settingsChanges: ISettingsChangeNotifierPort,
    @Optional() createClient?: () => Client,
  ) {
    this.createClient = createClient ?? createDiscordClient;
    this.client = this.createClient();
  }

  /** The current client; a restart replaces it, so read it at each use. */
  getClient(): Client {
    return this.client;
  }

  /** Listens on the current client and on every client a restart builds. */
  on<Event extends keyof ClientEvents>(
    event: Event,
    listener: (...args: ClientEvents[Event]) => void,
  ): void {
    const attach = (client: Client) => client.on(event, listener);
    this.listeners.push(attach);
    attach(this.client);
  }

  async onApplicationBootstrap(): Promise<void> {
    this.unsubscribe = this.settingsChanges.onChange((keys) => {
      if (keys.some(key => CONNECTION_SETTINGS.has(key))) {
        return this.restart();
      }
      if (keys.some(key => COMMAND_SETTINGS.has(key))) {
        return this.enqueue(() => (this.connected ? this.registerSlashCommands() : Promise.resolve()));
      }
    });
    await this.start();
  }

  async onApplicationShutdown(): Promise<void> {
    this.unsubscribe?.();
    await this.enqueue(() => this.destroyClient());
  }

  start(): Promise<void> {
    return this.enqueue(() => this.connect());
  }

  stop(): Promise<void> {
    return this.enqueue(() => this.disconnect());
  }

  restart(): Promise<void> {
    return this.enqueue(async () => {
      await this.disconnect();
      await this.connect();
    });
  }

  private enqueue(step: () => Promise<void>): Promise<void> {
    this.lifecycle = this.lifecycle.then(step);
    return this.lifecycle;
  }

  /** Never rejects: a bot that cannot log in is logged, and the server goes on without it. */
  private async connect(): Promise<void> {
    if (!this.settings.get('DISCORD_ENABLED')) {
      this.logger.log('The Discord bot is turned off (DISCORD_ENABLED); the client will not connect.');
      return;
    }
    const token = this.settings.get('DISCORD_BOT_TOKEN');
    if (!token) {
      this.logger.warn('DISCORD_BOT_TOKEN is not set. Discord bot client will not connect.');
      return;
    }
    this.loginAttempted = true;
    try {
      await this.client.login(token);
      this.connected = true;
      this.logger.log('Discord client logged in successfully');
      await this.registerSlashCommands();
    } catch (error) {
      this.logger.error(`Failed to login Discord client: ${this.describe(error)}`);
    }
  }

  private async disconnect(): Promise<void> {
    if (!this.loginAttempted) {
      return;
    }
    this.loginAttempted = false;
    this.connected = false;
    await this.destroyClient();
    this.client = this.createClient();
    this.listeners.forEach(attach => attach(this.client));
  }

  private async destroyClient(): Promise<void> {
    try {
      await this.client.destroy();
      this.logger.log('Discord client destroyed');
    } catch (error) {
      this.logger.error(`Error destroying Discord client: ${this.describe(error)}`);
    }
  }

  private async registerSlashCommands(): Promise<void> {
    try {
      const commands: ApplicationCommandDataResolvable[] = [
        {
          name: 'cancel',
          description: 'Cancels the AI agent\'s active turn',
        },
        {
          name: 'model',
          description: 'Chooses the model and effort used by the agents',
        },
        {
          name: 'usage',
          description: 'Shows the current AI agent\'s usage limits',
        },
        {
          name: 'agent',
          description: 'Switches the AI agent (Antigravity, Claude Code...)',
        },
        {
          name: 'profiles',
          description: 'Configure agent, model and effort for each profile',
        },
        {
          name: 'squad',
          description: 'Applies a squad of agent profiles to this conversation',
        },
        {
          name: 'language',
          description: 'Changes the language agents use to talk to you',
        },
        ...(this.agentAuth.isEnabled()
          ? [
            {
              name: 'agent-auth',
              description: 'Log in to an agent CLI',
              dmPermission: false,
            },
          ]
          : []),
        ...(this.agentTurn.isShellCommandEnabled()
          ? [
            {
              name: 'shell',
              description: 'Runs a shell command directly on the host',
              dmPermission: false,
              options: [
                {
                  name: 'command',
                  description: 'The command to run',
                  type: ApplicationCommandOptionType.String as const,
                  required: true,
                },
              ],
            },
          ]
          : []),
      ];

      const guildId = this.settings.get('DISCORD_GUILD_ID');
      if (guildId) {
        const guild =
          this.client.guilds.cache.get(guildId)
          ?? (await this.client.guilds.fetch(guildId).catch(() => null));
        if (guild) {
          await guild.commands.set(commands);
          await this.client.application?.commands.set([]);
          this.logger.log(`Slash commands registered for guild ${guildId}`);
          return;
        }
        this.logger.warn(`Guild ${guildId} not found. Registering slash commands globally.`);
      }

      if (this.client.application) {
        await this.client.application.commands.set(commands);
        this.logger.log('Global slash commands registered successfully');
      }
    } catch (error) {
      this.logger.warn(`Failed to register slash commands: ${this.describe(error)}`);
    }
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
