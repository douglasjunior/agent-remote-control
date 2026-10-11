import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryAgentConfigSelectionStoreAdapter } from '../adapters/in-memory-agent-config-selection-store.adapter.js';
import type { TurnRequest } from '../models/turn-request.model.js';
import type { TurnResult } from '../models/turn-result.model.js';
import type { CancelAgentConfigSelectionUseCase } from '../use-cases/cancel-agent-config-selection.use-case.js';
import type { CancelAgentTurnUseCase } from '../use-cases/cancel-agent-turn.use-case.js';
import type { ExecuteAgentTurnUseCase } from '../use-cases/execute-agent-turn.use-case.js';
import type { GetAgentQuotaUseCase } from '../use-cases/get-agent-quota.use-case.js';
import type { ResolveConversationInputUseCase } from '../use-cases/resolve-conversation-input.use-case.js';
import type { StartAgentConfigSelectionUseCase } from '../use-cases/start-agent-config-selection.use-case.js';

import { OrchestratorService } from './orchestrator.service.js';


describe('OrchestratorService', () => {
  let service: OrchestratorService;
  let mockExecuteUseCase: ExecuteAgentTurnUseCase;
  let mockCancelUseCase: CancelAgentTurnUseCase;
  let mockResolveUseCase: ResolveConversationInputUseCase;
  let mockStartSelectionUseCase: StartAgentConfigSelectionUseCase;
  let mockCancelSelectionUseCase: CancelAgentConfigSelectionUseCase;
  let selectionStore: InMemoryAgentConfigSelectionStoreAdapter;
  let mockGetQuotaUseCase: GetAgentQuotaUseCase;

  beforeEach(() => {
    mockExecuteUseCase = {
      execute: vi.fn(),
    } as unknown as ExecuteAgentTurnUseCase;

    mockCancelUseCase = {
      execute: vi.fn(),
    } as unknown as CancelAgentTurnUseCase;

    mockResolveUseCase = { execute: vi.fn() } as unknown as ResolveConversationInputUseCase;
    mockStartSelectionUseCase = { execute: vi.fn() } as unknown as StartAgentConfigSelectionUseCase;
    mockCancelSelectionUseCase = { execute: vi.fn() } as unknown as CancelAgentConfigSelectionUseCase;
    selectionStore = new InMemoryAgentConfigSelectionStoreAdapter();
    mockGetQuotaUseCase = { execute: vi.fn() } as unknown as GetAgentQuotaUseCase;

    service = new OrchestratorService(
      mockExecuteUseCase,
      mockCancelUseCase,
      mockResolveUseCase,
      mockStartSelectionUseCase,
      mockCancelSelectionUseCase,
      selectionStore,
      mockGetQuotaUseCase,
    );
  });

  it('should delegate getQuota to GetAgentQuotaUseCase', async () => {
    const report = { agent: { id: 'a', name: 'A' }, quota: undefined };
    vi.mocked(mockGetQuotaUseCase.execute).mockResolvedValue(report);

    expect(await service.getQuota('conv-th-1')).toBe(report);
    expect(mockGetQuotaUseCase.execute).toHaveBeenCalledWith('conv-th-1');
  });

  it('should delegate executeTurn to ExecuteAgentTurnUseCase', async () => {
    const request: TurnRequest = {
      conversationId: 'conv-1',
      userId: 'user-1',
      prompt: 'Test prompt',
      workspacePath: '/repo/workspace',
      agentRole: 'CEO',
    };

    const expectedResult: TurnResult = {
      sessionId: 'sess-1',
      response: 'Ok',
      status: 'completed',
    };

    vi.mocked(mockExecuteUseCase.execute).mockResolvedValue(expectedResult);

    const result = await service.executeTurn(request);

    expect(result).toEqual(expectedResult);
    expect(mockExecuteUseCase.execute).toHaveBeenCalledWith(request);
  });

  it('should delegate cancelTurn to CancelAgentTurnUseCase', async () => {
    vi.mocked(mockCancelUseCase.execute).mockResolvedValue(true);

    await expect(service.cancelTurn('conv-th-1')).resolves.toBe(true);
    expect(mockCancelUseCase.execute).toHaveBeenCalledWith('conv-th-1');
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
    expect(mockStartSelectionUseCase.execute).toHaveBeenCalledWith({
      conversationId: 'conv-th-1',
      step: 'model',
    });
    expect(mockCancelSelectionUseCase.execute).toHaveBeenCalledWith('conv-th-1');
  });

  it('should start the agent selection at the agent step', async () => {
    vi.mocked(mockStartSelectionUseCase.execute).mockResolvedValue({ kind: 'unavailable' });

    await expect(service.startAgentSelection('conv-th-1')).resolves.toEqual({ kind: 'unavailable' });
    expect(mockStartSelectionUseCase.execute).toHaveBeenCalledWith({
      conversationId: 'conv-th-1',
      step: 'agent',
    });
  });

  it('should report whether a configuration selection is active', async () => {
    await expect(service.hasActiveConfigSelection('conv-1')).resolves.toBe(false);

    await selectionStore.save({ conversationId: 'conv-1', step: 'model', options: [] });

    await expect(service.hasActiveConfigSelection('conv-1')).resolves.toBe(true);
  });
});
