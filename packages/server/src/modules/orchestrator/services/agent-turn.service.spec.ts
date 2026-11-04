import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TurnRequest } from '../models/turn-request.model.js';
import type { TurnResult } from '../models/turn-result.model.js';
import type { CancelAgentTurnUseCase } from '../use-cases/cancel-agent-turn.use-case.js';
import type { ExecuteAgentTurnUseCase } from '../use-cases/execute-agent-turn.use-case.js';
import type { GetAgentQuotaUseCase } from '../use-cases/get-agent-quota.use-case.js';
import type { RunShellCommandUseCase } from '../use-cases/run-shell-command.use-case.js';
import type { TranscribeAudioAttachmentsUseCase } from '../use-cases/transcribe-audio-attachments.use-case.js';

import { AgentTurnService } from './agent-turn.service.js';


describe('AgentTurnService', () => {
  let service: AgentTurnService;
  let execute: ExecuteAgentTurnUseCase;
  let cancel: CancelAgentTurnUseCase;
  let transcribe: TranscribeAudioAttachmentsUseCase;
  let runShell: RunShellCommandUseCase;
  let getQuota: GetAgentQuotaUseCase;

  beforeEach(() => {
    execute = { execute: vi.fn() } as unknown as ExecuteAgentTurnUseCase;
    cancel = { execute: vi.fn() } as unknown as CancelAgentTurnUseCase;
    transcribe = { execute: vi.fn() } as unknown as TranscribeAudioAttachmentsUseCase;
    runShell = {
      isEnabled: vi.fn().mockReturnValue(true),
      execute: vi.fn().mockResolvedValue({ exitCode: 0 }),
    } as unknown as RunShellCommandUseCase;
    getQuota = { execute: vi.fn() } as unknown as GetAgentQuotaUseCase;
    service = new AgentTurnService(execute, cancel, transcribe, runShell, getQuota);
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

  it('should delegate transcribeAudio to TranscribeAudioAttachmentsUseCase', async () => {
    const result = { prompt: 'hi', attachments: [], transcripts: [], warnings: [] };
    vi.mocked(transcribe.execute).mockResolvedValue(result);

    await expect(service.transcribeAudio({ prompt: 'hi' })).resolves.toBe(result);
    expect(transcribe.execute).toHaveBeenCalledWith({ prompt: 'hi' });
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
