import type { DiscordConnectionTest } from '../models/discord-connection-test.model.js';


/** Checks a bot token, and that the bot is in a server, against Discord without connecting the bot. */
export interface IDiscordConnectionTesterPort {
  test(token: string, guildId?: string): Promise<DiscordConnectionTest>;
}

export const IDiscordConnectionTesterPort = Symbol('IDiscordConnectionTesterPort');
