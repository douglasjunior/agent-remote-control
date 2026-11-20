import { DiscordAPIError, REST } from 'discord.js';

import { RestDiscordConnectionTesterAdapter } from './rest-discord-connection-tester.adapter.js';


const refusal = (status: number) => new DiscordAPIError({ code: 0, message: 'refused' }, 0, status, 'GET', '/', {});

describe('RestDiscordConnectionTesterAdapter', () => {
  const tester = new RestDiscordConnectionTesterAdapter();
  let get: ReturnType<typeof rs.spyOn>;

  beforeEach(() => {
    get = rs.spyOn(REST.prototype, 'get');
  });

  afterEach(() => {
    rs.restoreAllMocks();
  });

  it('should name the bot the token belongs to, preferring its display name', async () => {
    get.mockResolvedValueOnce({ id: '1', username: 'arc-bot', global_name: null });
    await expect(tester.test('token')).resolves.toEqual({ ok: true, botName: 'arc-bot' });

    get.mockResolvedValueOnce({ id: '1', username: 'arc-bot', global_name: 'ARC' });
    await expect(tester.test('token')).resolves.toEqual({ ok: true, botName: 'ARC' });
    expect(get).toHaveBeenCalledWith('/users/@me');
  });

  it('should name the server too when given one the bot is in', async () => {
    get.mockResolvedValueOnce({ id: '1', username: 'arc-bot' }).mockResolvedValueOnce({ id: '123', name: 'Home' });

    await expect(tester.test('token', '123')).resolves.toEqual({ ok: true, botName: 'arc-bot', guildName: 'Home' });
    expect(get).toHaveBeenLastCalledWith('/guilds/123');
  });

  it('should say the token is refused when Discord answers 401', async () => {
    get.mockRejectedValueOnce(refusal(401));

    await expect(tester.test('token')).resolves.toEqual({ ok: false, error: 'Discord refused the token: it is not a bot token, or it was reset.' });
  });

  it.each([403, 404])('should say the bot is not in the server when Discord answers %d', async (status) => {
    get.mockResolvedValueOnce({ id: '1', username: 'arc-bot' }).mockRejectedValueOnce(refusal(status));

    await expect(tester.test('token', '123')).resolves.toEqual({ ok: false, error: 'arc-bot is not in the server 123, or the server ID is wrong.' });
  });

  it.each([
    [refusal(500), 'refused'],
    [new Error('getaddrinfo ENOTFOUND discord.com'), 'getaddrinfo ENOTFOUND discord.com'],
    ['aborted', 'aborted'],
  ])('should report any other failure as it came', async (failure, message) => {
    get.mockRejectedValueOnce(failure);

    await expect(tester.test('token')).resolves.toEqual({ ok: false, error: `Discord could not be reached: ${message}` });
  });
});
