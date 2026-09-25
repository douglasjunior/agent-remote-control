import { Module } from '@nestjs/common';

import { AgentModule } from '../agent/agent.module.js';
import { AgentDefinitionsModule } from '../agent-definitions/agent-definitions.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';

import { InMemoryAgentConfigSelectionStoreAdapter } from './adapters/in-memory-agent-config-selection-store.adapter.js';
import { JsonAgentSettingsStoreAdapter } from './adapters/json-agent-settings-store.adapter.js';
import { JsonSessionStoreAdapter } from './adapters/json-session-store.adapter.js';
import { IAgentConfigSelectionStorePort } from './ports/agent-config-selection-store.port.js';
import { IAgentSettingsStorePort } from './ports/agent-settings-store.port.js';
import { ISessionStorePort } from './ports/session-store.port.js';
import { AgentCapabilitiesService } from './services/agent-capabilities.service.js';
import { ConversationRuntimeService } from './services/conversation-runtime.service.js';
import { DelegationDetectorService } from './services/delegation-detector.service.js';
import { OrchestratorService } from './services/orchestrator.service.js';
import { CancelAgentConfigSelectionUseCase } from './use-cases/cancel-agent-config-selection.use-case.js';
import { CancelAgentTurnUseCase } from './use-cases/cancel-agent-turn.use-case.js';
import { ExecuteAgentTurnUseCase } from './use-cases/execute-agent-turn.use-case.js';
import { ResolveConversationInputUseCase } from './use-cases/resolve-conversation-input.use-case.js';
import { StartAgentConfigSelectionUseCase } from './use-cases/start-agent-config-selection.use-case.js';
import { SubmitAgentConfigSelectionUseCase } from './use-cases/submit-agent-config-selection.use-case.js';


@Module({
  imports: [AgentModule, AgentDefinitionsModule, WorkspaceModule],
  providers: [
    {
      provide: ISessionStorePort,
      useClass: JsonSessionStoreAdapter,
    },
    {
      provide: IAgentSettingsStorePort,
      useClass: JsonAgentSettingsStoreAdapter,
    },
    {
      provide: IAgentConfigSelectionStorePort,
      useClass: InMemoryAgentConfigSelectionStoreAdapter,
    },
    AgentCapabilitiesService,
    ConversationRuntimeService,
    DelegationDetectorService,
    ExecuteAgentTurnUseCase,
    CancelAgentTurnUseCase,
    StartAgentConfigSelectionUseCase,
    SubmitAgentConfigSelectionUseCase,
    ResolveConversationInputUseCase,
    CancelAgentConfigSelectionUseCase,
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
