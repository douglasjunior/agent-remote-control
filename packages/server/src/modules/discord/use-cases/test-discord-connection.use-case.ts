import { SETTING_SCHEMAS } from '@agent-remote-control/protocol/settings';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { IRuntimeSettingsPort } from '../../settings/ports/runtime-settings.port.js';
import type { DiscordConnectionTest } from '../models/discord-connection-test.model.js';
import { IDiscordConnectionTesterPort } from '../ports/discord-connection-tester.port.js';


export type TestDiscordConnectionInput = {
  /** A token typed in the form and not saved yet; the saved one when absent or blank. */
  readonly token?: string;
  /** The server id of the form, an empty one testing no server; the saved one when absent. */
  readonly guildId?: string;
};

/** Tests a bot token before it is saved. The token never reaches a log. */
@Injectable()
export class TestDiscordConnectionUseCase {
  private readonly logger = new Logger(TestDiscordConnectionUseCase.name);

  constructor(
    @Inject(IRuntimeSettingsPort) private readonly settings: IRuntimeSettingsPort,
    @Inject(IDiscordConnectionTesterPort) private readonly tester: IDiscordConnectionTesterPort,
  ) {}

  async execute({ token, guildId }: TestDiscordConnectionInput): Promise<DiscordConnectionTest> {
    const testedToken = token?.trim() || this.settings.get('DISCORD_BOT_TOKEN');
    if (!testedToken) {
      return { ok: false, error: 'There is no bot token to test: type one, or save one first.' };
    }
    const guild = SETTING_SCHEMAS.DISCORD_GUILD_ID.safeParse(guildId ?? this.settings.get('DISCORD_GUILD_ID'));
    if (!guild.success) {
      return { ok: false, error: guild.error.issues[0].message };
    }
    const result = await this.tester.test(testedToken, guild.data || undefined);
    this.logger.log(result.ok ? `[Discord Test] Bot=${result.botName}${result.guildName ? `, Server=${result.guildName}` : ''}` : `[Discord Test Failed] ${result.error}`);
    return result;
  }
}
