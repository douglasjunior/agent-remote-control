import { Injectable } from '@nestjs/common';
import { type APIGuild, type APIUser, DiscordAPIError, REST, Routes } from 'discord.js';

import type { DiscordConnectionTest } from '../models/discord-connection-test.model.js';
import type { IDiscordConnectionTesterPort } from '../ports/discord-connection-tester.port.js';


const TIMEOUT_MS = 10_000;

/**
 * Asks Discord's HTTP API who the token belongs to (`GET /users/@me`) and, with a server id, for that server
 * (`GET /guilds/{id}`), which answers only when the bot is in it. Each test has its own REST client, with its sweepers
 * off, so no timer outlives it.
 */
@Injectable()
export class RestDiscordConnectionTesterAdapter implements IDiscordConnectionTesterPort {
  async test(token: string, guildId?: string): Promise<DiscordConnectionTest> {
    const rest = new REST({ timeout: TIMEOUT_MS, hashSweepInterval: 0, handlerSweepInterval: 0 }).setToken(token);
    let botName: string;
    try {
      const user = await rest.get(Routes.user()) as APIUser;
      botName = user.global_name ?? user.username;
    } catch (error) {
      return { ok: false, error: this.describe(error, 'Discord refused the token: it is not a bot token, or it was reset.') };
    }
    if (!guildId) {
      return { ok: true, botName };
    }
    try {
      const guild = await rest.get(Routes.guild(guildId)) as APIGuild;
      return { ok: true, botName, guildName: guild.name };
    } catch (error) {
      return { ok: false, error: this.describe(error, `${botName} is not in the server ${guildId}, or the server ID is wrong.`) };
    }
  }

  /** `refused` explains an answer of Discord that denies the request; anything else is reported as it came. */
  private describe(error: unknown, refused: string): string {
    if (error instanceof DiscordAPIError && [401, 403, 404].includes(error.status)) {
      return refused;
    }
    return `Discord could not be reached: ${error instanceof Error ? error.message : String(error)}`;
  }
}
