import { Module } from '@nestjs/common';

import { AgentModule } from '../agent/agent.module.js';
import { AgentDefinitionsModule } from '../agent-definitions/agent-definitions.module.js';
import { ArtifactsModule } from '../artifacts/artifacts.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { LoggingModule } from '../logging/logging.module.js';
import { PathsModule } from '../paths/paths.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { SpeechToTextModule } from '../speech-to-text/speech-to-text.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';

import { JsonOpenWorkStoreAdapter } from './adapters/json-open-work-store.adapter.js';
import { JsonSessionStoreAdapter } from './adapters/json-session-store.adapter.js';
import { SqliteAgentSettingsStoreAdapter } from './adapters/sqlite-agent-settings-store.adapter.js';
import { SqlitePreferencesStoreAdapter } from './adapters/sqlite-preferences-store.adapter.js';
import { IAgentConfigurationPort } from './ports/agent-configuration.port.js';
import { IAgentSettingsStorePort } from './ports/agent-settings-store.port.js';
import { IAgentToolsPort } from './ports/agent-tools.port.js';
import { IAgentTurnPort } from './ports/agent-turn.port.js';
import { IOpenWorkStorePort } from './ports/open-work-store.port.js';
import { IPreferencesStorePort } from './ports/preferences-store.port.js';
import { ISessionStorePort } from './ports/session-store.port.js';
import { ITurnRetryPort } from './ports/turn-retry.port.js';
import { IUserQuestionPort } from './ports/user-question.port.js';
import { AgentCapabilitiesService } from './services/agent-capabilities.service.js';
import { AgentConfigurationService } from './services/agent-configuration.service.js';
import { AgentProfilesService } from './services/agent-profiles.service.js';
import { AgentProtocolService } from './services/agent-protocol.service.js';
import { AgentRequestParserService } from './services/agent-request-parser.service.js';
import { AgentRoundService } from './services/agent-round.service.js';
import { AgentToolCatalogService } from './services/agent-tool-catalog.service.js';
import { AgentToolRequestService } from './services/agent-tool-request.service.js';
import { AgentToolSessionsService } from './services/agent-tool-sessions.service.js';
import { AgentToolsConfigService } from './services/agent-tools-config.service.js';
import { AgentToolsService } from './services/agent-tools.service.js';
import { AgentTurnService } from './services/agent-turn.service.js';
import { ArtifactPromptFormatterService } from './services/artifact-prompt-formatter.service.js';
import { CeoBoardService } from './services/ceo-board.service.js';
import { ConversationRuntimeService } from './services/conversation-runtime.service.js';
import { DelegationDetectorService } from './services/delegation-detector.service.js';
import { DelegationLimitsConfigService } from './services/delegation-limits-config.service.js';
import { DelegationStatusService } from './services/delegation-status.service.js';
import { DelegationValidatorService } from './services/delegation-validator.service.js';
import { OpenWorkService } from './services/open-work.service.js';
import { QuestionParserService } from './services/question-parser.service.js';
import { QuestionTimeoutConfigService } from './services/question-timeout-config.service.js';
import { ShellCommandConfigService } from './services/shell-command-config.service.js';
import { TeamProfilesService } from './services/team-profiles.service.js';
import { TurnRetryConfigService } from './services/turn-retry-config.service.js';
import { TurnRetryService } from './services/turn-retry.service.js';
import { UserLanguageService } from './services/user-language.service.js';
import { UserQuestionQueueService } from './services/user-question-queue.service.js';
import { UserQuestionService } from './services/user-question.service.js';
import { AnswerAgentQuestionsUseCase } from './use-cases/answer-agent-questions.use-case.js';
import { CancelAgentTurnUseCase } from './use-cases/cancel-agent-turn.use-case.js';
import { ConfigureAgentProfilesUseCase } from './use-cases/configure-agent-profiles.use-case.js';
import { ExecuteAgentTurnUseCase } from './use-cases/execute-agent-turn.use-case.js';
import { GetAgentQuotaUseCase } from './use-cases/get-agent-quota.use-case.js';
import { RestoreOpenWorkUseCase } from './use-cases/restore-open-work.use-case.js';
import { RetryCeoRoundUseCase } from './use-cases/retry-ceo-round.use-case.js';
import { RunAgentRequestsUseCase } from './use-cases/run-agent-requests.use-case.js';
import { RunAgentToolUseCase } from './use-cases/run-agent-tool.use-case.js';
import { RunDelegationUseCase } from './use-cases/run-delegation.use-case.js';
import { RunShellCommandUseCase } from './use-cases/run-shell-command.use-case.js';
import { StopArtifactWorkUseCase } from './use-cases/stop-artifact-work.use-case.js';
import { TranscribeAudioAttachmentsUseCase } from './use-cases/transcribe-audio-attachments.use-case.js';


@Module({
  imports: [
    AgentModule,
    AgentDefinitionsModule,
    ArtifactsModule,
    DatabaseModule,
    LoggingModule,
    PathsModule,
    SettingsModule,
    SpeechToTextModule,
    StorageModule,
    WorkspaceModule,
  ],
  providers: [
    {
      provide: ISessionStorePort,
      useClass: JsonSessionStoreAdapter,
    },
    {
      provide: IAgentSettingsStorePort,
      useClass: SqliteAgentSettingsStoreAdapter,
    },
    {
      provide: IPreferencesStorePort,
      useClass: SqlitePreferencesStoreAdapter,
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
    CeoBoardService,
    DelegationDetectorService,
    DelegationLimitsConfigService,
    DelegationStatusService,
    AgentProtocolService,
    ArtifactPromptFormatterService,
    AgentRequestParserService,
    QuestionParserService,
    QuestionTimeoutConfigService,
    TurnRetryConfigService,
    TurnRetryService,
    ShellCommandConfigService,
    UserLanguageService,
    UserQuestionQueueService,
    AgentRoundService,
    AgentToolsConfigService,
    AgentToolSessionsService,
    AgentToolCatalogService,
    AgentToolRequestService,
    RunAgentToolUseCase,
    DelegationValidatorService,
    TeamProfilesService,
    AnswerAgentQuestionsUseCase,
    RunDelegationUseCase,
    RetryCeoRoundUseCase,
    ExecuteAgentTurnUseCase,
    RunAgentRequestsUseCase,
    CancelAgentTurnUseCase,
    StopArtifactWorkUseCase,
    GetAgentQuotaUseCase,
    RunShellCommandUseCase,
    TranscribeAudioAttachmentsUseCase,
    ConfigureAgentProfilesUseCase,
    { provide: IAgentTurnPort, useClass: AgentTurnService },
    { provide: IAgentConfigurationPort, useClass: AgentConfigurationService },
    { provide: IUserQuestionPort, useClass: UserQuestionService },
    { provide: ITurnRetryPort, useExisting: TurnRetryService },
    { provide: IAgentToolsPort, useClass: AgentToolsService },
  ],
  exports: [
    IAgentTurnPort,
    IAgentToolsPort,
    IAgentConfigurationPort,
    IUserQuestionPort,
    ITurnRetryPort,
  ],
})
export class OrchestratorModule {}
