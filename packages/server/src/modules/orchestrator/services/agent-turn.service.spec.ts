import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TurnRequest } from '../models/turn-request.model.js';
import type { TurnResult } from '../models/turn-result.model.js';
import type { CancelAgentTurnUseCase } from '../use-cases/cancel-agent-turn.use-case.js';
import type { ExecuteAgentTurnUseCase } from '../use-cases/execute-agent-turn.use-case.js';
import type { GetAgentQuotaUseCase } from '../use-cases/get-agent-quota.use-case.js';
import type { RunShellCommandUseCase } from '../use-cases/run-shell-command.use-case.js';

import { AgentTurnService } from './agent-turn.service.js';
import type { OpenWorkService } from './open-work.service.js';


describe('AgentTurnService', () => {
  let openWork: OpenWorkService;
  let service: AgentTurnService;
  let execute: ExecuteAgentTurnUseCase;
  let cancel: CancelAgentTurnUseCase;
  let runShell: RunShellCommandUseCase;
  let getQuota: GetAgentQuotaUseCase;

  beforeEach(() => {
    execute = { execute: vi.fn() } as unknown as ExecuteAgentTurnUseCase;
    cancel = { execute: vi.fn() } as unknown as CancelAgentTurnUseCase;
    runShell = {
      isEnabled: vi.fn().mockReturnValue(true),
      execute: vi.fn().mockResolvedValue({ exitCode: 0 }),
    } as unknown as RunShellCommandUseCase;
    getQuota = { execute: vi.fn() } as unknown as GetAgentQuotaUseCase;
    openWork = { continuable: vi.fn().mockReturnValue([{ id: 'w' }]) } as unknown as OpenWorkService;
    service = new AgentTurnService(execute, cancel, runShell, getQuota, openWork);
  });

  it('should list the interrupted work and resume it', async () => {
    const request = { conversationId: 'c' } as TurnRequest;
    (execute as unknown as { resume: unknown }).resume = vi.fn().mockResolvedValue({ status: 'completed' });
    (execute as unknown as { deliverAnswers: unknown }).deliverAnswers = vi.fn().mockResolvedValue({ status: 'failed' });

    expect(service.listInterruptedWork('c')).toEqual([{ id: 'w' }]);
    await expect(service.resumeWork('w', request)).resolves.toEqual({ status: 'completed' });
    await expect(service.deliverAnswers({ workId: 'w', answers: [] }, request)).resolves.toEqual({ status: 'failed' });
  });

  it('should delegate executeTurn to ExecuteAgentTurnUseCase', async () => {
    const request: TurnRequest = {
      conversationId: 'conv-1',
      userId: 'user-1',
      prompt: 'Test prompt',
      workspacePath: '/repo/workspace',
      agentRole: 'CEO',
    };
    const expectedResult: TurnResult = { response: 'Ok', status: 'completed' };
    vi.mocked(execute.execute).mockResolvedValue(expectedResult);

    await expect(service.executeTurn(request)).resolves.toEqual(expectedResult);
    expect(execute.execute).toHaveBeenCalledWith(request);
  });

  it('should delegate cancelTurn to CancelAgentTurnUseCase', async () => {
    vi.mocked(cancel.execute).mockResolvedValue(true);

    await expect(service.cancelTurn('conv-th-1')).resolves.toBe(true);
    expect(cancel.execute).toHaveBeenCalledWith('conv-th-1');
  });

  it('should delegate the shell command checks and execution to RunShellCommandUseCase', async () => {
    expect(service.isShellCommandEnabled()).toBe(true);

    await service.runShellCommand('conv-1', 'ls');

    expect(runShell.execute).toHaveBeenCalledWith('conv-1', 'ls');
  });

  it('should delegate getQuota to GetAgentQuotaUseCase', async () => {
    const reports = [{ agent: { id: 'a', name: 'A' }, status: 'unsupported' as const }];
    vi.mocked(getQuota.execute).mockResolvedValue(reports);

    expect(await service.getQuota()).toBe(reports);
  });
});
