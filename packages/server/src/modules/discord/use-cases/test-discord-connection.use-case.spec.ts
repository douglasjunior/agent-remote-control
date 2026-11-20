import { Logger } from '@nestjs/common';

import { StubRuntimeSettings } from '../../settings/testing/stub-runtime-settings.js';
import type { DiscordConnectionTest } from '../models/discord-connection-test.model.js';
import type { IDiscordConnectionTesterPort } from '../ports/discord-connection-tester.port.js';

import { TestDiscordConnectionUseCase } from './test-discord-connection.use-case.js';


class StubDiscordConnectionTester implements IDiscordConnectionTesterPort {
  readonly tests: { token: string; guildId?: string }[] = [];
  result: DiscordConnectionTest = { ok: true, botName: 'arc-bot' };

  async test(token: string, guildId?: string): Promise<DiscordConnectionTest> {
    this.tests.push({ token, guildId });
    return this.result;
  }
}

describe('TestDiscordConnectionUseCase', () => {
  let settings: StubRuntimeSettings;
  let tester: StubDiscordConnectionTester;
  let useCase: TestDiscordConnectionUseCase;
  let log: ReturnType<typeof rs.spyOn>;

  beforeEach(() => {
    log = rs.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    settings = new StubRuntimeSettings({ DISCORD_BOT_TOKEN: 'saved-token', DISCORD_GUILD_ID: '11111111111111111' });
    tester = new StubDiscordConnectionTester();
    useCase = new TestDiscordConnectionUseCase(settings, tester);
  });

  afterEach(() => {
    rs.restoreAllMocks();
  });

  it('should test the token and the server typed in the form, before they are saved', async () => {
    tester.result = { ok: true, botName: 'arc-bot', guildName: 'Home' };

    await expect(useCase.execute({ token: ' typed-token ', guildId: '22222222222222222' })).resolves.toEqual({ ok: true, botName: 'arc-bot', guildName: 'Home' });

    expect(tester.tests).toEqual([{ token: 'typed-token', guildId: '22222222222222222' }]);
    expect(log).toHaveBeenCalledWith('[Discord Test] Bot=arc-bot, Server=Home');
    expect(JSON.stringify(log.mock.calls)).not.toContain('typed-token');
  });

  it('should test the saved token and server when the form gives none, and no server when the form clears it', async () => {
    await useCase.execute({ token: '  ' });
    await useCase.execute({ guildId: '' });

    expect(tester.tests).toEqual([{ token: 'saved-token', guildId: '11111111111111111' }, { token: 'saved-token', guildId: undefined }]);
    expect(log).toHaveBeenCalledWith('[Discord Test] Bot=arc-bot');
  });

  it('should log a failed test', async () => {
    tester.result = { ok: false, error: 'Discord refused the token.' };

    await expect(useCase.execute({})).resolves.toEqual({ ok: false, error: 'Discord refused the token.' });
    expect(log).toHaveBeenCalledWith('[Discord Test Failed] Discord refused the token.');
  });

  it('should refuse to test without any token, or with a server id that is not one', async () => {
    settings.set('DISCORD_BOT_TOKEN', '');
    await expect(useCase.execute({})).resolves.toEqual({ ok: false, error: 'There is no bot token to test: type one, or save one first.' });

    await expect(useCase.execute({ token: 'typed', guildId: 'home' })).resolves.toEqual({ ok: false, error: 'A server ID is a number of 17 to 20 digits' });
    expect(tester.tests).toEqual([]);
  });
});
