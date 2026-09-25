import type { Client } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DiscordClientService } from './discord-client.service.js';


describe('DiscordClientService', () => {
  let loginMock: ReturnType<typeof vi.fn>;
  let destroyMock: ReturnType<typeof vi.fn>;
  let onMock: ReturnType<typeof vi.fn>;
  let mockClient: Client;
  let service: DiscordClientService;
  const originalToken = process.env.DISCORD_BOT_TOKEN;

  beforeEach(() => {
    loginMock = vi.fn().mockResolvedValue('token');
    destroyMock = vi.fn().mockResolvedValue(undefined);
    onMock = vi.fn().mockReturnThis();

    mockClient = {
      login: loginMock,
      destroy: destroyMock,
      on: onMock,
    } as unknown as Client;

    service = new DiscordClientService(mockClient);
    delete process.env.DISCORD_BOT_TOKEN;
  });

  afterEach(() => {
    if (originalToken) {
      process.env.DISCORD_BOT_TOKEN = originalToken;
    } else {
      delete process.env.DISCORD_BOT_TOKEN;
    }
    vi.restoreAllMocks();
  });

  it('should instantiate with default discord.js Client if none provided', () => {
    const defaultService = new DiscordClientService();
    expect(defaultService.getClient()).toBeDefined();
  });

  it('should return client instance via getClient()', () => {
    expect(service.getClient()).toBe(mockClient);
  });

  it('should delegate event listener registration to client.on', () => {
    const listener = vi.fn();
    service.on('ready', listener);

    expect(onMock).toHaveBeenCalledWith('ready', listener);
  });

  it('should log warning and not login if DISCORD_BOT_TOKEN is not set', async () => {
    await service.onApplicationBootstrap();

    expect(loginMock).not.toHaveBeenCalled();
  });

  it('should login with token if DISCORD_BOT_TOKEN is set', async () => {
    process.env.DISCORD_BOT_TOKEN = 'test-bot-token';

    await service.onApplicationBootstrap();

    expect(loginMock).toHaveBeenCalledWith('test-bot-token');
  });

  it('should handle and log login errors gracefully without throwing', async () => {
    process.env.DISCORD_BOT_TOKEN = 'invalid-token';
    loginMock.mockRejectedValueOnce(new Error('Disallowed intents'));

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it('should handle string error on login without throwing', async () => {
    process.env.DISCORD_BOT_TOKEN = 'invalid-token';
    loginMock.mockRejectedValueOnce('raw string error');

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it('should destroy client on application shutdown', async () => {
    await service.onApplicationShutdown();

    expect(destroyMock).toHaveBeenCalledTimes(1);
  });

  it('should handle and log destroy errors gracefully on shutdown', async () => {
    destroyMock.mockRejectedValueOnce(new Error('Socket error'));

    await expect(service.onApplicationShutdown()).resolves.toBeUndefined();
  });

  it('should handle string error on destroy without throwing', async () => {
    destroyMock.mockRejectedValueOnce('raw string destroy error');

    await expect(service.onApplicationShutdown()).resolves.toBeUndefined();
  });
});
