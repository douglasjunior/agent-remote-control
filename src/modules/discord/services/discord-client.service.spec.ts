import type { Client } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrchestratorService } from '../../orchestrator/services/orchestrator.service.js';

import { DiscordClientService } from './discord-client.service.js';


const COMMANDS = [
  { name: 'cancel', description: 'Cancels the AI agent\'s active turn' },
  { name: 'model', description: 'Chooses the model and effort used by the agents' },
  { name: 'usage', description: 'Shows the current AI agent\'s usage limits' },
  { name: 'agent', description: 'Switches the AI agent (Antigravity, Claude Code...)' },
  { name: 'profiles', description: 'Configure agent, model and effort for each profile' },
  { name: 'language', description: 'Changes the language agents use to talk to you' },
];

const SHELL_COMMAND = {
  name: 'shell',
  description: 'Runs a shell command directly on the host',
  dmPermission: false,
  options: [{ name: 'command', description: 'The command to run', type: 3, required: true }],
};

describe('DiscordClientService', () => {
  let shellEnabled: boolean;
  const orchestratorStub = {
    isShellCommandEnabled: () => shellEnabled,
  } as unknown as OrchestratorService;
  let loginMock: ReturnType<typeof vi.fn>;
  let destroyMock: ReturnType<typeof vi.fn>;
  let onMock: ReturnType<typeof vi.fn>;
  let mockClient: Client;
  let service: DiscordClientService;
  const originalToken = process.env.DISCORD_BOT_TOKEN;

  beforeEach(() => {
    shellEnabled = false;
    loginMock = vi.fn().mockResolvedValue('token');
    destroyMock = vi.fn().mockResolvedValue(undefined);
    onMock = vi.fn().mockReturnThis();

    mockClient = {
      login: loginMock,
      destroy: destroyMock,
      on: onMock,
    } as unknown as Client;

    service = new DiscordClientService(orchestratorStub, mockClient);
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
    const defaultService = new DiscordClientService(orchestratorStub);
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

  it('should register the commands only in the guild and clear the global ones', async () => {
    const setGuildCommands = vi.fn().mockResolvedValue([]);
    const setAppCommands = vi.fn().mockResolvedValue([]);
    const guildMock = { commands: { set: setGuildCommands } };

    (mockClient as any).guilds = {
      cache: new Map([['guild-123', guildMock]]),
      fetch: vi.fn().mockResolvedValue(guildMock),
    };
    (mockClient as any).application = {
      commands: { set: setAppCommands },
    };

    process.env.DISCORD_BOT_TOKEN = 'test-bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-123';

    await service.onApplicationBootstrap();

    expect(loginMock).toHaveBeenCalledWith('test-bot-token');
    expect(setGuildCommands).toHaveBeenCalledWith(COMMANDS);
    expect(setAppCommands).toHaveBeenCalledTimes(1);
    expect(setAppCommands).toHaveBeenCalledWith([]);

    delete process.env.DISCORD_GUILD_ID;
  });

  it('should register the shell command only when shell commands are enabled', async () => {
    shellEnabled = true;
    const setAppCommands = vi.fn().mockResolvedValue([]);
    (mockClient as any).application = { commands: { set: setAppCommands } };
    process.env.DISCORD_BOT_TOKEN = 'test-bot-token';

    await service.onApplicationBootstrap();

    expect(setAppCommands).toHaveBeenCalledWith([...COMMANDS, SHELL_COMMAND]);
  });

  it('should register the guild commands even without an application', async () => {
    const setGuildCommands = vi.fn().mockResolvedValue([]);
    const guildMock = { commands: { set: setGuildCommands } };
    (mockClient as any).guilds = { cache: new Map([['guild-123', guildMock]]), fetch: vi.fn() };
    (mockClient as any).application = null;
    process.env.DISCORD_BOT_TOKEN = 'test-bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-123';

    await service.onApplicationBootstrap();

    expect(setGuildCommands).toHaveBeenCalledWith(COMMANDS);
    delete process.env.DISCORD_GUILD_ID;
  });

  it('should register the commands globally when no guild is configured', async () => {
    const setAppCommands = vi.fn().mockResolvedValue([]);
    (mockClient as any).application = { commands: { set: setAppCommands } };
    process.env.DISCORD_BOT_TOKEN = 'test-bot-token';

    await service.onApplicationBootstrap();

    expect(setAppCommands).toHaveBeenCalledTimes(1);
    expect(setAppCommands).toHaveBeenCalledWith(COMMANDS);
  });

  it('should fetch guild if not cached when registering slash commands', async () => {
    const setGuildCommands = vi.fn().mockResolvedValue([]);
    const guildMock = { commands: { set: setGuildCommands } };
    const fetchMock = vi.fn().mockResolvedValue(guildMock);

    (mockClient as any).guilds = {
      cache: new Map(),
      fetch: fetchMock,
    };
    (mockClient as any).application = {
      commands: { set: vi.fn() },
    };

    process.env.DISCORD_BOT_TOKEN = 'test-bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-456';

    await service.onApplicationBootstrap();

    expect(fetchMock).toHaveBeenCalledWith('guild-456');
    expect(setGuildCommands).toHaveBeenCalled();

    delete process.env.DISCORD_GUILD_ID;
  });

  it('should fall back to global registration when the guild cannot be fetched', async () => {
    const setAppCommands = vi.fn().mockResolvedValue([]);
    (mockClient as any).guilds = {
      cache: new Map(),
      fetch: vi.fn().mockRejectedValue(new Error('Guild not found')),
    };
    (mockClient as any).application = {
      commands: { set: setAppCommands },
    };

    process.env.DISCORD_BOT_TOKEN = 'test-bot-token';
    process.env.DISCORD_GUILD_ID = 'guild-missing';

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(setAppCommands).toHaveBeenCalledWith(COMMANDS);

    delete process.env.DISCORD_GUILD_ID;
  });

  it('should catch and log error if registerSlashCommands throws', async () => {
    (mockClient as any).application = {
      commands: {
        set: vi.fn().mockRejectedValueOnce(new Error('Missing Access')),
      },
    };

    process.env.DISCORD_BOT_TOKEN = 'test-bot-token';

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it('should catch and log raw string error if registerSlashCommands throws', async () => {
    (mockClient as any).application = {
      commands: {
        set: vi.fn().mockRejectedValueOnce('raw slash error'),
      },
    };

    process.env.DISCORD_BOT_TOKEN = 'test-bot-token';

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
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
