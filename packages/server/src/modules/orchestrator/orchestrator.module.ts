import { Module } from '@nestjs/common';

import { AgentModule } from '../agent/agent.module.js';
import { AgentDefinitionsModule } from '../agent-definitions/agent-definitions.module.js';
import { PathsModule } from '../paths/paths.module.js';
import { SpeechToTextModule } from '../speech-to-text/speech-to-text.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';

import { JsonAgentSettingsStoreAdapter } from './adapters/json-agent-settings-store.adapter.js';
import { JsonOpenWorkStoreAdapter } from './adapters/json-open-work-store.adapter.js';
import { JsonPreferencesStoreAdapter } from './adapters/json-preferences-store.adapter.js';
import { JsonSessionStoreAdapter } from './adapters/json-session-store.adapter.js';
import { IAgentConfigurationPort } from './ports/agent-configuration.port.js';
import { IAgentSettingsStorePort } from './ports/agent-settings-store.port.js';
import { IAgentTurnPort } from './ports/agent-turn.port.js';
import { IOpenWorkStorePort } from './ports/open-work-store.port.js';
import { IPreferencesStorePort } from './ports/preferences-store.port.js';
import { ISessionStorePort } from './ports/session-store.port.js';
import { IUserQuestionPort } from './ports/user-question.port.js';
import { AgentCapabilitiesService } from './services/agent-capabilities.service.js';
import { AgentConfigurationService } from './services/agent-configuration.service.js';
import { AgentProfilesService } from './services/agent-profiles.service.js';
import { AgentProtocolService } from './services/agent-protocol.service.js';
import { AgentTurnService } from './services/agent-turn.service.js';
import { ConversationRuntimeService } from './services/conversation-runtime.service.js';
import { DelegationDetectorService } from './services/delegation-detector.service.js';
import { OpenWorkService } from './services/open-work.service.js';
import { QuestionParserService } from './services/question-parser.service.js';
import { QuestionTimeoutConfigService } from './services/question-timeout-config.service.js';
import { ShellCommandConfigService } from './services/shell-command-config.service.js';
import { UserLanguageService } from './services/user-language.service.js';
import { UserQuestionQueueService } from './services/user-question-queue.service.js';
import { UserQuestionService } from './services/user-question.service.js';
import { CancelAgentTurnUseCase } from './use-cases/cancel-agent-turn.use-case.js';
import { ConfigureAgentProfilesUseCase } from './use-cases/configure-agent-profiles.use-case.js';
import { ExecuteAgentTurnUseCase } from './use-cases/execute-agent-turn.use-case.js';
import { GetAgentQuotaUseCase } from './use-cases/get-agent-quota.use-case.js';
import { ProvisionWorkspaceGuidanceUseCase } from './use-cases/provision-workspace-guidance.use-case.js';
import { RestoreOpenWorkUseCase } from './use-cases/restore-open-work.use-case.js';
import { RunShellCommandUseCase } from './use-cases/run-shell-command.use-case.js';
import { TranscribeAudioAttachmentsUseCase } from './use-cases/transcribe-audio-attachments.use-case.js';


@Module({
  imports: [AgentModule, AgentDefinitionsModule, PathsModule, SpeechToTextModule, WorkspaceModule],
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
      provide: IOpenWorkStorePort,
      useClass: JsonOpenWorkStoreAdapter,
    },
    OpenWorkService,
    RestoreOpenWorkUseCase,
    AgentCapabilitiesService,
    AgentProfilesService,
    ConversationRuntimeService,
    DelegationDetectorService,
    AgentProtocolService,
    QuestionParserService,
    QuestionTimeoutConfigService,
    ShellCommandConfigService,
    UserLanguageService,
    UserQuestionQueueService,
    ExecuteAgentTurnUseCase,
    CancelAgentTurnUseCase,
    GetAgentQuotaUseCase,
    RunShellCommandUseCase,
    ProvisionWorkspaceGuidanceUseCase,
    TranscribeAudioAttachmentsUseCase,
    ConfigureAgentProfilesUseCase,
    { provide: IAgentTurnPort, useClass: AgentTurnService },
    { provide: IAgentConfigurationPort, useClass: AgentConfigurationService },
    { provide: IUserQuestionPort, useClass: UserQuestionService },
  ],
  exports: [
    IAgentTurnPort,
    IAgentConfigurationPort,
    IUserQuestionPort,
  ],
})
export class OrchestratorModule {}
