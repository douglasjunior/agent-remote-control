import { Test, type TestingModule } from '@nestjs/testing';
import type { ChatInputCommandInteraction, Message } from 'discord.js';
import { Events } from 'discord.js';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { type AgentProviderInfo, IAgentPortFactory } from '../src/modules/agent/ports/agent-port-factory.port.js';
import {
  type AgentActivity,
  type AgentEffortState,
  type AgentModelState,
  type AgentUpdate,
  type AgentUsage,
  type IAgentPort,
  PromptCancelledError,
} from '../src/modules/agent/ports/agent.port.js';
import { DiscordInteractionHandler } from '../src/modules/discord/handlers/discord-interaction.handler.js';
import { DiscordMessageHandler } from '../src/modules/discord/handlers/discord-message.handler.js';
import { DiscordClientService } from '../src/modules/discord/services/discord-client.service.js';
import { ISessionStorePort } from '../src/modules/orchestrator/ports/session-store.port.js';


const FOOTER = '-# 🤖 CEO (agy) · 🧠 Fast Model · ⚡ padrão · 🪙 150 tokens';

const AGENTS: readonly AgentProviderInfo[] = [
  { agentId: 'agy', displayName: 'Antigravity' },
  { agentId: 'claude', displayName: 'Claude Code' },
];

function agentFactory(create: (agentId: string) => Partial<IAgentPort> | undefined): IAgentPortFactory {
  return {
    defaultAgentId: 'agy',
    listAgents: () => AGENTS,
    create: agentId => create(agentId) as IAgentPort,
  };
}

class E2EAgentFake implements Partial<IAgentPort> {
  agentName = 'agy';
  lastAgentMessage = 'Implementation completed successfully.';
  currentSessionId?: string;
  readonly sessionCwds: string[] = [];
  readonly prompts: string[] = [];

  async connect(): Promise<void> {
    return undefined;
  }

  async createSession(cwd: string): Promise<void> {
    this.sessionCwds.push(cwd);
    this.currentSessionId = 'e2e-session-123';
  }

  async loadSession(): Promise<boolean> {
    return false;
  }

  async getLastRoundUsage(): Promise<AgentUsage> {
    return {
      totalTokens: 150,
      inputTokens: 100,
      outputTokens: 50,
    };
  }

  async* prompt(text: string): AsyncGenerator<AgentUpdate> {
    this.prompts.push(text);
    yield { kind: 'text', text: 'Implementation completed successfully.' };
  }

  onActivity(listener: (activity: AgentActivity) => void): () => void {
    listener({
      kind: 'thought',
      id: 'thought-e2e-1',
      text: 'Analyzing user request in Discord thread...',
    });
    listener({
      kind: 'tool',
      toolCallId: 'tool-call-1',
      title: 'git status',
      status: 'in_progress',
    });
    listener({
      kind: 'tool',
      toolCallId: 'tool-call-1',
      title: 'git status',
      status: 'completed',
    });
    return () => undefined;
  }

  async cancel(): Promise<void> {
    return undefined;
  }

  async closeSession(): Promise<void> {
    return undefined;
  }

  async disconnect(): Promise<void> {
    return undefined;
  }

  getAvailableModels(): AgentModelState | null {
    return null;
  }

  async getAvailableEffortsForModel(_modelId: string): Promise<AgentEffortState | null> {
    return null;
  }

  async setConfig(): Promise<void> {
    return undefined;
  }
}

class ScriptedAgentFake extends E2EAgentFake {
  constructor(private readonly responses: string[]) {
    super();
  }

  override async* prompt(text: string): AsyncGenerator<AgentUpdate> {
    this.prompts.push(text);
    this.lastAgentMessage = this.responses.shift() ?? '';
    yield { kind: 'text', text: this.lastAgentMessage };
  }
}

class BlockingAgentFake extends E2EAgentFake {
  private rejectPrompt: ((error: Error) => void) | null = null;
  readonly promptStarted: Promise<void>;
  private markStarted: () => void = () => undefined;

  constructor() {
    super();
    this.promptStarted = new Promise((resolve) => {
      this.markStarted = resolve;
    });
  }

  override async* prompt(text: string): AsyncGenerator<AgentUpdate> {
    this.prompts.push(text);
    this.lastAgentMessage = '';
    await new Promise<void>((_resolve, reject) => {
      this.rejectPrompt = reject;
      this.markStarted();
    });
    yield { kind: 'text', text: '' };
  }

