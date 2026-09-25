import { Module } from '@nestjs/common';

import { AgentModule } from '../agent/agent.module.js';
import { AgentDefinitionsModule } from '../agent-definitions/agent-definitions.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';

import { InMemorySessionStoreAdapter } from './adapters/in-memory-session-store.adapter.js';
import { ISessionStorePort } from './ports/session-store.port.js';
import { DelegationDetectorService } from './services/delegation-detector.service.js';
import { OrchestratorService } from './services/orchestrator.service.js';
import { CancelAgentTurnUseCase } from './use-cases/cancel-agent-turn.use-case.js';
import { ExecuteAgentTurnUseCase } from './use-cases/execute-agent-turn.use-case.js';


@Module({
  imports: [AgentModule, AgentDefinitionsModule, WorkspaceModule],
  providers: [
    {
      provide: ISessionStorePort,
      useClass: InMemorySessionStoreAdapter,
    },
    DelegationDetectorService,
    ExecuteAgentTurnUseCase,
    CancelAgentTurnUseCase,
    OrchestratorService,
  ],
  exports: [
    OrchestratorService,
    ExecuteAgentTurnUseCase,
    CancelAgentTurnUseCase,
    ISessionStorePort,
  ],
})
export class OrchestratorModule {}
