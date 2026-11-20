import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core';
import { Client } from 'discord.js';

import { StubAgentAuthPort } from '../../agent/testing/stub-agent-auth.port.js';
import { StubAgentTurnPort } from '../../orchestrator/testing/stub-agent-turn.port.js';
import { SettingsChangeNotifierService } from '../../settings/services/settings-change-notifier.service.js';
import { StubRuntimeSettings } from '../../settings/testing/stub-runtime-settings.js';

import { DiscordClientService } from './discord-client.service.js';


const COMMANDS = [
  { name: 'cancel', description: 'Cancels the AI agent\'s active turn' },
  { name: 'model', description: 'Chooses the model and effort used by the agents' },
  { name: 'usage', description: 'Shows the current AI agent\'s usage limits' },
  { name: 'agent', description: 'Switches the AI agent (Antigravity, Claude Code...)' },
  { name: 'profiles', description: 'Configure agent, model and effort for each profile' },
  { name: 'squad', description: 'Applies a squad of agent profiles to this conversation' },
  { name: 'language', description: 'Changes the language agents use to talk to you' },
  { name: 'agent-auth', description: 'Log in to an agent CLI', dmPermission: false },
];

const SHELL_COMMAND = {
  name: 'shell',
  description: 'Runs a shell command directly on the host',
  dmPermission: false,
  options: [{ name: 'command', description: 'The command to run', type: 3, required: true }],
};

const GUILD_ID = '12345678901234567';

type FakeClient = {
  login: ReturnType<typeof rs.fn>;
  destroy: ReturnType<typeof rs.fn>;
  on: ReturnType<typeof rs.fn>;
  guilds?: unknown;
  application?: { commands: { set: ReturnType<typeof rs.fn> } } | null;
};

function fakeClient(): FakeClient {
  return {
    login: rs.fn().mockResolvedValue('token'),
    destroy: rs.fn().mockResolvedValue(undefined),
    on: rs.fn(),
    application: { commands: { set: rs.fn().mockResolvedValue([]) } },
  };
}