  override async cancel(): Promise<void> {
    this.rejectPrompt?.(new PromptCancelledError());
  }
}

class SelectableAgentFake extends E2EAgentFake {
  override lastAgentMessage = 'Built it.';

  constructor(agentId = 'agy') {
    super();
    this.agentName = agentId;
  }

  override getAvailableModels(): AgentModelState {
    return {
      availableModels: [
        { modelId: 'one', name: 'one', displayName: 'Model One' },
        { modelId: 'two', name: 'two', displayName: 'Model Two' },
      ],
      currentModelId: 'one',
    };
  }

  override async getAvailableEffortsForModel(modelId: string): Promise<AgentEffortState | null> {
    if (modelId !== 'two') {
      return null;
    }
    return {
      availableEfforts: [
        { effortId: 'low', name: 'Low' },
        { effortId: 'high', name: 'High' },
      ],
      currentEffortId: 'low',
    };
  }
}

function seedAgentSettings(dataDir: string, conversationId = 'channel-e2e-111:thread-e2e-999'): void {
  const existing = existsSync(join(dataDir, 'agent-settings.json'))
    ? JSON.parse(readFileSync(join(dataDir, 'agent-settings.json'), 'utf-8'))
    : {};
  existing[conversationId] = {
    agentId: 'agy',
    agentName: 'Antigravity',
    modelId: 'fast',
    modelName: 'Fast Model',
    effortId: null,
    effortName: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  writeFileSync(
    join(dataDir, 'agent-settings.json'),
    JSON.stringify(existing, null, 2),
  );
}

function buildThread(id: string, parentId: string, sent: string[]) {
  return {
    id,
    parentId,
    ownerId: 'bot-e2e-id',
    isDMBased: vi.fn().mockReturnValue(false),
    isThread: vi.fn().mockReturnValue(true),
    send: vi.fn().mockImplementation(async (content: string) => {
      sent.push(content);
      return { edit: vi.fn().mockResolvedValue(undefined) };
    }),
  };
}

function threadReply(thread: ReturnType<typeof buildThread>, content: string): Message {
  return {
    author: { bot: false, id: 'discord-user-777' },
    channelId: thread.id,
    cleanContent: content,
    content,
    mentions: { has: vi.fn().mockReturnValue(false) },
    channel: thread,
  } as unknown as Message;
}

describe('Discord Bot Driving Adapter (e2e)', () => {
  let workspaceDir: string;
  let dataDir: string;
  const originalWorkspaceDir = process.env.WORKSPACE_DIR;
  const originalDataDir = process.env.DATA_DIR;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'arc-e2e-data-'));
    process.env.DATA_DIR = dataDir;
  });

  afterEach(() => {
    if (originalDataDir === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = originalDataDir;
    }
    rmSync(dataDir, { recursive: true, force: true });
  });

  beforeAll(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'arc-e2e-workspaces-'));
    process.env.WORKSPACE_DIR = workspaceDir;
  });

  afterAll(() => {
    if (originalWorkspaceDir === undefined) {
      delete process.env.WORKSPACE_DIR;
    } else {
      process.env.WORKSPACE_DIR = originalWorkspaceDir;
    }
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('should process user message, emit activities, and post final response to thread', async () => {
    seedAgentSettings(dataDir);
    const fakeAgent = new E2EAgentFake();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(IAgentPortFactory)
      .useValue(agentFactory(() => fakeAgent))
      .compile();

    const app = moduleFixture.createNestApplication();
    await app.init();

    const discordClientService =
      moduleFixture.get<DiscordClientService>(DiscordClientService);
    const messageHandler = moduleFixture.get<DiscordMessageHandler>(
      DiscordMessageHandler,
    );
    const sessionStore =
      moduleFixture.get<ISessionStorePort>(ISessionStorePort);

    const client = discordClientService.getClient();
    const botUser = { id: 'bot-e2e-id', username: 'RemoteControlBot' };
    (client as any).user = botUser;

    const editMock = vi.fn().mockResolvedValue(undefined);
    const progressMessage = {
      edit: editMock,
    };
    const threadMessages: string[] = [];
    const mockThread = {
      id: 'thread-e2e-999',
      parentId: 'channel-e2e-111',
      send: vi.fn().mockImplementation(async (content: string) => {
        threadMessages.push(content);
        return progressMessage;
      }),
    };

    const startThreadMock = vi.fn().mockResolvedValue(mockThread);
    const incomingMessage = {
      author: { bot: false, id: 'discord-user-777' },
      channelId: 'channel-e2e-111',
      cleanContent: 'Please implement git ability in CEO persona',
      content: '<@!bot-e2e-id> Please implement git ability in CEO persona',
      mentions: {
        has: vi
          .fn()
          .mockImplementation((user: any) => user?.id === 'bot-e2e-id'),
      },
      channel: {
        isDMBased: vi.fn().mockReturnValue(false),
        isThread: vi.fn().mockReturnValue(false),
      },
      startThread: startThreadMock,
    } as unknown as Message;

    await messageHandler.handleMessage(incomingMessage);

    expect(startThreadMock).toHaveBeenCalledWith({
      name: 'Please implement git ability in CEO persona',
      autoArchiveDuration: 60,
    });

    expect(threadMessages).toContain('⏳ *Iniciando processamento...*');
    expect(threadMessages).toContain(`Implementation completed successfully.\n${FOOTER}`);

    expect(editMock).toHaveBeenCalled();

    const storedSession = await sessionStore.findSession(
      'channel-e2e-111:thread-e2e-999',
    );
    expect(storedSession).not.toBeNull();
    expect(storedSession?.userId).toBe('discord-user-777');
    expect(storedSession?.agentRole).toBe('CEO');
    expect(storedSession?.agentSessions).toEqual([{ role: 'CEO', agentId: 'agy', sessionId: 'e2e-session-123', projectName: null }]);
    expect(readFileSync(join(dataDir, 'sessions.json'), 'utf-8')).toContain('e2e-session-123');

    await app.close();
  });

  it('should cancel a turn in progress through the /cancel slash command', async () => {
    seedAgentSettings(dataDir, 'channel-main:thread-sub');
    const fakeAgent = new BlockingAgentFake();
    const cancelSpy = vi.spyOn(fakeAgent, 'cancel');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(IAgentPortFactory)
      .useValue(agentFactory(() => fakeAgent))
      .compile();

    const app = moduleFixture.createNestApplication();
    await app.init();

    const discordClientService =
      moduleFixture.get<DiscordClientService>(DiscordClientService);
    const messageHandler = moduleFixture.get<DiscordMessageHandler>(
      DiscordMessageHandler,
    );
    const client = discordClientService.getClient();
    (client as any).user = { id: 'bot-e2e-id' };

    const threadMessages: string[] = [];
    const thread = {
      id: 'thread-sub',
      parentId: 'channel-main',
      ownerId: 'bot-e2e-id',
      isDMBased: vi.fn().mockReturnValue(false),
      isThread: vi.fn().mockReturnValue(true),
      send: vi.fn().mockImplementation(async (content: string) => {
        threadMessages.push(content);
        return { edit: vi.fn().mockResolvedValue(undefined) };
      }),
    };
    const incomingMessage = {
      author: { bot: false, id: 'discord-user-777' },
      channelId: 'thread-sub',
      cleanContent: 'Long task',
      content: 'Long task',
      mentions: { has: vi.fn().mockReturnValue(false) },
      channel: thread,
    } as unknown as Message;

    const handling = messageHandler.handleMessage(incomingMessage);
    await fakeAgent.promptStarted;

    const replyMock = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      isChatInputCommand: vi.fn().mockReturnValue(true),
      commandName: 'cancel',
      channelId: 'thread-sub',
      inGuild: vi.fn().mockReturnValue(true),
      channel: {
        id: 'thread-sub',
        isDMBased: vi.fn().mockReturnValue(false),
        isThread: vi.fn().mockReturnValue(true),
        parentId: 'channel-main',
      },
      deferred: false,
      replied: false,
      reply: replyMock,
      followUp: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatInputCommandInteraction;

    client.emit(Events.InteractionCreate, interaction);
    await handling;

    expect(cancelSpy).toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(replyMock).toHaveBeenCalledWith({
        content:
          '🛑 **Cancelamento solicitado.** O turno ativo será interrompido.',
        ephemeral: true,
      });
    });
    expect(threadMessages).toContain(`⚠️ **Turno cancelado pelo usuário.**\n${FOOTER}`);

    await app.close();
  });

  it('should delegate from CEO to Developer inside the project workspace and report the final summary', async () => {
    seedAgentSettings(dataDir, 'channel-delegation:thread-delegation');
    mkdirSync(join(workspaceDir, 'my-app'), { recursive: true });
    const ceo = new ScriptedAgentFake([
      'On it.\n<delegate role="DEVELOPER" project="my-app">\nImplement the login screen.\n</delegate>',
      'Login delivered.',
    ]);
    const developer = new ScriptedAgentFake(['Login screen implemented.']);
    const agents = [ceo, developer];

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(IAgentPortFactory)
      .useValue(agentFactory(() => agents.shift()))
      .compile();

    const app = moduleFixture.createNestApplication();
    await app.init();

    const discordClientService =
      moduleFixture.get<DiscordClientService>(DiscordClientService);
    const messageHandler = moduleFixture.get<DiscordMessageHandler>(
      DiscordMessageHandler,
    );
    (discordClientService.getClient() as any).user = { id: 'bot-e2e-id' };

    const threadMessages: string[] = [];
    const mockThread = {
      id: 'thread-delegation',
      parentId: 'channel-delegation',
      send: vi.fn().mockImplementation(async (content: string) => {
        threadMessages.push(content);
        return { edit: vi.fn().mockResolvedValue(undefined) };
      }),
    };
    const incomingMessage = {
      author: { bot: false, id: 'discord-user-777' },
      channelId: 'channel-delegation',
      cleanContent: 'Add login to my-app',
      content: '<@bot-e2e-id> Add login to my-app',
      mentions: {
        has: vi.fn().mockImplementation((user: any) => user?.id === 'bot-e2e-id'),
      },
      channel: { isDMBased: vi.fn().mockReturnValue(false), isThread: vi.fn().mockReturnValue(false) },
      startThread: vi.fn().mockResolvedValue(mockThread),
    } as unknown as Message;

    await messageHandler.handleMessage(incomingMessage);

    expect(ceo.sessionCwds).toEqual([workspaceDir]);
    expect(ceo.prompts[0]).toContain('[ORCHESTRATOR_INSTRUCTIONS]');
    expect(ceo.prompts[1]).not.toContain('[ORCHESTRATOR_INSTRUCTIONS]');
    expect(developer.sessionCwds).toEqual([join(workspaceDir, 'my-app')]);
    expect(developer.prompts[0]).toContain('Developer Agent');
    expect(developer.prompts[0]).toContain('Implement the login screen.');
    expect(developer.prompts[0]).not.toContain('On it.');
    expect(ceo.prompts[1]).toContain(
      '<agent_result role="DEVELOPER" project="my-app">\nLogin screen implemented.\n</agent_result>',
    );
    expect(threadMessages.indexOf('On it.')).toBeLessThan(
      threadMessages.findIndex(content => content.startsWith('🔀 **Tarefa delegada**')),
    );
    expect(threadMessages).toContain(
      '🔀 **Tarefa delegada** ao agente **Developer Agent** (`DEVELOPER`) no projeto `my-app` — ele assumiu a tarefa agora.',
    );
    expect(threadMessages).toContain('↩️ **Developer Agent concluiu** no projeto `my-app` — o CEO está revisando o resultado.');
    expect(threadMessages).toContain(`Login delivered.\n${FOOTER}`);

    await app.close();
  });

  it('should write the CEO guidance to the workspaces root on startup', async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(IAgentPortFactory)
      .useValue(agentFactory(() => new E2EAgentFake()))
      .compile();

    const app = moduleFixture.createNestApplication();
    await app.init();

    expect(readFileSync(join(workspaceDir, 'AGENTS.md'), 'utf8')).toContain(workspaceDir);
    for (const skill of ['agent-team', 'delegation-protocol', 'response-protocol', 'workspace-navigation']) {
      expect(existsSync(join(workspaceDir, '.agents', 'skills', skill, 'SKILL.md'))).toBe(true);
    }
    const skillsLink = join(workspaceDir, '.claude', 'skills');
    expect(lstatSync(skillsLink).isSymbolicLink()).toBe(true);
    expect(readlinkSync(skillsLink)).toBe('../.agents/skills');
    expect(existsSync(join(skillsLink, 'agent-team', 'SKILL.md'))).toBe(true);

    await app.close();
  });

  it('should ask for agent, model and effort on the first message and then run the pending prompt', async () => {
    const agents: SelectableAgentFake[] = [];
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(IAgentPortFactory)
      .useValue(agentFactory((agentId) => {
        const agent = new SelectableAgentFake(agentId);
        agents.push(agent);
        return agent;
      }))
      .compile();
    const app = moduleFixture.createNestApplication();
    await app.init();

    const messageHandler = moduleFixture.get<DiscordMessageHandler>(DiscordMessageHandler);
    (moduleFixture.get<DiscordClientService>(DiscordClientService).getClient() as any).user = {
      id: 'bot-e2e-id',
    };

    const sent: string[] = [];
    const thread = buildThread('thread-select', 'channel-select', sent);
    await messageHandler.handleMessage({
      author: { bot: false, id: 'discord-user-777' },
      channelId: 'channel-select',
      cleanContent: 'Build it',
      content: '<@bot-e2e-id> Build it',
      mentions: { has: vi.fn().mockImplementation((user: any) => user?.id === 'bot-e2e-id') },
      channel: { isDMBased: vi.fn().mockReturnValue(false), isThread: vi.fn().mockReturnValue(false) },
      startThread: vi.fn().mockResolvedValue(thread),
    } as unknown as Message);

    expect(sent.at(-1)).toBe(
      '🤖 **Escolha o agente** respondendo com o número da opção:\n**1.** Antigravity\n**2.** Claude Code',
    );

    await messageHandler.handleMessage(threadReply(thread, 'abc'));
    expect(sent.at(-1)).toMatch(/^⚠️ Opção inválida\. Responda apenas com um número de 1 a 2\./);

    await messageHandler.handleMessage(threadReply(thread, '2'));
    expect(sent.at(-1)).toBe(
      '🧠 **Escolha o modelo do Claude Code** respondendo com o número da opção:\n**1.** Model One\n**2.** Model Two',
    );

    await messageHandler.handleMessage(threadReply(thread, '2'));
    expect(sent.at(-1)).toBe(
      '⚡ **Escolha o effort para Model Two** respondendo com o número da opção:\n**1.** Low\n**2.** High',
    );

    await messageHandler.handleMessage(threadReply(thread, '1'));

    expect(sent).toContain('✅ **Configuração salva**: 🤖 Claude Code · 🧠 Model Two · ⚡ Low');
    expect(JSON.parse(readFileSync(join(dataDir, 'agent-settings.json'), 'utf-8'))['channel-select:thread-select']).toMatchObject({
      agentId: 'claude',
      agentName: 'Claude Code',
      modelId: 'two',
      modelName: 'Model Two',
      effortId: 'low',
      effortName: 'Low',
    });

    const newThreadSent: string[] = [];
    const newThread = buildThread('thread-new-auto', 'channel-select', newThreadSent);
    await messageHandler.handleMessage({
      author: { bot: false, id: 'discord-user-777' },
      channelId: 'channel-select',
      cleanContent: 'Next task in new thread',
      content: '<@bot-e2e-id> Next task in new thread',
      mentions: { has: vi.fn().mockImplementation((user: any) => user?.id === 'bot-e2e-id') },
      channel: { isDMBased: vi.fn().mockReturnValue(false), isThread: vi.fn().mockReturnValue(false) },
      startThread: vi.fn().mockResolvedValue(newThread),
    } as unknown as Message);

    expect(newThreadSent.some(msg => msg.includes('Escolha o agente'))).toBe(false);
    expect(newThreadSent.at(-1)).toBe('Built it.\n-# 🤖 CEO (claude) · 🧠 Model Two · ⚡ Low · 🪙 150 tokens');

    await app.close();
  });

  it('should reopen the model selection through the /model slash command', async () => {
    seedAgentSettings(dataDir, 'channel-model:thread-model');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(IAgentPortFactory)
      .useValue(agentFactory(agentId => new SelectableAgentFake(agentId)))
      .compile();
    const app = moduleFixture.createNestApplication();
    await app.init();

    const interactionHandler = moduleFixture.get<DiscordInteractionHandler>(DiscordInteractionHandler);
    const messageHandler = moduleFixture.get<DiscordMessageHandler>(DiscordMessageHandler);
    (moduleFixture.get<DiscordClientService>(DiscordClientService).getClient() as any).user = {
      id: 'bot-e2e-id',
    };

    const editReply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      isChatInputCommand: vi.fn().mockReturnValue(true),
      commandName: 'model',
      channelId: 'thread-model',
      inGuild: vi.fn().mockReturnValue(true),
      channel: { id: 'thread-model', isDMBased: vi.fn().mockReturnValue(false), isThread: vi.fn().mockReturnValue(true), parentId: 'channel-model' },
      user: { username: 'alice', id: 'discord-user-777' },
      deferred: false,
      replied: false,
      deferReply: vi.fn(async () => {
        interaction.deferred = true;
      }),
      editReply,
    };
    await interactionHandler.handleInteraction(interaction as unknown as ChatInputCommandInteraction);

    expect(editReply).toHaveBeenCalledWith({
      content: '🧠 **Escolha o modelo do Antigravity** respondendo com o número da opção:\n**1.** Model One\n**2.** Model Two',
    });

    const sent: string[] = [];
    await messageHandler.handleMessage(threadReply(buildThread('thread-model', 'channel-model', sent), '1'));

    expect(sent).toEqual(['✅ **Configuração salva**: 🤖 Antigravity · 🧠 Model One · ⚡ padrão']);
    expect(JSON.parse(readFileSync(join(dataDir, 'agent-settings.json'), 'utf-8'))['channel-model:thread-model'].modelId).toBe('one');

    await app.close();
  });

  it('should open the /model selection of a guild channel in a thread answered without mention', async () => {
    seedAgentSettings(dataDir, 'channel-general:thread-selection');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(IAgentPortFactory)
      .useValue(agentFactory(agentId => new SelectableAgentFake(agentId)))
      .compile();
    const app = moduleFixture.createNestApplication();
    await app.init();

    const interactionHandler = moduleFixture.get<DiscordInteractionHandler>(DiscordInteractionHandler);
    const messageHandler = moduleFixture.get<DiscordMessageHandler>(DiscordMessageHandler);
    (moduleFixture.get<DiscordClientService>(DiscordClientService).getClient() as any).user = {
      id: 'bot-e2e-id',
    };

    const sent: string[] = [];
    const selectionThread = buildThread('thread-selection', 'channel-general', sent);
    const interaction = {
      isChatInputCommand: vi.fn().mockReturnValue(true),
      commandName: 'model',
      channelId: 'channel-general',
      inGuild: vi.fn().mockReturnValue(true),
      channel: { id: 'channel-general', isDMBased: vi.fn().mockReturnValue(false), isThread: vi.fn().mockReturnValue(false) },
      user: { username: 'alice', id: 'discord-user-777' },
      deferred: false,
      replied: false,
      deferReply: vi.fn(async () => {
        interaction.deferred = true;
      }),
      editReply: vi.fn().mockResolvedValue({ startThread: vi.fn().mockResolvedValue(selectionThread) }),
    };
    await interactionHandler.handleInteraction(interaction as unknown as ChatInputCommandInteraction);

    expect(sent).toEqual(['🧠 **Escolha o modelo do Antigravity** respondendo com o número da opção:\n**1.** Model One\n**2.** Model Two']);

    const channelChatter = {
      author: { bot: false, id: 'discord-user-888' },
      channelId: 'channel-general',
      cleanContent: 'lunch?',
      content: 'lunch?',
      mentions: { has: vi.fn().mockReturnValue(false) },
      channel: { isDMBased: vi.fn().mockReturnValue(false), isThread: vi.fn().mockReturnValue(false), send: vi.fn() },
      startThread: vi.fn(),
    } as unknown as Message;
    await messageHandler.handleMessage(channelChatter);
    expect(channelChatter.startThread).not.toHaveBeenCalled();

    await messageHandler.handleMessage(threadReply(selectionThread, '1'));

    expect(sent.at(-1)).toBe('✅ **Configuração salva**: 🤖 Antigravity · 🧠 Model One · ⚡ padrão');
    expect(JSON.parse(readFileSync(join(dataDir, 'agent-settings.json'), 'utf-8'))['channel-general:thread-selection'].modelId).toBe('one');

    await app.close();
  });

  it('should switch the agent through the /agent slash command in a bot-owned thread', async () => {
    seedAgentSettings(dataDir, 'channel-general:thread-agent');
    const createdAgentIds: string[] = [];
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(IAgentPortFactory)
      .useValue(agentFactory((agentId) => {
        createdAgentIds.push(agentId);
        return new SelectableAgentFake(agentId);
      }))
      .compile();
    const app = moduleFixture.createNestApplication();
    await app.init();

    const interactionHandler = moduleFixture.get<DiscordInteractionHandler>(DiscordInteractionHandler);
    const messageHandler = moduleFixture.get<DiscordMessageHandler>(DiscordMessageHandler);
    (moduleFixture.get<DiscordClientService>(DiscordClientService).getClient() as any).user = {
      id: 'bot-e2e-id',
    };

    const sent: string[] = [];
    const selectionThread = buildThread('thread-agent', 'channel-general', sent);
    const startThread = vi.fn().mockResolvedValue(selectionThread);
    const interaction = {
      isChatInputCommand: vi.fn().mockReturnValue(true),
      commandName: 'agent',
      channelId: 'channel-general',
      inGuild: vi.fn().mockReturnValue(true),
      channel: { id: 'channel-general', isDMBased: vi.fn().mockReturnValue(false), isThread: vi.fn().mockReturnValue(false) },
      user: { username: 'alice', id: 'discord-user-777' },
      deferred: false,
      replied: false,
      deferReply: vi.fn(async () => {
        interaction.deferred = true;
      }),
      editReply: vi.fn().mockResolvedValue({ startThread }),
    };
    await interactionHandler.handleInteraction(interaction as unknown as ChatInputCommandInteraction);

    expect(interaction.editReply).toHaveBeenCalledWith({ content: '🧵 Escolha o agente na thread abaixo.' });
    expect(startThread).toHaveBeenCalledWith({ name: 'Seleção de agente', autoArchiveDuration: 60 });
    expect(sent).toEqual(['🤖 **Escolha o agente** respondendo com o número da opção:\n**1.** Antigravity\n**2.** Claude Code']);

    await messageHandler.handleMessage(threadReply(selectionThread, '2'));
    expect(sent.at(-1)).toBe(
      '🧠 **Escolha o modelo do Claude Code** respondendo com o número da opção:\n**1.** Model One\n**2.** Model Two',
    );

    await messageHandler.handleMessage(threadReply(selectionThread, '1'));

    expect(sent.at(-1)).toBe('✅ **Configuração salva**: 🤖 Claude Code · 🧠 Model One · ⚡ padrão');
    expect(createdAgentIds).toContain('claude');
    expect(JSON.parse(readFileSync(join(dataDir, 'agent-settings.json'), 'utf-8'))['channel-general:thread-agent']).toMatchObject({
      agentId: 'claude',
      agentName: 'Claude Code',
      modelId: 'one',
    });

    await app.close();
  });

  describe('questions to the user', () => {
    const startApp = async (agents: Partial<IAgentPort>[]) => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IAgentPortFactory)
        .useValue(agentFactory(() => agents.shift()))
        .compile();
      const app = moduleFixture.createNestApplication();
      await app.init();
      (moduleFixture.get<DiscordClientService>(DiscordClientService).getClient() as any).user = { id: 'bot-e2e-id' };
      return { app, moduleFixture, messageHandler: moduleFixture.get<DiscordMessageHandler>(DiscordMessageHandler) };
    };

    const botThread = (threadMessages: string[]) => ({
      id: 'thread-questions',
      parentId: 'channel-questions',
      ownerId: 'bot-e2e-id',
      isDMBased: vi.fn().mockReturnValue(false),
      isThread: vi.fn().mockReturnValue(true),
      send: vi.fn().mockImplementation(async (content: string) => {
        threadMessages.push(content);
        return { edit: vi.fn().mockResolvedValue(undefined) };
      }),
    });

    const threadMessage = (thread: ReturnType<typeof botThread>, content: string) => ({
      author: { bot: false, id: 'discord-user-777' },
      channelId: 'thread-questions',
      cleanContent: content,
      content,
      mentions: { has: vi.fn().mockReturnValue(false) },
      channel: thread,
    }) as unknown as Message;

    it('should let the delegated agent interview the user one question at a time without the CEO', async () => {
      seedAgentSettings(dataDir, 'channel-questions:thread-questions');
      const ceo = new ScriptedAgentFake([
        '<delegate role="PRODUCT_OWNER">Discover the refund approval feature.</delegate>',
        'The intent document is ready.',
      ]);
      const owner = new ScriptedAgentFake([
        'I understood refunds need approval.\n<question rationale="It defines the flow.">Who approves a refund?<option>The manager</option><option>Finance</option></question>\n<question>What is the maximum amount?</question>',
        'Document at /tmp/agent-remote-control/intents/refunds.md',
      ]);
      const { app, messageHandler } = await startApp([ceo, owner]);
      const threadMessages: string[] = [];
      const thread = botThread(threadMessages);

      const turn = messageHandler.handleMessage(threadMessage(thread, 'I want refund approvals'));
      await vi.waitFor(() => {
        expect(threadMessages.some(content => content.includes('❓ **Pergunta 1/2** · Product Owner Agent'))).toBe(true);
      });
      await messageHandler.handleMessage(threadMessage(thread, '7'));
      await messageHandler.handleMessage(threadMessage(thread, '2'));
      await messageHandler.handleMessage(threadMessage(thread, 'R$ 500'));
      await turn;

      expect(threadMessages.find(content => content.includes('Pergunta 1/2'))).toMatch(/^I understood refunds need approval\.\n\n❓/);
      expect(threadMessages.some(content => content.startsWith('⚠️ Opção inválida'))).toBe(true);
      expect(threadMessages.some(content => content.includes('❓ **Pergunta 2/2**'))).toBe(true);
      expect(threadMessages).toContain('✅ Respostas enviadas ao **Product Owner Agent**.');
      expect(owner.prompts[0]).toContain('Product Owner Agent');
      expect(owner.prompts[1]).toContain('<answer question="Who approves a refund?" option="2">Finance</answer>');
      expect(owner.prompts[1]).toContain('<answer question="What is the maximum amount?" kind="other">R$ 500</answer>');
      expect(ceo.prompts).toHaveLength(2);
      expect(ceo.prompts[1]).toContain('<agent_result role="PRODUCT_OWNER">\nDocument at /tmp/agent-remote-control/intents/refunds.md\n</agent_result>');
      expect(threadMessages).toContain(`The intent document is ready.\n${FOOTER}`);

      await app.close();
    });

    it('should cancel everything and unlock the conversation through /cancel while a question waits', async () => {
      seedAgentSettings(dataDir, 'channel-questions:thread-questions');
      const ceo = new ScriptedAgentFake(['<question>Which project?<option>Backend</option></question>', 'Hello again.']);
      const { app, moduleFixture, messageHandler } = await startApp([ceo]);
      const threadMessages: string[] = [];
      const thread = botThread(threadMessages);

      const turn = messageHandler.handleMessage(threadMessage(thread, 'Plan something'));
      await vi.waitFor(() => {
        expect(threadMessages.some(content => content.includes('❓ **Pergunta 1/1** · CEO'))).toBe(true);
      });
      const reply = vi.fn().mockResolvedValue(undefined);
      await moduleFixture.get<DiscordInteractionHandler>(DiscordInteractionHandler).handleInteraction({
        isChatInputCommand: vi.fn().mockReturnValue(true),
        commandName: 'cancel',
        channelId: 'thread-questions',
        inGuild: vi.fn().mockReturnValue(true),
        channel: { id: 'thread-questions', isThread: vi.fn().mockReturnValue(true), parentId: 'channel-questions' },
        deferred: false,
        replied: false,
        reply,
        followUp: vi.fn().mockResolvedValue(undefined),
      } as unknown as ChatInputCommandInteraction);
      await turn;

      expect(reply).toHaveBeenCalledWith({ content: '🛑 **Cancelamento solicitado.** O turno ativo será interrompido.', ephemeral: true });
      expect(threadMessages.some(content => content.startsWith('⚠️ **Turno cancelado pelo usuário.**'))).toBe(true);

      await messageHandler.handleMessage(threadMessage(thread, 'Hi'));

      expect(ceo.prompts.at(-1)).toContain('Hi');
      expect(threadMessages.some(content => content.startsWith('Hello again.'))).toBe(true);

      await app.close();
    });
  });
});
