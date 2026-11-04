import { Injectable } from '@nestjs/common';

import type { AgentQuotaReport } from '../models/agent-quota-report.model.js';
import type { ShellCommandResult } from '../models/shell-command-result.model.js';
import type { TurnRequest } from '../models/turn-request.model.js';
import type { TurnResult } from '../models/turn-result.model.js';
import type { IAgentTurnPort } from '../ports/agent-turn.port.js';
import { CancelAgentTurnUseCase } from '../use-cases/cancel-agent-turn.use-case.js';
import { ExecuteAgentTurnUseCase } from '../use-cases/execute-agent-turn.use-case.js';
import { GetAgentQuotaUseCase } from '../use-cases/get-agent-quota.use-case.js';
import { RunShellCommandUseCase } from '../use-cases/run-shell-command.use-case.js';


@Injectable()
export class AgentTurnService implements IAgentTurnPort {
  constructor(
    private readonly executeAgentTurnUseCase: ExecuteAgentTurnUseCase,
    private readonly cancelAgentTurnUseCase: CancelAgentTurnUseCase,
    private readonly runShellCommandUseCase: RunShellCommandUseCase,
    private readonly getAgentQuotaUseCase: GetAgentQuotaUseCase,
  ) {}

  executeTurn(request: TurnRequest): Promise<TurnResult> {
    return this.executeAgentTurnUseCase.execute(request);
  }

  cancelTurn(conversationId: string): Promise<boolean> {
    return this.cancelAgentTurnUseCase.execute(conversationId);
  }

  isShellCommandEnabled(): boolean {
    return this.runShellCommandUseCase.isEnabled();
  }

  runShellCommand(conversationId: string, command: string): Promise<ShellCommandResult> {
    return this.runShellCommandUseCase.execute(conversationId, command);
  }

  getQuota(): Promise<readonly AgentQuotaReport[]> {
    return this.getAgentQuotaUseCase.execute();
  }
}
