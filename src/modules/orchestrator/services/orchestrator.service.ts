import { Inject, Injectable } from '@nestjs/common';

import type {
  ConversationInputResolution,
  StartAgentConfigSelectionResult,
} from '../models/agent-config-outcome.model.js';
import type { TurnRequest } from '../models/turn-request.model.js';
import type { TurnResult } from '../models/turn-result.model.js';
import { IAgentConfigSelectionStorePort } from '../ports/agent-config-selection-store.port.js';
import { CancelAgentConfigSelectionUseCase } from '../use-cases/cancel-agent-config-selection.use-case.js';
import { CancelAgentTurnUseCase } from '../use-cases/cancel-agent-turn.use-case.js';
import { ExecuteAgentTurnUseCase } from '../use-cases/execute-agent-turn.use-case.js';
import {
  type ResolveConversationInputInput,
  ResolveConversationInputUseCase,
} from '../use-cases/resolve-conversation-input.use-case.js';
import { StartAgentConfigSelectionUseCase } from '../use-cases/start-agent-config-selection.use-case.js';


@Injectable()
export class OrchestratorService {
  constructor(
    private readonly executeAgentTurnUseCase: ExecuteAgentTurnUseCase,
    private readonly cancelAgentTurnUseCase: CancelAgentTurnUseCase,
    private readonly resolveConversationInputUseCase: ResolveConversationInputUseCase,
    private readonly startAgentConfigSelectionUseCase: StartAgentConfigSelectionUseCase,
    private readonly cancelAgentConfigSelectionUseCase: CancelAgentConfigSelectionUseCase,
    @Inject(IAgentConfigSelectionStorePort)
    private readonly selectionStore: IAgentConfigSelectionStorePort,
  ) {}

  async executeTurn(request: TurnRequest): Promise<TurnResult> {
    return this.executeAgentTurnUseCase.execute(request);
  }

  async cancelTurn(channelId: string, threadId?: string): Promise<boolean> {
    return this.cancelAgentTurnUseCase.execute(channelId, threadId);
  }

  resolveInput(input: ResolveConversationInputInput): Promise<ConversationInputResolution> {
    return this.resolveConversationInputUseCase.execute(input);
  }

  startConfigSelection(channelId: string, threadId?: string): Promise<StartAgentConfigSelectionResult> {
    return this.startAgentConfigSelectionUseCase.execute({ channelId, threadId, step: 'model' });
  }

  startAgentSelection(channelId: string, threadId?: string): Promise<StartAgentConfigSelectionResult> {
    return this.startAgentConfigSelectionUseCase.execute({ channelId, threadId, step: 'agent' });
  }

  cancelConfigSelection(channelId: string, threadId?: string): Promise<boolean> {
    return this.cancelAgentConfigSelectionUseCase.execute(channelId, threadId);
  }

  async hasActiveConfigSelection(channelId: string, threadId?: string): Promise<boolean> {
    return (await this.selectionStore.find(channelId, threadId)) !== null;
  }
}
