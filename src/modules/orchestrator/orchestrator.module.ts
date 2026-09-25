import { Module } from '@nestjs/common';

import { AgentModule } from '../agent/agent.module.js';

import { DefaultAgentRegistryAdapter } from './adapters/default-agent-registry.adapter.js';
import { InMemorySessionStoreAdapter } from './adapters/in-memory-session-store.adapter.js';
import { IAgentRegistryPort } from './ports/agent-registry.port.js';
import { ISessionStorePort } from './ports/session-store.port.js';
import { OrchestratorService } from './services/orchestrator.service.js';
import { CancelAgentTurnUseCase } from './use-cases/cancel-agent-turn.use-case.js';
import { ExecuteAgentTurnUseCase } from './use-cases/execute-agent-turn.use-case.js';


@Module({
  imports: [AgentModule],
  providers: [
    {
      provide: ISessionStorePort,
      useClass: InMemorySessionStoreAdapter,
    },
    {
      provide: IAgentRegistryPort,
      useClass: DefaultAgentRegistryAdapter,
    },
    ExecuteAgentTurnUseCase,
    CancelAgentTurnUseCase,
    OrchestratorService,
  ],
  exports: [
    OrchestratorService,
    ExecuteAgentTurnUseCase,
    CancelAgentTurnUseCase,
    ISessionStorePort,
    IAgentRegistryPort,
  ],
})
export class OrchestratorModule {}
