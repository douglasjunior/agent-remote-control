import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TurnRequest } from '../models/turn-request.model.js';
import type { TurnResult } from '../models/turn-result.model.js';
import type { CancelAgentTurnUseCase } from '../use-cases/cancel-agent-turn.use-case.js';
import type { ExecuteAgentTurnUseCase } from '../use-cases/execute-agent-turn.use-case.js';

import { OrchestratorService } from './orchestrator.service.js';


describe('OrchestratorService', () => {
  let service: OrchestratorService;
  let mockExecuteUseCase: ExecuteAgentTurnUseCase;
  let mockCancelUseCase: CancelAgentTurnUseCase;

  beforeEach(() => {
    mockExecuteUseCase = {
      execute: vi.fn(),
    } as unknown as ExecuteAgentTurnUseCase;

    mockCancelUseCase = {
      execute: vi.fn(),
    } as unknown as CancelAgentTurnUseCase;

    service = new OrchestratorService(mockExecuteUseCase, mockCancelUseCase);
  });

  it('should delegate executeTurn to ExecuteAgentTurnUseCase', async () => {
    const request: TurnRequest = {
      channelId: 'ch-1',
      userId: 'user-1',
      prompt: 'Test prompt',
      workspacePath: '/repo/workspace',
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
    vi.mocked(mockCancelUseCase.execute).mockResolvedValue(undefined);

    await service.cancelTurn('ch-1', 'th-1');

    expect(mockCancelUseCase.execute).toHaveBeenCalledWith('ch-1', 'th-1');
  });
});
