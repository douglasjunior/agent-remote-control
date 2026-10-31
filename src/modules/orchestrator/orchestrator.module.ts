import { Module } from '@nestjs/common';

import { AgentModule } from '../agent/agent.module.js';
import { AgentDefinitionsModule } from '../agent-definitions/agent-definitions.module.js';
import { SpeechToTextModule } from '../speech-to-text/speech-to-text.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';

import { InMemoryAgentConfigSelectionStoreAdapter } from './adapters/in-memory-agent-config-selection-store.adapter.js';
import { JsonAgentSettingsStoreAdapter } from './adapters/json-agent-settings-store.adapter.js';
import { JsonPreferencesStoreAdapter } from './adapters/json-preferences-store.adapter.js';
import { JsonSessionStoreAdapter } from './adapters/json-session-store.adapter.js';
import { IAgentConfigSelectionStorePort } from './ports/agent-config-selection-store.port.js';
import { IAgentSettingsStorePort } from './ports/agent-settings-store.port.js';
import { IPreferencesStorePort } from './ports/preferences-store.port.js';
import { ISessionStorePort } from './ports/session-store.port.js';
import { AgentCapabilitiesService } from './services/agent-capabilities.service.js';
import { AgentProfileListService } from './services/agent-profile-list.service.js';
import { ConversationRuntimeService } from './services/conversation-runtime.service.js';
import { DelegationDetectorService } from './services/delegation-detector.service.js';
import { LanguageChangeRequestService } from './services/language-change-request.service.js';
import { OrchestratorService } from './services/orchestrator.service.js';
import { QuestionParserService } from './services/question-parser.service.js';
import { UserQuestionQueueService } from './services/user-question-queue.service.js';
import { CancelAgentConfigSelectionUseCase } from './use-cases/cancel-agent-config-selection.use-case.js';
import { CancelAgentTurnUseCase } from './use-cases/cancel-agent-turn.use-case.js';
import { ExecuteAgentTurnUseCase } from './use-cases/execute-agent-turn.use-case.js';
import { GetAgentQuotaUseCase } from './use-cases/get-agent-quota.use-case.js';
import { ProvisionWorkspaceGuidanceUseCase } from './use-cases/provision-workspace-guidance.use-case.js';
import { ResolveConversationInputUseCase } from './use-cases/resolve-conversation-input.use-case.js';
import { StartAgentConfigSelectionUseCase } from './use-cases/start-agent-config-selection.use-case.js';
import { SubmitAgentConfigSelectionUseCase } from './use-cases/submit-agent-config-selection.use-case.js';
import { TranscribeAudioAttachmentsUseCase } from './use-cases/transcribe-audio-attachments.use-case.js';


@Module({
  imports: [AgentModule, AgentDefinitionsModule, SpeechToTextModule, WorkspaceModule],
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
      provide: IPreferencesStorePort,
      useClass: JsonPreferencesStoreAdapter,
    },
    {
      provide: IAgentConfigSelectionStorePort,
      useClass: InMemoryAgentConfigSelectionStoreAdapter,
    },
    AgentCapabilitiesService,
    AgentProfileListService,
    ConversationRuntimeService,
    DelegationDetectorService,
    LanguageChangeRequestService,
    QuestionParserService,
    UserQuestionQueueService,
    ExecuteAgentTurnUseCase,
    CancelAgentTurnUseCase,
    StartAgentConfigSelectionUseCase,
    SubmitAgentConfigSelectionUseCase,
    ResolveConversationInputUseCase,
    CancelAgentConfigSelectionUseCase,
    GetAgentQuotaUseCase,
    ProvisionWorkspaceGuidanceUseCase,
    TranscribeAudioAttachmentsUseCase,
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
