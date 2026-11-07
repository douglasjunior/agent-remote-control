import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StubAgentAuthPort } from '../../agent/testing/stub-agent-auth.port.js';
import { StubAgentConfigurationPort } from '../../orchestrator/testing/stub-agent-configuration.port.js';
import { InMemoryAgentConfigSelectionStoreAdapter } from '../adapters/in-memory-agent-config-selection-store.adapter.js';
import { DiscordActivityFormatter } from '../formatters/discord-activity.formatter.js';
import type { CancelAgentConfigSelectionUseCase } from '../use-cases/cancel-agent-config-selection.use-case.js';
import type { ResolveConversationInputUseCase } from '../use-cases/resolve-conversation-input.use-case.js';
import type { StartAgentConfigSelectionUseCase } from '../use-cases/start-agent-config-selection.use-case.js';

import { AgentAuthRequestService } from './agent-auth-request.service.js';
import { DiscordAgentAuthNotifierService } from './discord-agent-auth-notifier.service.js';
import { DiscordConversationService } from './discord-conversation.service.js';
import { LanguageChangeRequestService } from './language-change-request.service.js';


describe('DiscordConversationService', () => {
  let service: DiscordConversationService;
  let mockResolveUseCase: ResolveConversationInputUseCase;
  let mockStartSelectionUseCase: StartAgentConfigSelectionUseCase;
  let mockCancelSelectionUseCase: CancelAgentConfigSelectionUseCase;
  let selectionStore: InMemoryAgentConfigSelectionStoreAdapter;
  let configuration: StubAgentConfigurationPort;
  let agentAuth: StubAgentAuthPort;
  let agentAuthRequests: AgentAuthRequestService;

  beforeEach(() => {
    mockResolveUseCase = { execute: vi.fn() } as unknown as ResolveConversationInputUseCase;
    mockStartSelectionUseCase = { execute: vi.fn() } as unknown as StartAgentConfigSelectionUseCase;
    mockCancelSelectionUseCase = { execute: vi.fn() } as unknown as CancelAgentConfigSelectionUseCase;
    selectionStore = new InMemoryAgentConfigSelectionStoreAdapter();
    configuration = new StubAgentConfigurationPort();
    agentAuth = new StubAgentAuthPort();
    agentAuthRequests = new AgentAuthRequestService();

    service = new DiscordConversationService(
      mockResolveUseCase,
      mockStartSelectionUseCase,
      mockCancelSelectionUseCase,
      selectionStore,
      new LanguageChangeRequestService(),
      configuration,
      agentAuth,
      agentAuthRequests,
      new DiscordAgentAuthNotifierService(agentAuth, agentAuthRequests, new DiscordActivityFormatter()),
    );
  });

  it('should request a language change and report English while no language is stored', async () => {
    await expect(service.requestLanguageChange('conv-1')).resolves.toBe('English');

    expect(service.hasPendingLanguageChange('conv-1')).toBe(true);
    expect(service.cancelLanguageChange('conv-1')).toBe(true);
    expect(service.hasPendingLanguageChange('conv-1')).toBe(false);
  });

  it('should report the stored language when a change is requested', async () => {
    configuration.language = 'Spanish';

    await expect(service.requestLanguageChange('conv-1')).resolves.toBe('Spanish');
  });

  it('should delegate resolveInput to ResolveConversationInputUseCase', async () => {
    vi.mocked(mockResolveUseCase.execute).mockResolvedValue({ kind: 'execute', prompt: 'hi' });

    await expect(service.resolveInput({ conversationId: 'conv-1', prompt: 'hi' })).resolves.toEqual({
      kind: 'execute',
      prompt: 'hi',
    });
  });

  it('should start and cancel configuration selections through their use cases', async () => {
    vi.mocked(mockStartSelectionUseCase.execute).mockResolvedValue({ kind: 'unavailable' });
    vi.mocked(mockCancelSelectionUseCase.execute).mockResolvedValue(true);

    await expect(service.startConfigSelection('conv-th-1')).resolves.toEqual({ kind: 'unavailable' });
    await expect(service.cancelConfigSelection('conv-th-1')).resolves.toBe(true);
    expect(mockStartSelectionUseCase.execute).toHaveBeenCalledWith({ conversationId: 'conv-th-1', step: 'model' });
    expect(mockCancelSelectionUseCase.execute).toHaveBeenCalledWith('conv-th-1');
  });

  it('should start the agent selection at the agent step', async () => {
    vi.mocked(mockStartSelectionUseCase.execute).mockResolvedValue({ kind: 'unavailable' });

    await expect(service.startAgentSelection('conv-th-1')).resolves.toEqual({ kind: 'unavailable' });
    expect(mockStartSelectionUseCase.execute).toHaveBeenCalledWith({ conversationId: 'conv-th-1', step: 'agent' });
  });

  it('should start the profiles selection at the profile step', async () => {
    vi.mocked(mockStartSelectionUseCase.execute).mockResolvedValue({ kind: 'unavailable' });

    await expect(service.startProfilesSelection('conv-th-1')).resolves.toEqual({ kind: 'unavailable' });
    expect(mockStartSelectionUseCase.execute).toHaveBeenCalledWith({ conversationId: 'conv-th-1', step: 'profile' });
  });

  it('should report whether a configuration selection is active', async () => {
    await expect(service.hasActiveConfigSelection('conv-1')).resolves.toBe(false);

    await selectionStore.save({ conversationId: 'conv-1', step: 'model', options: [] });

    await expect(service.hasActiveConfigSelection('conv-1')).resolves.toBe(true);
  });

  describe('agent login', () => {
    it('should offer the agents with a CLI login, numbered from 1, and wait for the pick', async () => {
      agentAuth.infos = [
        { agentId: 'claude', displayName: 'Claude Code', status: 'authenticated', detail: 'me@example.com' },
        { agentId: 'codex', displayName: 'OpenAI Codex', status: 'unauthenticated' },
      ];

      await expect(service.startAgentAuthSelection('conv-1')).resolves.toEqual({
        kind: 'menu',
        entries: [
          { index: 1, agentId: 'claude', displayName: 'Claude Code', status: 'authenticated', detail: 'me@example.com' },
          { index: 2, agentId: 'codex', displayName: 'OpenAI Codex', status: 'unauthenticated' },
        ],
      });

      expect(service.hasPendingAgentAuth('conv-1')).toBe(true);
      expect(agentAuthRequests.pendingPick('conv-1')).toEqual([
        { agentId: 'claude', displayName: 'Claude Code' },
        { agentId: 'codex', displayName: 'OpenAI Codex' },
      ]);
    });

    it('should report no agents to log in when none has a CLI login', async () => {
      await expect(service.startAgentAuthSelection('conv-1')).resolves.toEqual({ kind: 'unavailable' });

      expect(service.hasPendingAgentAuth('conv-1')).toBe(false);
    });

    it('should treat a login that waits for a code as pending', () => {
      agentAuthRequests.startLogin('conv-1', 'claude');
      expect(service.hasPendingAgentAuth('conv-1')).toBe(false);

      agentAuthRequests.awaitCode('conv-1');

      expect(service.hasPendingAgentAuth('conv-1')).toBe(true);
    });

    it('should start a login through the notifier', async () => {
      const sent: string[] = [];

      await service.startAgentLogin('conv-1', { agentId: 'claude', displayName: 'Claude Code' }, {
        send: async (content) => {
          sent.push(content);
        },
      });

      expect(agentAuth.started).toEqual(['claude']);
      expect(sent).toEqual(['⏳ Starting the **Claude Code** login...']);
    });

    it('should cancel a pending pick', () => {
      agentAuthRequests.requestPick('conv-1', [{ agentId: 'claude', displayName: 'Claude Code' }]);

      expect(service.cancelAgentAuth('conv-1')).toBe(true);
      expect(service.hasPendingAgentAuth('conv-1')).toBe(false);
      expect(service.cancelAgentAuth('conv-1')).toBe(false);
    });

    it('should cancel a running login', () => {
      agentAuthRequests.startLogin('conv-1', 'claude');

      expect(service.cancelAgentAuth('conv-1')).toBe(true);
      expect(agentAuth.cancelled).toEqual(['claude']);
    });
  });
});
