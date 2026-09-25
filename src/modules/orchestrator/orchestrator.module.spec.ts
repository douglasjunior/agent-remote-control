import { Test, type TestingModule } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { DefaultAgentRegistryAdapter } from './adapters/default-agent-registry.adapter.js';
import { InMemorySessionStoreAdapter } from './adapters/in-memory-session-store.adapter.js';
import { OrchestratorModule } from './orchestrator.module.js';
import { IAgentRegistryPort } from './ports/agent-registry.port.js';
import { ISessionStorePort } from './ports/session-store.port.js';
import { OrchestratorService } from './services/orchestrator.service.js';
import { CancelAgentTurnUseCase } from './use-cases/cancel-agent-turn.use-case.js';
import { ExecuteAgentTurnUseCase } from './use-cases/execute-agent-turn.use-case.js';


describe('OrchestratorModule', () => {
  it('should compile the module and resolve all orchestrator providers', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [OrchestratorModule],
    }).compile();

    const sessionStore = module.get<ISessionStorePort>(ISessionStorePort);
    const agentRegistry = module.get<IAgentRegistryPort>(IAgentRegistryPort);
    const executeUseCase = module.get<ExecuteAgentTurnUseCase>(
      ExecuteAgentTurnUseCase,
    );
    const cancelUseCase = module.get<CancelAgentTurnUseCase>(
      CancelAgentTurnUseCase,
    );
    const orchestratorService =
      module.get<OrchestratorService>(OrchestratorService);

    expect(sessionStore).toBeInstanceOf(InMemorySessionStoreAdapter);
    expect(agentRegistry).toBeInstanceOf(DefaultAgentRegistryAdapter);
    expect(executeUseCase).toBeInstanceOf(ExecuteAgentTurnUseCase);
    expect(cancelUseCase).toBeInstanceOf(CancelAgentTurnUseCase);
    expect(orchestratorService).toBeInstanceOf(OrchestratorService);
  });
});
