import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StubAgentConfigurationPort } from '../../orchestrator/testing/stub-agent-configuration.port.js';
import { InMemoryAgentConfigSelectionStoreAdapter } from '../adapters/in-memory-agent-config-selection-store.adapter.js';
import type { CancelAgentConfigSelectionUseCase } from '../use-cases/cancel-agent-config-selection.use-case.js';
import type { ResolveConversationInputUseCase } from '../use-cases/resolve-conversation-input.use-case.js';
import type { StartAgentConfigSelectionUseCase } from '../use-cases/start-agent-config-selection.use-case.js';

import { DiscordConversationService } from './discord-conversation.service.js';
import { LanguageChangeRequestService } from './language-change-request.service.js';


describe('DiscordConversationService', () => {
  let service: DiscordConversationService;
  let mockResolveUseCase: ResolveConversationInputUseCase;
  let mockStartSelectionUseCase: StartAgentConfigSelectionUseCase;
  let mockCancelSelectionUseCase: CancelAgentConfigSelectionUseCase;
  let selectionStore: InMemoryAgentConfigSelectionStoreAdapter;
  let configuration: StubAgentConfigurationPort;

  beforeEach(() => {
    mockResolveUseCase = { execute: vi.fn() } as unknown as ResolveConversationInputUseCase;
    mockStartSelectionUseCase = { execute: vi.fn() } as unknown as StartAgentConfigSelectionUseCase;
    mockCancelSelectionUseCase = { execute: vi.fn() } as unknown as CancelAgentConfigSelectionUseCase;
    selectionStore = new InMemoryAgentConfigSelectionStoreAdapter();
    configuration = new StubAgentConfigurationPort();

    service = new DiscordConversationService(
      mockResolveUseCase,
      mockStartSelectionUseCase,
      mockCancelSelectionUseCase,
      selectionStore,
      new LanguageChangeRequestService(),
      configuration,
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
});
