import type { DiscordConnectionTest } from '../models/discord-connection-test.model.js';
import type { IDiscordConnectionTesterPort } from '../ports/discord-connection-tester.port.js';


export class StubDiscordConnectionTester implements IDiscordConnectionTesterPort {
  readonly tests: { token: string; guildId?: string }[] = [];
  result: DiscordConnectionTest = { ok: true, botName: 'arc-bot' };

  async test(token: string, guildId?: string): Promise<DiscordConnectionTest> {
    this.tests.push({ token, guildId });
    return this.result;
  }
}