describe('DiscordClientService', () => {
  const agentTurn = new StubAgentTurnPort();
  const agentAuth = new StubAgentAuthPort();
  let settings: StubRuntimeSettings;
  let settingsChanges: SettingsChangeNotifierService;
  let clients: FakeClient[];
  let service: DiscordClientService;
  let log: ReturnType<typeof rs.spyOn>;
  let warn: ReturnType<typeof rs.spyOn>;
  let error: ReturnType<typeof rs.spyOn>;
  const client = (index = 0) => clients[index]!;
  const globalCommands = (index = 0) => client(index).application!.commands.set;
  const withGuild = (guild: unknown, fetch = rs.fn().mockResolvedValue(guild)) => {
    settings.set('DISCORD_GUILD_ID', GUILD_ID);
    client().guilds = { cache: new Map(guild ? [[GUILD_ID, guild]] : []), fetch };
  };
  const messageOf = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure));

  beforeEach(() => {
    agentTurn.shellEnabled = false;
    agentAuth.enabled = true;
    log = rs.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = rs.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    error = rs.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    settings = new StubRuntimeSettings({ DISCORD_BOT_TOKEN: 'test-bot-token' });
    settingsChanges = new SettingsChangeNotifierService();
    clients = [];
    service = new DiscordClientService(agentTurn, agentAuth, settings, settingsChanges, () => {
      const created = fakeClient();
      clients.push(created);
      return created as unknown as Client;
    });
  });

  afterEach(() => {
    rs.restoreAllMocks();
  });

  it('should build a discord.js client when none is given', () => {
    expect(new DiscordClientService(agentTurn, agentAuth, settings, settingsChanges).getClient()).toBeInstanceOf(Client);
  });

  it('should hand out the client and register listeners on it', () => {
    const listener = rs.fn();
    service.on('ready', listener);

    expect(service.getClient()).toBe(client());
    expect(client().on).toHaveBeenCalledWith('ready', listener);
  });

  it('should warn and not log in while DISCORD_BOT_TOKEN is empty', async () => {
    settings.set('DISCORD_BOT_TOKEN', '');

    await service.onApplicationBootstrap();

    expect(client().login).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('DISCORD_BOT_TOKEN is not set. Discord bot client will not connect.');
  });

  it('should not log in while DISCORD_ENABLED is false, whatever the token', async () => {
    settings.set('DISCORD_ENABLED', false);

    await service.onApplicationBootstrap();

    expect(client().login).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('The Discord bot is turned off (DISCORD_ENABLED); the client will not connect.');
  });

  it('should register the commands only in the guild and clear the global ones', async () => {
    const setGuildCommands = rs.fn().mockResolvedValue([]);
    withGuild({ commands: { set: setGuildCommands } });

    await service.onApplicationBootstrap();

    expect(client().login).toHaveBeenCalledWith('test-bot-token');
    expect(setGuildCommands).toHaveBeenCalledWith(COMMANDS);
    expect(globalCommands()).toHaveBeenCalledTimes(1);
    expect(globalCommands()).toHaveBeenCalledWith([]);
  });

  it('should register the shell command only when shell commands are enabled', async () => {
    agentTurn.shellEnabled = true;

    await service.onApplicationBootstrap();

    expect(globalCommands()).toHaveBeenCalledWith([...COMMANDS, SHELL_COMMAND]);
  });

  it('should leave the login command out when agent authentication is disabled', async () => {
    agentAuth.enabled = false;

    await service.onApplicationBootstrap();

    expect(globalCommands()).toHaveBeenCalledWith(COMMANDS.filter(command => command.name !== 'agent-auth'));
  });

  it('should register the guild commands even without an application', async () => {
    const setGuildCommands = rs.fn().mockResolvedValue([]);
    withGuild({ commands: { set: setGuildCommands } });
    client().application = null;

    await service.onApplicationBootstrap();

    expect(setGuildCommands).toHaveBeenCalledWith(COMMANDS);
  });

  it('should register the commands globally when no guild is configured', async () => {
    await service.onApplicationBootstrap();

    expect(globalCommands()).toHaveBeenCalledTimes(1);
    expect(globalCommands()).toHaveBeenCalledWith(COMMANDS);
  });

  it('should register nothing without a guild nor an application', async () => {
    client().application = null;

    await service.onApplicationBootstrap();

    expect(log).not.toHaveBeenCalledWith('Global slash commands registered successfully');
  });

  it('should fetch a guild that is not cached', async () => {
    const setGuildCommands = rs.fn().mockResolvedValue([]);
    const fetch = rs.fn().mockResolvedValue({ commands: { set: setGuildCommands } });
    withGuild(undefined, fetch);

    await service.onApplicationBootstrap();

    expect(fetch).toHaveBeenCalledWith(GUILD_ID);
    expect(setGuildCommands).toHaveBeenCalledWith(COMMANDS);
  });

  it('should fall back to global registration when the guild cannot be fetched', async () => {
    withGuild(undefined, rs.fn().mockRejectedValue(new Error('Unknown Guild')));

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();

    expect(globalCommands()).toHaveBeenCalledWith(COMMANDS);
  });

  it.each([new Error('Missing Access'), 'raw slash error'])('should log a failed registration (%s) without throwing', async (failure) => {
    globalCommands().mockRejectedValueOnce(failure);

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(`Failed to register slash commands: ${messageOf(failure)}`);
  });

  it.each([new Error('Disallowed intents'), 'raw string error'])('should log a failed login (%s) without throwing', async (failure) => {
    client().login.mockRejectedValueOnce(failure);

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith(`Failed to login Discord client: ${messageOf(failure)}`);
    expect(globalCommands()).not.toHaveBeenCalled();
  });

  it('should destroy the client on application shutdown and stop following the settings', async () => {
    await service.onApplicationBootstrap();

    await service.onApplicationShutdown();
    settingsChanges.notify(['DISCORD_BOT_TOKEN']);
    await service.start();

    expect(client().destroy).toHaveBeenCalledTimes(1);
    expect(clients).toHaveLength(1);
  });

  it.each([new Error('Socket error'), 'raw string destroy error'])('should log a failed destroy (%s) without throwing', async (failure) => {
    client().destroy.mockRejectedValueOnce(failure);

    await expect(service.onApplicationShutdown()).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith(`Error destroying Discord client: ${messageOf(failure)}`);
  });

  describe('when the Discord settings change', () => {
    it('should log in with the new token on a new client that keeps the listeners', async () => {
      const listener = rs.fn();
      service.on('messageCreate', listener);
      await service.onApplicationBootstrap();
      settings.set('DISCORD_BOT_TOKEN', 'new-token');

      settingsChanges.notify(['DISCORD_BOT_TOKEN']);

      await rs.waitFor(() => expect(clients[1]?.login).toHaveBeenCalledWith('new-token'));
      expect(client(0).destroy).toHaveBeenCalledTimes(1);
      expect(client(1).on).toHaveBeenCalledWith('messageCreate', listener);
      expect(service.getClient()).toBe(client(1));
    });

    it('should start a bot that never logged in once it is given a token, keeping its client', async () => {
      settings.set('DISCORD_BOT_TOKEN', '');
      await service.onApplicationBootstrap();
      settings.set('DISCORD_BOT_TOKEN', 'first-token');

      settingsChanges.notify(['DISCORD_BOT_TOKEN']);

      await rs.waitFor(() => expect(client().login).toHaveBeenCalledWith('first-token'));
      expect(client().destroy).not.toHaveBeenCalled();
      expect(clients).toHaveLength(1);
    });

    it('should disconnect once turned off, and log in on a new client after a failed login', async () => {
      client().login.mockRejectedValueOnce(new Error('An invalid token was provided.'));
      await service.onApplicationBootstrap();
      settings.set('DISCORD_ENABLED', false);

      await service.restart();

      expect(client(0).destroy).toHaveBeenCalledTimes(1);
      expect(client(1).login).not.toHaveBeenCalled();
      settings.set('DISCORD_ENABLED', true);
      await service.restart();
      expect(client(1).login).toHaveBeenCalledWith('test-bot-token');
    });

    it('should stop without logging in again', async () => {
      await service.onApplicationBootstrap();

      await service.stop();
      await service.stop();

      expect(client(0).destroy).toHaveBeenCalledTimes(1);
      expect(clients).toHaveLength(2);
      expect(client(1).login).not.toHaveBeenCalled();
    });

    it('should register the commands again when the shell or the agent login is switched on or off', async () => {
      await service.onApplicationBootstrap();
      agentTurn.shellEnabled = true;

      settingsChanges.notify(['SHELL_COMMAND_ENABLED']);

      await rs.waitFor(() => expect(globalCommands()).toHaveBeenLastCalledWith([...COMMANDS, SHELL_COMMAND]));
      expect(client().login).toHaveBeenCalledTimes(1);
    });

    it('should register no commands while disconnected, and ignore the other settings', async () => {
      settings.set('DISCORD_BOT_TOKEN', '');
      await service.onApplicationBootstrap();

      settingsChanges.notify(['AGENT_AUTH_ENABLED']);
      settingsChanges.notify(['QUESTION_TIMEOUT_MS']);
      await service.start();

      expect(globalCommands()).not.toHaveBeenCalled();
      expect(clients).toHaveLength(1);
    });
  });
});
