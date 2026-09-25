import { Injectable } from '@nestjs/common';
import type { TurnRequest } from '../models/turn-request.model.js';
import type { TurnResult } from '../models/turn-result.model.js';
import { CancelAgentTurnUseCase } from '../use-cases/cancel-agent-turn.use-case.js';
import { ExecuteAgentTurnUseCase } from '../use-cases/execute-agent-turn.use-case.js';

@Injectable()
export class OrchestratorService {
  constructor(
    private readonly executeAgentTurnUseCase: ExecuteAgentTurnUseCase,
    private readonly cancelAgentTurnUseCase: CancelAgentTurnUseCase,
  ) {}

  async executeTurn(request: TurnRequest): Promise<TurnResult> {
    return this.executeAgentTurnUseCase.execute(request);
  }

  async cancelTurn(channelId: string, threadId?: string): Promise<void> {
    return this.cancelAgentTurnUseCase.execute(channelId, threadId);
  }
}
