import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core';
import { createHash } from 'node:crypto';

import { type AgentUpdate, PromptCancelledError } from '../../agent/ports/agent.port.js';
import { StubFileSystem } from '../../agent/testing/stub-file-system.port.js';
import type { ArtifactsService } from '../../artifacts/services/artifacts.service.js';
import { buildArtifact } from '../../artifacts/testing/artifact.fixture.js';
import { createArtifactsService } from '../../artifacts/testing/artifacts-service.fixture.js';
import type { InMemoryArtifactStoreFake } from '../../artifacts/testing/in-memory-artifact-store.fake.js';
import { ConversationLogContextService } from '../../logging/services/conversation-log-context.service.js';
import { StubRuntimeSettings } from '../../settings/testing/stub-runtime-settings.js';
import { StubSpeechToText } from '../../speech-to-text/testing/stub-speech-to-text.js';
import { IWorkspacePort } from '../../workspace/ports/workspace.port.js';
import type { AgentSession } from '../models/agent-session.model.js';
import type { AgentProfileSettings, AgentSettings } from '../models/agent-settings.model.js';
import type { ConversationTurn } from '../models/conversation-turn.model.js';
import { DelegationControl } from '../models/delegation-control.model.js';
import type { DelegationEvent } from '../models/delegation-event.model.js';
import type { TurnRequest } from '../models/turn-request.model.js';
import type { RetryEvent } from '../models/turn-retry.model.js';
import type { QuestionAnswerInput, QuestionPrompt, RestoredWorkAnswers } from '../models/user-question.model.js';
import {
  type ArtifactAccess,
  type DelegationContract,
  IAgentRegistryPort,
} from '../ports/agent-registry.port.js';
import { buildBoardCheckPrompt } from '../prompts/board.prompt.js';
import { buildPreviousTurnPrompt } from '../prompts/previous-turn.prompt.js';
import { buildQuestionNotAllowedPrompt } from '../prompts/question-repair.prompt.js';
import { buildSkillCatalogPrompt } from '../prompts/skill-catalog.prompt.js';
import {
  buildAgentLanguagePrompt,
  buildCeoLanguagePrompt,
  buildLanguageDetectionPrompt,
} from '../prompts/user-language.prompt.js';
import { buildUserMessagePrompt } from '../prompts/user-message.prompt.js';
import { AgentProtocolService } from '../services/agent-protocol.service.js';
import { AgentRequestParserService } from '../services/agent-request-parser.service.js';
import { AgentRoundService } from '../services/agent-round.service.js';
import type { AgentToolSessionsService } from '../services/agent-tool-sessions.service.js';
import { ArtifactPromptFormatterService } from '../services/artifact-prompt-formatter.service.js';
import { CeoBoardService } from '../services/ceo-board.service.js';
import { ConversationRuntimeService } from '../services/conversation-runtime.service.js';
import { DelegationDetectorService } from '../services/delegation-detector.service.js';
import { DelegationLimitsConfigService } from '../services/delegation-limits-config.service.js';
import { DelegationStatusService } from '../services/delegation-status.service.js';
import { DelegationValidatorService } from '../services/delegation-validator.service.js';
import { OpenWorkService } from '../services/open-work.service.js';
import { QuestionParserService } from '../services/question-parser.service.js';
import { QuestionTimeoutConfigService } from '../services/question-timeout-config.service.js';
import { SteeringSupportService } from '../services/steering-support.service.js';
import { TeamProfilesService } from '../services/team-profiles.service.js';
import { TurnRetryConfigService } from '../services/turn-retry-config.service.js';
import { TurnRetryService } from '../services/turn-retry.service.js';
import { UserQuestionQueueService } from '../services/user-question-queue.service.js';
import { createServedToolSessions, credentialOf, TOOLS_URL } from '../testing/agent-tool-sessions.fixture.js';
import { InMemoryOpenWorkStoreFake } from '../testing/in-memory-open-work-store.fake.js';
import { InMemorySessionStoreFake } from '../testing/in-memory-session-store.fake.js';
import { questionListener } from '../testing/question-listener.fixture.js';
import { buildSessionContext } from '../testing/session-context.fixture.js';
import { StubAgentPortFactory } from '../testing/stub-agent-port-factory.js';
import { buildStubProfile, buildStubSettings, StubAgentSettingsStore } from '../testing/stub-agent-settings-store.js';
import { StubAgentSkillsPort } from '../testing/stub-agent-skills.port.js';
import { StubAgentPort } from '../testing/stub-agent.port.js';
import { StubPreferencesStore } from '../testing/stub-preferences-store.js';
import type { RetryPolicy } from '../utils/retry-delay.util.js';

import { AnswerAgentQuestionsUseCase } from './answer-agent-questions.use-case.js';
import { ExecuteAgentTurnUseCase } from './execute-agent-turn.use-case.js';
import { RestoreOpenWorkUseCase } from './restore-open-work.use-case.js';
import { RetryCeoRoundUseCase } from './retry-ceo-round.use-case.js';
import { RunAgentRequestsUseCase } from './run-agent-requests.use-case.js';
import { RunDelegationUseCase } from './run-delegation.use-case.js';
import { StopArtifactWorkUseCase } from './stop-artifact-work.use-case.js';
import { TranscribeAudioAttachmentsUseCase } from './transcribe-audio-attachments.use-case.js';


class StubAgentRegistryPort implements IAgentRegistryPort {
  getDefaultModel = rs.fn().mockReturnValue('mock-model-v1');
  getSystemPrompt = rs.fn().mockReturnValue('Mock system prompt.');
  getDisplayName = rs.fn((role: string) => role);
  listRoles = rs.fn((): string[] => ['CEO', 'DEVELOPER', 'CODE_REVIEWER', 'TECH_LEAD', 'PRODUCT_OWNER']);
  hasRole = rs.fn((role: string) => ['CEO', 'DEVELOPER', 'CODE_REVIEWER', 'TECH_LEAD'].includes(role));
  getDefaultSessionMode = rs.fn((role: string) => (role === 'CODE_REVIEWER' ? 'new' : 'resume'));
  getDelegationContract = rs.fn(
    (_role: string) => ({ project: 'optional', sessionMode: 'overridable', asksUser: true }) as DelegationContract,
  );

  getArtifactAccess = rs.fn((_role: string): ArtifactAccess => ({ scope: 'task', sections: [], fields: [] }));
  getReentryNote = rs.fn().mockReturnValue('');
  isSystemPromptEveryTurn = rs.fn().mockReturnValue(false);
}

class StubWorkspacePort implements IWorkspacePort {
  getBaseDirectory = rs.fn().mockReturnValue('/mock/workspace');
  resolveRepositoryPath = rs.fn().mockReturnValue('/mock/workspace/my-app');
  ensureDirectory = rs.fn().mockResolvedValue(undefined);
  listProjectFolders = rs.fn().mockResolvedValue(['my-app', 'project-a', 'project-b']);
  writeFile = rs.fn().mockResolvedValue(undefined);
  ensureSymlink = rs.fn().mockResolvedValue(undefined);
}

/** The `promptHash` a binding records once its session was sent this system prompt. */
const promptHashOf = (systemPrompt: string) => ({ promptHash: createHash('sha256').update(systemPrompt).digest('hex').slice(0, 16) });
const mockPrompt = promptHashOf('Mock system prompt.');
const toCeo = (prompt: string) => `${prompt}\n\n${buildCeoLanguagePrompt('English')}`;
const idleTeam = [
  '[TEAM_PROFILES]',
  '- DEVELOPER: Agent: Stub Agent, Model: default, Effort: default, Status: idle',
  '- CODE_REVIEWER: Agent: Stub Agent, Model: default, Effort: default, Status: idle',
  '- TECH_LEAD: Agent: Stub Agent, Model: default, Effort: default, Status: idle',
  '- PRODUCT_OWNER: Agent: Stub Agent, Model: default, Effort: default, Status: idle',
  '',
  '',
].join('\n');
const emptyBoard = '[BOARD]\nNo open artifact.\n\n';
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const toAgent = (prompt: string) => `${prompt}\n\n${buildAgentLanguagePrompt('English')}`;
const control = (summary = 'Summary') => new DelegationControl({ runId: 'd-1', summary, contextSince: '2026-01-01T00:00:00.000Z' });

function textChunk(text: string): AgentUpdate {
  return { kind: 'text', text };
}

describe('ExecuteAgentTurnUseCase', () => {
  let useCase: ExecuteAgentTurnUseCase;
  let stubAgentPort: StubAgentPort;
  let delegateStubPort: StubAgentPort;
  let sessionStore: InMemorySessionStoreFake;
  let settingsStore: StubAgentSettingsStore;
  let preferencesStore: StubPreferencesStore;
  let agentRegistry: StubAgentRegistryPort;
  let workspacePort: StubWorkspacePort;
  let delegationDetector: DelegationDetectorService;
  let portFactory: StubAgentPortFactory;
  let runtime: ConversationRuntimeService;
  let questionTimeoutMs = 0;
  let maxSpecChars = 600;
  let maxResultChars = 2000;
  let retryPolicy: RetryPolicy = { baseDelayMs: 0, maxDelayMs: 0, maxTotalMs: 0 };
  let turnRetry: TurnRetryService;
  const logContext = new ConversationLogContextService();
  let questionQueue: UserQuestionQueueService;
  let openWork: OpenWorkService;
  let openWorkStore: InMemoryOpenWorkStoreFake;
  let speechToText: StubSpeechToText;
  let fileSystem: StubFileSystem;
  let artifacts: ArtifactsService;
  let artifactStore: InMemoryArtifactStoreFake;
  let agentSkills: StubAgentSkillsPort;
  let toolSessions: AgentToolSessionsService;
  let steeringSupport: SteeringSupportService;

  beforeEach(() => {
    retryPolicy = { baseDelayMs: 0, maxDelayMs: 0, maxTotalMs: 0 };
    maxSpecChars = 600;
    maxResultChars = 2000;
    stubAgentPort = new StubAgentPort();
    delegateStubPort = new StubAgentPort();
    sessionStore = new InMemorySessionStoreFake();
    openWorkStore = new InMemoryOpenWorkStoreFake();
    settingsStore = new StubAgentSettingsStore();
    preferencesStore = new StubPreferencesStore();
    preferencesStore.preferences = { language: 'English' };
    agentRegistry = new StubAgentRegistryPort();
    workspacePort = new StubWorkspacePort();
    delegationDetector = new DelegationDetectorService(new QuestionParserService());

    let createCount = 0;
    portFactory = new StubAgentPortFactory(() => {
      createCount++;
      return createCount === 1 ? stubAgentPort : delegateStubPort;
    });

    wire(portFactory);
  });

  const wire = (factory: StubAgentPortFactory) => {
    toolSessions = createServedToolSessions();
    steeringSupport = new SteeringSupportService();
    runtime = new ConversationRuntimeService(factory, toolSessions, new StubRuntimeSettings({ SESSION_IDLE_TIMEOUT_MS: 60_000 }));
    questionQueue = new UserQuestionQueueService(new QuestionTimeoutConfigService(new StubRuntimeSettings(() => ({ QUESTION_TIMEOUT_MS: questionTimeoutMs }))));
    turnRetry = new TurnRetryService();
    openWork = new OpenWorkService(openWorkStore);
    speechToText = new StubSpeechToText();
    fileSystem = new StubFileSystem();
    ({ service: artifacts, store: artifactStore } = createArtifactsService({ conversationId: 'conv-1' }));
    const formatter = new ArtifactPromptFormatterService();
    agentSkills = new StubAgentSkillsPort();
    const runAgentRequests = new RunAgentRequestsUseCase(artifacts, agentRegistry, formatter, agentSkills, new AgentRequestParserService());
    const questionParser = new QuestionParserService();
    const audioTranscription = new TranscribeAudioAttachmentsUseCase(speechToText, fileSystem);
    const agentRound = new AgentRoundService(factory, sessionStore, agentRegistry, workspacePort, settingsStore, preferencesStore, new AgentProtocolService(), openWork, agentSkills, new AgentRequestParserService(), toolSessions, steeringSupport);
    const agentQuestions = new AnswerAgentQuestionsUseCase(agentRegistry, artifacts, questionParser, questionQueue, openWork, audioTranscription);
    const delegationStatus = new DelegationStatusService(artifacts, agentRegistry);
    const limits = new DelegationLimitsConfigService(new StubRuntimeSettings(() => ({ DELEGATION_SPEC_MAX_CHARS: maxSpecChars, AGENT_RESULT_MAX_CHARS: maxResultChars })));
    useCase = new ExecuteAgentTurnUseCase(
      factory,
      agentRegistry,
      preferencesStore,
      fileSystem,
      delegationDetector,
      new DelegationValidatorService(delegationDetector, agentRegistry, artifacts, workspacePort, runtime, delegationStatus, limits, steeringSupport),
      runtime,
      new AgentProtocolService(),
      agentRound,
      new TeamProfilesService(factory, agentRegistry, settingsStore, runtime, questionQueue, steeringSupport),
      new CeoBoardService(artifacts, formatter),
      openWork,
      logContext,
      audioTranscription,
      agentQuestions,
      runAgentRequests,
      new RunDelegationUseCase(factory, agentRegistry, artifacts, runtime, questionQueue, questionParser, openWork, formatter, agentRound, agentQuestions, runAgentRequests, delegationStatus, limits, toolSessions),
      new RetryCeoRoundUseCase(agentRegistry, turnRetry, new TurnRetryConfigService(new StubRuntimeSettings(() => ({ TURN_RETRY_BASE_DELAY_MS: retryPolicy.baseDelayMs, TURN_RETRY_MAX_DELAY_MS: retryPolicy.maxDelayMs, TURN_RETRY_MAX_TOTAL_MS: retryPolicy.maxTotalMs })))),
    );
  };

  const turnRequest = (overrides: Partial<TurnRequest> = {}): TurnRequest => ({
    conversationId: 'conv-1',
    userId: 'user-1',
    prompt: 'Hi',
    workspacePath: '/mock/workspace',
    agentRole: 'CEO',
    ...overrides,
  });


  it('should return the CEO response when there is no marker', async () => {
    stubAgentPort.mockResponses = ['Hello world!'];

    const result = await useCase.execute(turnRequest());

    expect(result.status).toBe('completed');
    expect(result.response).toBe('Hello world!');
    expect(stubAgentPort.connectCalls).toBe(1);
    expect(stubAgentPort.createSessionCalls).toEqual(['/mock/workspace']);
    expect(stubAgentPort.configCalls).toEqual([{ modelId: 'mock-model-v1' }]);
  });

  it('should log the whole response next to its preview', async () => {
    const response = `${'First paragraph. '.repeat(10)}\n\nSecond paragraph.`;
    stubAgentPort.mockResponses = [response];
    const log = rs.spyOn(Logger.prototype, 'log');

    await useCase.execute(turnRequest());
    const messages = log.mock.calls.map(([message]) => String(message));
    log.mockRestore();

    expect(messages.some(message => message.startsWith(`[Agent Response] Role=CEO, Length=${response.length}: "`))).toBe(true);
    expect(messages).toContain(`[Agent Response Text] Role=CEO, Length=${response.length}:\n${response}`);
  });

  it('should return the summary before the done marker', async () => {
    stubAgentPort.mockResponses = ['All set.'];

    const result = await useCase.execute(turnRequest());

    expect(result).toEqual({
      response: 'All set.',
      status: 'completed',
      agentInfo: { roleName: 'CEO', agentName: 'stub' },
    });
  });

  it('should report the token usage of the last CEO round', async () => {
    const usage = { totalTokens: 165, inputTokens: 100, outputTokens: 65 };
    stubAgentPort.usageToReturn = usage;
    stubAgentPort.mockResponses = ['Hi.'];

    const result = await useCase.execute(turnRequest());

    expect(result.usage).toEqual(usage);
  });

  it('should omit the token usage when collecting it fails', async () => {
    stubAgentPort.usageErrorToThrow = new Error('usage unavailable');
    stubAgentPort.mockResponses = ['Hi.'];

    const result = await useCase.execute(turnRequest());

    expect(result.status).toBe('completed');
    expect(result.usage).toBeUndefined();
  });

  it('should delegate to a new agent in the project folder and feed its result back to the CEO', async () => {
    stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Implement login.</delegate>', 'Done.'];
    delegateStubPort.mockResponses = ['Login implemented.'];
    agentRegistry.getSystemPrompt.mockImplementation((role: string) => `${role} prompt`);

    const result = await useCase.execute(turnRequest({ prompt: 'Add login' }));

    expect(result.response).toBe('Done.');
    expect(workspacePort.resolveRepositoryPath).toHaveBeenCalledWith('my-app');
    expect(delegateStubPort.createSessionCalls).toEqual(['/mock/workspace/my-app']);
    expect(delegateStubPort.promptCalls).toEqual([toAgent('DEVELOPER prompt\n\nImplement login.')]);
    expect(stubAgentPort.promptCalls).toEqual([
      toCeo(`CEO prompt\n\n${idleTeam}${emptyBoard}Add login`),
      toCeo('<agent_result role="DEVELOPER" project="my-app" agent="stub" model="default" effort="default">\nLogin implemented.\n</agent_result>'),
    ]);
    expect(delegateStubPort.closeSessionCalls).toBe(1);
    expect(delegateStubPort.connected).toBe(false);
  });

  describe('user language', () => {
    it('should ask the CEO to detect the language and store the detected one, hiding the tag', async () => {
      preferencesStore.preferences = {};
      stubAgentPort.mockResponses = ['Olá!\n\n<user_language>Brazilian Portuguese</user_language>'];

      const result = await useCase.execute(turnRequest({ prompt: 'Oi' }));

      expect(stubAgentPort.promptCalls).toEqual([`Mock system prompt.\n\n${idleTeam}${emptyBoard}Oi\n\n${buildLanguageDetectionPrompt()}`]);
      expect(result.response).toBe('Olá!');
      expect(preferencesStore.updates).toEqual([{ language: 'Brazilian Portuguese' }]);
    });

    it('should store English when the CEO cannot tell the language', async () => {
      preferencesStore.preferences = {};
      stubAgentPort.mockResponses = ['Ok.'];

      await useCase.execute(turnRequest({ prompt: 'ok' }));

      expect(preferencesStore.updates).toEqual([{ language: 'English' }]);
    });

    it('should keep the stored language when the CEO sends the tag again', async () => {
      preferencesStore.preferences = { language: 'Spanish' };
      stubAgentPort.mockResponses = ['Hola.<user_language>German</user_language>'];

      const result = await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls).toEqual([`Mock system prompt.\n\n${idleTeam}${emptyBoard}Hi\n\n${buildCeoLanguagePrompt('Spanish')}`]);
      expect(result.response).toBe('Hola.');
      expect(preferencesStore.updates).toEqual([]);
    });

    it('should keep a language the user set while the CEO was detecting one', async () => {
      preferencesStore.preferences = {};
      stubAgentPort.mockResponses = ['Olá!\n\n<user_language>Brazilian Portuguese</user_language>'];
      const load = preferencesStore.load.bind(preferencesStore);
      preferencesStore.load = async () => {
        const loaded = await load();
        if (stubAgentPort.promptCalls.length > 0) {
          preferencesStore.preferences = { language: 'Spanish' };
        }
        return loaded;
      };

      await useCase.execute(turnRequest({ prompt: 'Oi' }));

      expect(preferencesStore.updates).toEqual([]);
      expect(preferencesStore.preferences.language).toBe('Spanish');
    });

    it('should ask delegates for English while no language is stored', async () => {
      preferencesStore.preferences = {};
      preferencesStore.update = async () => ({});
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Fix it.</delegate>', 'Done.'];
      delegateStubPort.mockResponses = ['Fixed.'];

      await useCase.execute(turnRequest());

      expect(delegateStubPort.promptCalls).toEqual([`Mock system prompt.\n\nFix it.\n\n${buildAgentLanguagePrompt('English')}`]);
    });

    it('should give delegates the language detected in the same turn', async () => {
      preferencesStore.preferences = {};
      stubAgentPort.mockResponses = ['<user_language>Spanish</user_language><delegate role="DEVELOPER" summary="Working on it" project="my-app">Fix it.</delegate>', 'Listo.'];
      delegateStubPort.mockResponses = ['Hecho.'];

      await useCase.execute(turnRequest({ prompt: 'Arréglalo' }));

      expect(delegateStubPort.promptCalls).toEqual([`Mock system prompt.\n\nFix it.\n\n${buildAgentLanguagePrompt('Spanish')}`]);
      expect(stubAgentPort.promptCalls[1]).toContain(buildCeoLanguagePrompt('Spanish'));
    });
  });

  describe('re-entry note', () => {
    beforeEach(() => {
      agentRegistry.getReentryNote.mockImplementation((role: string) => `[RE-ENTRY] ${role}`);
      agentRegistry.getSystemPrompt.mockImplementation((role: string) => `${role} prompt`);
    });

    it('should leave the note out of a new session, which gets the system prompt instead', async () => {
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Implement login.</delegate>', 'Done.'];
      delegateStubPort.mockResponses = ['Login implemented.'];

      await useCase.execute(turnRequest({ prompt: 'Add login' }));

      expect(stubAgentPort.promptCalls[0]).toBe(toCeo(`CEO prompt\n\n${idleTeam}${emptyBoard}Add login`));
      expect(delegateStubPort.promptCalls).toEqual([toAgent('DEVELOPER prompt\n\nImplement login.')]);
    });

    it('should put the note before the prompt of a resumed session only, and not in its later prompts', async () => {
      sessionStore.seed(buildSessionContext({
        agentSessions: [{ role: 'DEVELOPER', agentId: 'stub', sessionId: 'dev-old', projectName: 'my-app', artifactId: null, ...promptHashOf('DEVELOPER prompt') }],
      }));
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Fix it.</delegate>', 'Done.'];
      delegateStubPort.mockResponses = ['<artifact_list/>', 'Fixed.'];
      const log = rs.spyOn(Logger.prototype, 'log');

      await useCase.execute(turnRequest());
      const messages = log.mock.calls.map(([message]) => String(message));
      log.mockRestore();

      expect(delegateStubPort.promptCalls[0]).toBe(toAgent('[RE-ENTRY] DEVELOPER\n\nFix it.'));
      expect(delegateStubPort.promptCalls[1]).not.toContain('[RE-ENTRY]');
      expect(stubAgentPort.promptCalls[1]).not.toContain('[RE-ENTRY]');
      expect(messages).toContain(`[Agent Prompt] Role=DEVELOPER, Session=resumed, Interface=tags, SystemPrompt=no, Chars=${delegateStubPort.promptCalls[0]!.length}`);
      expect(messages).toContain(`[Agent Prompt] Role=DEVELOPER, Session=live, Interface=tags, SystemPrompt=no, Chars=${delegateStubPort.promptCalls[1]!.length}`);
    });

    it('should put the note of a resumed CEO after its system prompt and before the prompt', async () => {
      sessionStore.seed(buildSessionContext({ agentSessions: [{ role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null, artifactId: null }] }));
      agentRegistry.isSystemPromptEveryTurn.mockReturnValue(true);
      stubAgentPort.mockResponses = ['Hi.'];

      await useCase.execute(turnRequest({ prompt: 'Continue' }));

      expect(stubAgentPort.promptCalls).toEqual([toCeo(`CEO prompt\n\n[RE-ENTRY] CEO\n\n${idleTeam}${emptyBoard}Continue`)]);
    });

    describe('system prompt fingerprint', () => {
      const developer = (promptHash?: string): AgentSession => ({ role: 'DEVELOPER', agentId: 'stub', sessionId: 'dev-old', projectName: 'my-app', artifactId: null, ...(promptHash && { promptHash }) });
      const promptLines = async (run: () => Promise<unknown>) => {
        const log = rs.spyOn(Logger.prototype, 'log');
        await run();
        const messages = log.mock.calls.map(([message]) => String(message));
        log.mockRestore();
        return messages.filter(message => message.startsWith('[Agent Prompt] Role=DEVELOPER'));
      };
      const storedDeveloper = async () => (await sessionStore.findSession('conv-1'))?.agentSessions.find(binding => binding.role === 'DEVELOPER');

      beforeEach(() => {
        stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Fix it.</delegate>', 'Done.'];
        delegateStubPort.mockResponses = ['Fixed.'];
      });

      it('should send the system prompt of the role again to a resumed session that received another one, and record it', async () => {
        sessionStore.seed(buildSessionContext({ agentSessions: [developer(promptHashOf('Older DEVELOPER prompt').promptHash)] }));

        const lines = await promptLines(() => useCase.execute(turnRequest()));

        expect(delegateStubPort.loadSessionCalls).toEqual([{ cwd: '/mock/workspace/my-app', sessionId: 'dev-old' }]);
        expect(delegateStubPort.createSessionCalls).toEqual([]);
        expect(delegateStubPort.promptCalls).toEqual([toAgent('DEVELOPER prompt\n\n[RE-ENTRY] DEVELOPER\n\nFix it.')]);
        expect(lines).toEqual([`[Agent Prompt] Role=DEVELOPER, Session=resumed, Interface=tags, SystemPrompt=yes (changed), Chars=${delegateStubPort.promptCalls[0]!.length}`]);
        expect(await storedDeveloper()).toEqual(developer(promptHashOf('DEVELOPER prompt').promptHash));
      });

      it('should send the system prompt to a resumed session stored without a fingerprint, and record it', async () => {
        sessionStore.seed(buildSessionContext({ agentSessions: [developer()] }));

        const lines = await promptLines(() => useCase.execute(turnRequest()));

        expect(delegateStubPort.promptCalls).toEqual([toAgent('DEVELOPER prompt\n\n[RE-ENTRY] DEVELOPER\n\nFix it.')]);
        expect(lines[0]).toContain('SystemPrompt=yes (changed)');
        expect(await storedDeveloper()).toEqual(developer(promptHashOf('DEVELOPER prompt').promptHash));
      });

      it('should send only the note to a resumed session that received the same system prompt, and leave its fingerprint', async () => {
        sessionStore.seed(buildSessionContext({ agentSessions: [developer(promptHashOf('DEVELOPER prompt').promptHash)] }));

        const lines = await promptLines(() => useCase.execute(turnRequest()));

        expect(delegateStubPort.promptCalls).toEqual([toAgent('[RE-ENTRY] DEVELOPER\n\nFix it.')]);
        expect(lines[0]).toContain('SystemPrompt=no');
        expect(await storedDeveloper()).toEqual(developer(promptHashOf('DEVELOPER prompt').promptHash));
      });

      it('should record the system prompt a new session received, with the skill catalog that goes with it', async () => {
        agentSkills.skills = { DEVELOPER: [{ name: 'testing', description: 'How to test.', content: 'Test it.' }] };

        const lines = await promptLines(() => useCase.execute(turnRequest()));

        const catalog = buildSkillCatalogPrompt([{ name: 'testing', description: 'How to test.' }], 'tags');
        expect(lines[0]).toContain('Session=new, Interface=tags, SystemPrompt=yes,');
        expect(await storedDeveloper()).toMatchObject({ sessionId: 'session-1', ...promptHashOf(`DEVELOPER prompt\n\n${catalog}`) });
      });

      it('should not record a system prompt the agent did not start answering', async () => {
        sessionStore.seed(buildSessionContext({ agentSessions: [developer(promptHashOf('Older DEVELOPER prompt').promptHash)] }));
        delegateStubPort.errorToThrowOnPrompt = new Error('usage limit');

        await useCase.execute(turnRequest());

        expect(await storedDeveloper()).toEqual(developer(promptHashOf('Older DEVELOPER prompt').promptHash));
      });

      it('should keep the fingerprint of a CEO that gets its system prompt with every message up to date', async () => {
        sessionStore.seed(buildSessionContext({ agentSessions: [{ role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null, artifactId: null, ...promptHashOf('Older CEO prompt') }] }));
        agentRegistry.isSystemPromptEveryTurn.mockReturnValue(true);
        stubAgentPort.mockResponses = ['Hi.'];
        const log = rs.spyOn(Logger.prototype, 'log');

        await useCase.execute(turnRequest({ prompt: 'Continue' }));
        const messages = log.mock.calls.map(([message]) => String(message));
        log.mockRestore();

        expect(stubAgentPort.promptCalls[0]).toContain('CEO prompt\n\n[RE-ENTRY] CEO');
        expect(messages).toContain(`[Agent Prompt] Role=CEO, Session=resumed, Interface=tags, SystemPrompt=yes, Chars=${stubAgentPort.promptCalls[0]!.length}`);
        expect((await sessionStore.findSession('conv-1'))?.agentSessions).toEqual([{ role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null, artifactId: null, ...promptHashOf('CEO prompt') }]);
      });
    });

    describe('skill catalog', () => {
      const testing = { name: 'testing', description: 'How to test.', content: 'Test it.' };
      const catalogOf = (...skills: { name: string; description: string }[]) => buildSkillCatalogPrompt(skills.map(({ name, description }) => ({ name, description })), 'tags');
      const seedDeveloper = (systemPrompt = 'DEVELOPER prompt') => sessionStore.seed(buildSessionContext({
        agentSessions: [{ role: 'DEVELOPER', agentId: 'stub', sessionId: 'dev-old', projectName: 'my-app', artifactId: null, ...promptHashOf(systemPrompt) }],
      }));

      it('should put the current catalog of the role after the note and before the prompt of a resumed session, and not in its later prompts', async () => {
        agentSkills.skills = { DEVELOPER: [testing] };
        seedDeveloper(`DEVELOPER prompt\n\n${catalogOf(testing)}`);
        stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Fix it.</delegate>', 'Done.'];
        delegateStubPort.mockResponses = ['<artifact_list/>', 'Fixed.'];

        await useCase.execute(turnRequest());

        expect(delegateStubPort.promptCalls[0]).toBe(toAgent(`[RE-ENTRY] DEVELOPER\n\n${catalogOf(testing)}\n\nFix it.`));
        expect(delegateStubPort.promptCalls[1]).not.toContain('[SKILLS]');
      });

      it('should send the catalog of a new session once, with its system prompt', async () => {
        agentSkills.skills = { DEVELOPER: [testing] };
        stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Fix it.</delegate>', 'Done.'];
        delegateStubPort.mockResponses = ['<artifact_list/>', 'Fixed.'];

        await useCase.execute(turnRequest());

        expect(delegateStubPort.promptCalls[0]).toBe(toAgent(`DEVELOPER prompt\n\n${catalogOf(testing)}\n\nFix it.`));
        expect(delegateStubPort.promptCalls[1]).not.toContain('[SKILLS]');
      });

      it('should leave the catalog out for a resumed role without skills that does not write them', async () => {
        seedDeveloper();
        stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Fix it.</delegate>', 'Done.'];
        delegateStubPort.mockResponses = ['Fixed.'];

        await useCase.execute(turnRequest());

        expect(delegateStubPort.promptCalls).toEqual([toAgent('[RE-ENTRY] DEVELOPER\n\nFix it.')]);
      });

      it('should tell a resumed role that writes skills how it manages them, even before it has any', async () => {
        agentSkills.writers = ['DEVELOPER'];
        seedDeveloper(`DEVELOPER prompt\n\n${buildSkillCatalogPrompt([], 'tags', true)}`);
        stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Fix it.</delegate>', 'Done.'];
        delegateStubPort.mockResponses = ['Fixed.'];

        await useCase.execute(turnRequest());

        expect(delegateStubPort.promptCalls[0]).toBe(toAgent(`[RE-ENTRY] DEVELOPER\n\n${buildSkillCatalogPrompt([], 'tags', true)}\n\nFix it.`));
      });

      it('should send the system prompt again, with the catalog that lists a skill created since, to a resumed session of the role', async () => {
        const review = { name: 'review', description: 'How to review.', content: 'Review it.' };
        agentSkills.skills = { DEVELOPER: [testing] };
        stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="First" project="my-app">First job.</delegate>', 'Done.'];
        delegateStubPort.mockResponses = ['First done.'];
        await useCase.execute(turnRequest());

        agentSkills.skills = { DEVELOPER: [testing, review] };
        stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Second" project="my-app">Second job.</delegate>', 'Done.'];
        delegateStubPort.mockResponses = ['Second done.'];
        await useCase.execute(turnRequest({ prompt: 'Again' }));

        expect(delegateStubPort.promptCalls[0]).toBe(toAgent(`DEVELOPER prompt\n\n${catalogOf(testing)}\n\nFirst job.`));
        expect(delegateStubPort.promptCalls[1]).toBe(toAgent(`DEVELOPER prompt\n\n${catalogOf(testing, review)}\n\n[RE-ENTRY] DEVELOPER\n\nSecond job.`));
      });

      it('should send the catalog of a resumed CEO once, with its system prompt', async () => {
        agentSkills.skills = { CEO: [testing] };
        sessionStore.seed(buildSessionContext({ agentSessions: [{ role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null, artifactId: null }] }));
        agentRegistry.isSystemPromptEveryTurn.mockReturnValue(true);
        stubAgentPort.mockResponses = ['Hi.'];

        await useCase.execute(turnRequest({ prompt: 'Continue' }));

        expect(stubAgentPort.promptCalls).toEqual([toCeo(`CEO prompt\n\n${catalogOf(testing)}\n\n[RE-ENTRY] CEO\n\n${idleTeam}${emptyBoard}Continue`)]);
      });
    });
  });

  it('should run the delegate in the request workspace when no project is given', async () => {
    stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it">Review it.</delegate>', 'Ok.'];
    delegateStubPort.mockResponses = ['Reviewed.'];

    await useCase.execute(turnRequest());

    expect(workspacePort.resolveRepositoryPath).not.toHaveBeenCalled();
    expect(delegateStubPort.createSessionCalls).toEqual(['/mock/workspace']);
  });

  it('should notify when a delegation starts and finishes', async () => {
    stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Go.</delegate>', 'Ok.'];
    delegateStubPort.mockResponses = ['Done.'];
    agentRegistry.getDisplayName.mockImplementation((role: string) => `${role} name`);
    const usage = { totalTokens: 40, inputTokens: 30, outputTokens: 10 };
    delegateStubPort.usageToReturn = usage;
    const events: DelegationEvent[] = [];

    await useCase.execute(turnRequest({ onDelegation: event => events.push(event) }));

    const delegation = { delegationId: expect.any(String), round: 1, role: 'DEVELOPER', roleName: 'DEVELOPER name', projectName: 'my-app', taskSpec: 'Go.', summary: 'Working on it' };
    expect(events).toEqual([
      { ...delegation, phase: 'started' },
      {
        ...delegation,
        phase: 'finished',
        response: 'Done.',
        agentInfo: { roleName: 'DEVELOPER name', agentName: 'stub' },
        usage,
        durationMs: expect.any(Number),
      },
    ]);
  });

  it('should add up the prompts and token usage of a delegation in its finished event and log', async () => {
    stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Go.</delegate>', 'Ok.'];
    delegateStubPort.mockResponses = ['<artifact_list/>', 'Done.'];
    delegateStubPort.getLastRoundUsage = rs.fn()
      .mockResolvedValueOnce({ totalTokens: 40, inputTokens: 30, outputTokens: 10, cachedReadTokens: 5, cachedWriteTokens: 7 })
      .mockResolvedValueOnce({ totalTokens: 20, inputTokens: 15, outputTokens: 5 });
    const events: DelegationEvent[] = [];
    const log = rs.spyOn(Logger.prototype, 'log');

    await useCase.execute(turnRequest({ onDelegation: event => events.push(event) }));
    const messages = log.mock.calls.map(([message]) => String(message));
    log.mockRestore();

    const promptChars = delegateStubPort.promptCalls.reduce((total, prompt) => total + prompt.length, 0);
    const finished = events.find(event => event.phase === 'finished');
    expect(finished && 'usage' in finished ? finished.usage : undefined).toStrictEqual({ totalTokens: 60, inputTokens: 45, outputTokens: 15, cachedReadTokens: 5, cachedWriteTokens: 7 });
    expect(messages).toContainEqual(expect.stringMatching(new RegExp(`^\\[Delegation Finished\\] .*, Prompts=2, PromptChars=${promptChars}, InputTokens=45, OutputTokens=15, TotalTokens=60$`)));
    expect(messages).toContain('[Agent Usage] Role=DEVELOPER, Input=30, Output=10, CachedRead=5, CachedWrite=7, Total=40');
    expect(messages).toContain('[Agent Usage] Role=DEVELOPER, Input=15, Output=5, CachedRead=0, CachedWrite=0, Total=20');
    expect(messages).toContain(`[Agent Prompt] Role=DEVELOPER, Session=new, Interface=tags, SystemPrompt=yes, Chars=${delegateStubPort.promptCalls[0]!.length}`);
  });

  it('should give each delegation its own id, shared by every phase of it', async () => {
    stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it">Go.</delegate>', 'Ok.'];
    delegateStubPort.mockResponses = ['Done.'];
    const first: DelegationEvent[] = [];
    const second: DelegationEvent[] = [];

    await useCase.execute(turnRequest({ onDelegation: event => first.push(event) }));
    stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it">Go.</delegate>', 'Ok.'];
    delegateStubPort.mockResponses = ['Done.'];
    await useCase.execute(turnRequest({ onDelegation: event => second.push(event) }));

    expect(first[0]!.delegationId).toBe(first[1]!.delegationId);
    expect(second[0]!.delegationId).toBe(second[1]!.delegationId);
    expect(first[0]!.delegationId).not.toBe(second[0]!.delegationId);
  });

  it('should ensure each agent working directory exists before creating its session', async () => {
    stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Go.</delegate>', 'Ok.'];
    delegateStubPort.mockResponses = ['Done.'];

    await useCase.execute(turnRequest());

    expect(workspacePort.ensureDirectory.mock.calls).toEqual([
      ['/mock/workspace'],
      ['/mock/workspace/my-app'],
    ]);
  });

  it('should fail the turn without creating a session when the directory cannot be prepared', async () => {
    workspacePort.ensureDirectory.mockRejectedValue(new Error('Path is outside the workspace directory: /x'));

    const result = await useCase.execute(turnRequest({ workspacePath: '/x' }));

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('Path is outside the workspace directory: /x');
    expect(stubAgentPort.createSessionCalls).toHaveLength(0);
  });

  it('should return failed when max delegation rounds are exceeded', async () => {
    stubAgentPort.mockResponses = Array(105).fill('<delegate role="DEVELOPER" summary="Working on it" project="my-app">Delegating...</delegate>');
    delegateStubPort.mockResponses = Array(105).fill('I did it.');

    const result = await useCase.execute(turnRequest());

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('Max delegation rounds exceeded.');
    expect(stubAgentPort.promptCalls).toHaveLength(1000);
    expect(delegateStubPort.promptCalls).toHaveLength(999);
  });

  it('should tell the CEO of the next turn which delegations never started when the round limit stopped the turn', async () => {
    stubAgentPort.mockResponses = Array(105).fill('<delegate role="DEVELOPER" summary="Working on it" project="my-app">Delegating...</delegate>');
    delegateStubPort.mockResponses = Array(105).fill('I did it.');
    await useCase.execute(turnRequest());
    stubAgentPort.mockResponses = ['Understood.'];

    await useCase.execute(turnRequest({ prompt: 'What happened?' }));

    const next = stubAgentPort.promptCalls[1000]!;
    expect(next).toContain('- DEVELOPER (Project: my-app, Task: "Delegating...") never started.');
    expect(next).toContain('- Your previous turn failed: Max delegation rounds exceeded.');
    expect(next).not.toContain('was stopped before finishing');
  });

  it('should tell the CEO of the next turn that the previous one was cancelled', async () => {
    const loadSettings = settingsStore.load.bind(settingsStore);
    settingsStore.load = async () => {
      throw new PromptCancelledError();
    };
    const cancelled = await useCase.execute(turnRequest());
    settingsStore.load = loadSettings;
    stubAgentPort.mockResponses = ['Understood.'];

    await useCase.execute(turnRequest({ prompt: 'Where were we?' }));

    expect(cancelled.status).toBe('cancelled');
    expect(stubAgentPort.promptCalls[0]).toContain('[PREVIOUS_TURN]\n- Your previous turn was cancelled.\n');
  });

  it('should keep the notices pending when the CEO round that would carry them throws', async () => {
    const loadSettings = settingsStore.load.bind(settingsStore);
    settingsStore.load = async () => {
      throw new PromptCancelledError();
    };
    await useCase.execute(turnRequest());
    settingsStore.load = loadSettings;
    stubAgentPort.errorToThrowOnCreateSession = new Error('Internal error');
    const failed = await useCase.execute(turnRequest());
    stubAgentPort.errorToThrowOnCreateSession = null;
    stubAgentPort.mockResponses = ['Understood.'];

    await useCase.execute(turnRequest({ prompt: 'Hello?' }));

    expect(failed.status).toBe('failed');
    expect(stubAgentPort.promptCalls).toHaveLength(1);
    expect(stubAgentPort.promptCalls[0]).toContain(buildPreviousTurnPrompt([
      'Your previous turn was cancelled.',
      `Your previous turn failed: ${failed.errorMessage}`,
    ]));
    expect(runtime.pendingCeoNotices('conv-1')).toEqual([]);
  });

  it('should send the running agents list with the first round even when nobody is working', async () => {
    stubAgentPort.mockResponses = ['Hello.'];

    await useCase.execute(turnRequest());

    expect(stubAgentPort.promptCalls[0]).toContain(idleTeam);
  });

  it('should not repeat an empty running agents list in later rounds', async () => {
    stubAgentPort.mockResponses = [
      '<delegate role="DEVELOPER" summary="Working on it" project="my-app">First.</delegate>',
      '<delegate role="DEVELOPER" summary="Working on it" project="my-app">Second.</delegate>',
      'Done.',
    ];
    delegateStubPort.mockResponses = ['One.', 'Two.'];

    await useCase.execute(turnRequest());

    expect(stubAgentPort.promptCalls).toHaveLength(3);
    expect(stubAgentPort.promptCalls[0]).toContain('[TEAM_PROFILES]');
    expect(stubAgentPort.promptCalls[1]).not.toContain('[TEAM_PROFILES]');
    expect(stubAgentPort.promptCalls[2]).not.toContain('[TEAM_PROFILES]');
  });

  it('should list the profile of every role but the CEO, falling back to the CEO profile for roles without one', async () => {
    settingsStore.settings = buildStubSettings({
      CEO: buildStubProfile('claude', { agentName: 'Claude Code' }),
      DEVELOPER: buildStubProfile('codex', { agentName: 'OpenAI Codex', modelName: '6.1 Terra', effortName: 'Medium' }),
    });
    stubAgentPort.mockResponses = ['Hello.'];

    await useCase.execute(turnRequest());

    const prompt = stubAgentPort.promptCalls[0]!;
    expect(prompt).toContain('- DEVELOPER: Agent: OpenAI Codex, Model: 6.1 Terra, Effort: Medium, Status: idle');
    expect(prompt).toContain('- CODE_REVIEWER: Agent: Claude Code, Model: default, Effort: default, Status: idle');
    expect(prompt).not.toContain('- CEO:');
  });

  it('should name the default agent when the conversation has no settings and its id when it is not listed', async () => {
    portFactory.agents = [];
    portFactory.defaultAgentId = 'unlisted';
    stubAgentPort.mockResponses = ['Hello.'];

    await useCase.execute(turnRequest());

    expect(stubAgentPort.promptCalls[0]).toContain('- DEVELOPER: Agent: unlisted, Model: default, Effort: default, Status: idle');
  });

  describe('delegation contract', () => {
    it('should repair a delegation missing a project folder the role requires', async () => {
      agentRegistry.getDelegationContract.mockReturnValueOnce({ project: 'required' });
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it">Go.</delegate>', '<delegate role="DEVELOPER" summary="Working on it" project="my-app">Go.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['Done.'];

      const result = await useCase.execute(turnRequest());

      expect(result.status).toBe('completed');
      expect(stubAgentPort.promptCalls[1]).toContain(
        'Role "DEVELOPER" requires a project folder. Use <delegate role="DEVELOPER" summary="<summary>" project="<project-folder>">.',
      );
    });

    it('should repair a delegation carrying a project folder the role does not take', async () => {
      agentRegistry.getDelegationContract.mockReturnValueOnce({});
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Go.</delegate>', 'Ok, asking you first.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls[1]).toContain(
        'Role "DEVELOPER" does not take a project folder. Use <delegate role="DEVELOPER" summary="<summary>"> without the project attribute.',
      );
      expect(delegateStubPort.promptCalls).toHaveLength(0);
    });

    it('should repair a delegation carrying a session mode the role keeps fixed', async () => {
      agentRegistry.getDelegationContract.mockReturnValueOnce({ project: 'required' });
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app" session="new">Go.</delegate>', 'Ok, asking you first.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls[1]).toContain(
        'Role "DEVELOPER" does not take a session mode. Use <delegate role="DEVELOPER" summary="<summary>"> without the session attribute.',
      );
      expect(delegateStubPort.promptCalls).toHaveLength(0);
    });
  });

  describe('delegation only on the user\'s decision', () => {
    const onlyOnUserDecision = { project: 'optional', userInitiatedOnly: true } as const;

    it('should delegate when the user\'s message leads to it', async () => {
      agentRegistry.getDelegationContract.mockReturnValue(onlyOnUserDecision);
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Installing it">Install Docker.</delegate>', 'Installed.'];
      delegateStubPort.mockResponses = ['Docker installed.'];

      const result = await useCase.execute(turnRequest());

      expect(result).toMatchObject({ status: 'completed', response: 'Installed.' });
      expect(delegateStubPort.promptCalls).toHaveLength(1);
    });

    it('should send the CEO back to ask the user when it delegates on its own after an agent result', async () => {
      agentRegistry.getDelegationContract.mockReturnValue(onlyOnUserDecision);
      stubAgentPort.mockResponses = [
        '<delegate role="DEVELOPER" summary="Installing it">Install Docker.</delegate>',
        '<delegate role="DEVELOPER" summary="Tuning it">Tune the system.</delegate>',
        'May I ask the IT agent to tune it?',
      ];
      delegateStubPort.mockResponses = ['Docker installed.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls[2]).toContain('DEVELOPER is delegated to only on the user\'s decision');
      expect(delegateStubPort.promptCalls).toHaveLength(1);
    });
  });

  describe('delegation repair', () => {
    it('should send a repair prompt with the reason and delegate once the CEO fixes the tag', async () => {
      stubAgentPort.mockResponses = [
        '<delegate project="my-app">Cloning it.</delegate>',
        '<delegate role="DEVELOPER" summary="Working on it" project="my-app">Clone the repo.</delegate>',
        'Cloned.',
      ];
      delegateStubPort.mockResponses = ['Repo cloned.'];

      const result = await useCase.execute(turnRequest());

      expect(result).toMatchObject({ status: 'completed', response: 'Cloned.' });
      expect(stubAgentPort.promptCalls[1]).toContain('[DELEGATION_ERROR]');
      expect(stubAgentPort.promptCalls[1]).toContain('needs a role attribute');
      expect(delegateStubPort.promptCalls).toEqual([toAgent('Mock system prompt.\n\nClone the repo.')]);
    });

    it('should repair a delegation to a role outside the team', async () => {
      stubAgentPort.mockResponses = ['<delegate role="QA" summary="Working on it" project="my-app">Test it.</delegate>', 'Ok, I will ask you first.'];

      const result = await useCase.execute(turnRequest());

      expect(result).toMatchObject({ status: 'completed', response: 'Ok, I will ask you first.' });
      expect(stubAgentPort.promptCalls[1]).toContain('Unknown role "QA"');
      expect(delegateStubPort.promptCalls).toHaveLength(0);
    });

    it('should repair a delegation from the CEO to itself', async () => {
      stubAgentPort.mockResponses = ['<delegate role="CEO" summary="Working on it">Plan it.</delegate>', 'Planned.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls[1]).toContain('Unknown role "CEO"');
    });

    it('should repair a delegation to a project folder outside the workspaces root', async () => {
      workspacePort.resolveRepositoryPath.mockImplementationOnce(() => {
        throw new Error('Path is outside the workspace directory: /etc');
      });
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="../../etc">Go.</delegate>', '<delegate role="DEVELOPER" summary="Working on it" project="my-app">Go.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['Done.'];

      const result = await useCase.execute(turnRequest());

      expect(result.status).toBe('completed');
      expect(stubAgentPort.promptCalls[1]).toContain(
        'Invalid project folder "../../etc": Path is outside the workspace directory: /etc. Use one of the existing project folders exactly as written: my-app, project-a, project-b.',
      );
      expect(delegateStubPort.createSessionCalls).toEqual(['/mock/workspace/my-app']);
    });

    it('should repair a delegation to a project folder that does not exist, listing the existing ones', async () => {
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-ap">Go.</delegate>', '<delegate role="DEVELOPER" summary="Working on it" project="my-app">Go.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['Done.'];

      const result = await useCase.execute(turnRequest());

      expect(result.status).toBe('completed');
      expect(stubAgentPort.promptCalls[1]).toContain(
        'Project folder "my-ap" does not exist in the workspaces root. Use one of the existing project folders exactly as written: my-app, project-a, project-b.',
      );
      expect(workspacePort.ensureDirectory).not.toHaveBeenCalledWith('/mock/workspace/my-ap');
    });

    it('should ask to add the repository first when the workspace has no project folders', async () => {
      workspacePort.listProjectFolders.mockResolvedValue([]);
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Go.</delegate>', 'Sorry.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls[1]).toContain(
        'The workspaces root has no project folders yet; add the repository first, delegating without a project folder.',
      );
    });

    it('should stringify non-Error failures when resolving the project folder', async () => {
      workspacePort.resolveRepositoryPath.mockImplementationOnce(() => {
        throw 'bad path';
      });
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="x">Go.</delegate>', 'Never mind.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls[1]).toContain('Invalid project folder "x": bad path.');
    });

    it('should fail the turn when the repaired response is still invalid', async () => {
      stubAgentPort.mockResponses = ['Go.</delegate>', 'Still wrong.</delegate>'];

      const result = await useCase.execute(turnRequest());

      expect(result.status).toBe('failed');
      expect(result.response).toBe('Still wrong.</delegate>');
      expect(result.errorMessage).toBe('Invalid CEO response: Found </delegate> without its opening <delegate> tag.');
      expect(stubAgentPort.promptCalls).toHaveLength(2);
    });
  });

  describe('turn retry', () => {
    let retryEvents: RetryEvent[];
    let answerRetry: (event: RetryEvent) => void;

    const request = (overrides: Partial<TurnRequest> = {}) => turnRequest({
      onRetry: (event) => {
        retryEvents.push(event);
        answerRetry(event);
      },
      ...overrides,
    });

    beforeEach(() => {
      retryPolicy = { baseDelayMs: 60_000, maxDelayMs: 60_000, maxTotalMs: 600_000 };
      retryEvents = [];
      answerRetry = event => event.kind === 'scheduled' && queueMicrotask(() => turnRetry.retryNow('conv-1'));
    });

    it('should show the failure, then send the same prompt again with the error', async () => {
      stubAgentPort.promptErrorsToThrow = [new Error('connection lost')];
      stubAgentPort.mockResponses = ['Recovered.'];

      const result = await useCase.execute(request());

      expect(result).toMatchObject({ status: 'completed', response: 'Recovered.' });
      expect(retryEvents[0]).toMatchObject({ kind: 'scheduled', prompt: { roleName: 'CEO', errorMessage: 'connection lost', attempt: 1 } });
      expect(retryEvents.at(-1)).toEqual({ kind: 'ended', reason: 'requested' });
      expect(stubAgentPort.promptCalls).toHaveLength(2);
      expect(stubAgentPort.promptCalls[0]).not.toContain('[RETRY]');
      expect(stubAgentPort.promptCalls[1]).toContain('[RETRY]');
      expect(stubAgentPort.promptCalls[1]).toContain('connection lost');
      expect(stubAgentPort.promptCalls[1]).toContain('Hi');
    });

    it('should hand the CEO what the user wrote to ask for the retry', async () => {
      answerRetry = event => event.kind === 'scheduled' && queueMicrotask(() => turnRetry.retryNow('conv-1', { text: 'I renewed the login.' }));
      stubAgentPort.promptErrorsToThrow = [new Error('token expired')];
      stubAgentPort.mockResponses = ['Recovered.'];

      await useCase.execute(request());

      expect(stubAgentPort.promptCalls[1]).toContain('The user wrote while the retry was waiting: I renewed the login.');
    });

    it('should tell the CEO of its team and board again on the retry, since the failed attempt may not have delivered them', async () => {
      stubAgentPort.promptErrorsToThrow = [new Error('connection lost')];
      stubAgentPort.mockResponses = ['Recovered.'];

      await useCase.execute(request());

      expect(stubAgentPort.promptCalls[0]).toContain(`${idleTeam}${emptyBoard}Hi`);
      expect(stubAgentPort.promptCalls[1]).toContain(`${idleTeam}${emptyBoard}Hi`);
    });

    it('should retry a response that stays invalid after its repair', async () => {
      stubAgentPort.mockResponses = ['Go.</delegate>', 'Again.</delegate>', 'Fixed.'];

      const result = await useCase.execute(request());

      expect(result).toMatchObject({ status: 'completed', response: 'Fixed.' });
      expect(retryEvents[0]).toMatchObject({ kind: 'scheduled', prompt: { errorMessage: 'Invalid CEO response: Found </delegate> without its opening <delegate> tag.' } });
      expect(stubAgentPort.promptCalls[2]).toContain('[RETRY]');
    });

    it('should retry the prompt that carries the answers of the user, without asking the question again', async () => {
      stubAgentPort.mockResponses = ['<question>Which colour?</question>', 'Thanks.'];
      stubAgentPort.promptErrorsToThrow = [null, new Error('connection lost')];
      const onQuestion = rs.fn(() => queueMicrotask(() => questionQueue.submit('conv-1', { kind: 'text', text: 'Red' })));

      const result = await useCase.execute(request({ onQuestion }));

      expect(result).toMatchObject({ status: 'completed', response: 'Thanks.' });
      expect(onQuestion).toHaveBeenCalledTimes(1);
      expect(stubAgentPort.promptCalls).toHaveLength(3);
      expect(stubAgentPort.promptCalls[1]).toContain('kind="other">Red</answer>');
      expect(stubAgentPort.promptCalls[2]).toContain('[RETRY]');
      expect(stubAgentPort.promptCalls[2]).toContain('kind="other">Red</answer>');
    });

    it('should retry the repair of an invalid response with the same repair prompt', async () => {
      stubAgentPort.mockResponses = ['Go.</delegate>', 'Fixed.'];
      stubAgentPort.promptErrorsToThrow = [null, new Error('connection lost')];

      const result = await useCase.execute(request());

      expect(result).toMatchObject({ status: 'completed', response: 'Fixed.' });
      expect(stubAgentPort.promptCalls).toHaveLength(3);
      expect(stubAgentPort.promptCalls[2]).toContain('[RETRY]');
      expect(stubAgentPort.promptCalls[2]).toContain(stubAgentPort.promptCalls[1]);
    });

    it('should read the audio the user sent to ask for the retry like any message', async () => {
      const voice = { name: 'voice.ogg', path: '/tmp/attachments/voice.ogg', contentType: 'audio/ogg', size: 2048 };
      speechToText.transcripts[voice.path] = 'I renewed the login';
      answerRetry = event => event.kind === 'scheduled' && queueMicrotask(() => turnRetry.retryNow('conv-1', { text: '', attachments: [voice] }));
      stubAgentPort.promptErrorsToThrow = [new Error('token expired')];
      stubAgentPort.mockResponses = ['Recovered.'];
      const onTranscription = rs.fn();

      await useCase.execute(request({ onTranscription }));

      expect(stubAgentPort.promptCalls[1]).toContain('The user wrote while the retry was waiting:');
      expect(stubAgentPort.promptCalls[1]).toContain('I renewed the login');
      expect(stubAgentPort.promptCalls[1]).not.toContain('[ATTACHMENTS]');
      expect(onTranscription).toHaveBeenCalledWith({ transcripts: [{ name: 'voice.ogg', text: 'I renewed the login' }], warnings: [] });
      expect(fileSystem.deletedFiles).toEqual([voice.path]);
    });

    it('should repair again, from a new budget, after the retry of a response that stays invalid', async () => {
      answerRetry = event => event.kind === 'scheduled' && queueMicrotask(() => turnRetry.retryNow('conv-1', { text: 'Answer plainly.' }));
      stubAgentPort.mockResponses = ['Go.</delegate>', 'Again.</delegate>', 'Still.</delegate>', 'Fixed.'];

      const result = await useCase.execute(request());

      expect(result).toMatchObject({ status: 'completed', response: 'Fixed.' });
      expect(retryEvents.filter(event => event.kind === 'scheduled')).toHaveLength(1);
      expect(stubAgentPort.promptCalls).toHaveLength(4);
      expect(stubAgentPort.promptCalls[2]).toContain('The user wrote while the retry was waiting: Answer plainly.');
      expect(stubAgentPort.promptCalls[3]).not.toContain('[RETRY]');
    });

    it('should fail the turn with the error as it came when the user ends the retries', async () => {
      answerRetry = event => event.kind === 'scheduled' && queueMicrotask(() => turnRetry.stopRetrying('conv-1'));
      stubAgentPort.promptErrorsToThrow = [new Error('connection lost')];

      const result = await useCase.execute(request());

      expect(result).toMatchObject({ status: 'failed', errorMessage: 'connection lost' });
      expect(stubAgentPort.promptCalls).toHaveLength(1);
      expect(retryEvents.at(-1)).toEqual({ kind: 'ended', reason: 'stopped' });
    });

    it('should fail the turn with the invalid response when the user ends the retries', async () => {
      answerRetry = event => event.kind === 'scheduled' && queueMicrotask(() => turnRetry.stopRetrying('conv-1'));
      stubAgentPort.mockResponses = ['Go.</delegate>', 'Again.</delegate>'];

      const result = await useCase.execute(request());

      expect(result).toMatchObject({ status: 'failed', response: 'Again.</delegate>', errorMessage: 'Invalid CEO response: Found </delegate> without its opening <delegate> tag.' });
    });

    it('should end the turn as cancelled when it is cancelled while the retry waits', async () => {
      answerRetry = event => event.kind === 'scheduled' && queueMicrotask(() => turnRetry.cancel('conv-1'));
      stubAgentPort.promptErrorsToThrow = [new Error('connection lost')];

      const result = await useCase.execute(request());

      expect(result.status).toBe('cancelled');
      expect(retryEvents.at(-1)).toEqual({ kind: 'ended', reason: 'cancelled' });
    });

    it('should keep the work of the delegates that were running while the CEO retried', async () => {
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Build.</delegate>', 'Done.'];
      stubAgentPort.promptErrorsToThrow = [null, new Error('connection lost')];
      delegateStubPort.mockResponses = ['Built.'];

      const result = await useCase.execute(request());

      expect(result).toMatchObject({ status: 'completed', response: 'Done.' });
      expect(delegateStubPort.promptCalls).toHaveLength(1);
    });
  });

  it('should send the skill catalog of the role with its system prompt', async () => {
    agentSkills.skills = { CEO: [{ name: 'board', description: 'Routing the board.', content: 'Route it.' }] };
    stubAgentPort.mockResponses = ['First.', 'Second.'];

    await useCase.execute(turnRequest());
    await useCase.execute(turnRequest({ prompt: 'Again' }));

    expect(stubAgentPort.promptCalls[0]).toContain(`Mock system prompt.\n\n${buildSkillCatalogPrompt([{ name: 'board', description: 'Routing the board.' }], 'tags')}\n\n`);
    expect(stubAgentPort.promptCalls[1]).not.toContain('[SKILLS]');
  });

  it('should tell a role that writes skills how it manages them, even before it has any', async () => {
    agentSkills.writers = ['CEO'];
    stubAgentPort.mockResponses = ['Hello.'];

    await useCase.execute(turnRequest());

    expect(stubAgentPort.promptCalls[0]).toContain(`Mock system prompt.\n\n${buildSkillCatalogPrompt([], 'tags', true)}\n\n`);
  });

  it('should report the skills a delegated agent reads with its role', async () => {
    agentSkills.skills = { DEVELOPER: [{ name: 'testing', description: 'How to test.', content: 'Test it.' }] };
    stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Building" project="my-app">Build it.</delegate>', 'Done.'];
    delegateStubPort.mockResponses = ['<final_response><skill_read name="testing"/></final_response>', 'Built.'];
    const onActivity = rs.fn();

    await useCase.execute(turnRequest({ onActivity }));

    expect(delegateStubPort.promptCalls[1]).toContain('Test it.');
    expect(onActivity).toHaveBeenCalledWith(expect.objectContaining({ kind: 'skill', action: 'read', names: ['testing'], status: 'completed' }), 'DEVELOPER');
  });

  it('should answer a skill request with the skill content in the next prompt', async () => {
    agentSkills.skills = { CEO: [{ name: 'board', description: 'Routing the board.', content: 'Route it.' }] };
    stubAgentPort.mockResponses = ['<final_response><skill_read name="board"/></final_response>', 'Done.'];
    const onActivity = rs.fn();

    const result = await useCase.execute(turnRequest({ onActivity }));

    expect(result.response).toBe('Done.');
    expect(onActivity).toHaveBeenCalledWith(expect.objectContaining({ kind: 'skill', action: 'read', names: ['board'], status: 'completed' }), 'CEO');
    expect(stubAgentPort.promptCalls[1]).toContain('<request_result request="skill_read" name="board" status="ok">\n# Skill: board\n\nRoute it.\n</request_result>');
  });

  it('should send the system prompt only when the CEO ACP session is created', async () => {
    stubAgentPort.mockResponses = ['First.', 'Second.'];

    await useCase.execute(turnRequest());
    await useCase.execute(turnRequest({ prompt: 'Again' }));

    expect(stubAgentPort.createSessionCalls).toHaveLength(1);
    expect(stubAgentPort.promptCalls).toEqual([toCeo(`Mock system prompt.\n\n${idleTeam}${emptyBoard}Hi`), toCeo(`${idleTeam}${emptyBoard}Again`)]);
  });

  it('should send the system prompt again when the first turn failed before the session existed', async () => {
    stubAgentPort.errorToThrowOnCreateSession = new Error('Internal error');
    const failed = await useCase.execute(turnRequest());
    stubAgentPort.errorToThrowOnCreateSession = null;
    stubAgentPort.mockResponses = ['Hello.'];

    await useCase.execute(turnRequest({ prompt: 'Hello?' }));

    expect(failed.status).toBe('failed');
    expect(stubAgentPort.promptCalls).toEqual([toCeo(`Mock system prompt.\n\n${buildPreviousTurnPrompt([`Your previous turn failed: ${failed.errorMessage}`])}\n${idleTeam}${emptyBoard}Hello?`)]);
  });

  it('should isolate agent ports between different threads', async () => {
    stubAgentPort.mockResponses = ['A.'];
    delegateStubPort.mockResponses = ['B.'];

    await useCase.execute(turnRequest({ conversationId: 'conv-th-a', prompt: 'a' }));
    await useCase.execute(turnRequest({ conversationId: 'conv-th-b', prompt: 'b' }));

    expect(stubAgentPort.promptCalls).toEqual([toCeo(`Mock system prompt.\n\n${idleTeam}${emptyBoard}a`)]);
    expect(delegateStubPort.promptCalls).toEqual([toCeo(`Mock system prompt.\n\n${idleTeam}${emptyBoard}b`)]);
  });

  it('should start the next turn with a message that waited for a turn ending with its answer', async () => {
    let releaseFirst: () => void = () => undefined;
    const firstStarted = new Promise<void>((started) => {
      stubAgentPort.prompt = async function* (this: StubAgentPort, text: string) {
        this.promptCalls.push(text);
        if (this.promptCalls.length === 1) {
          started();
          await new Promise<void>((release) => {
            releaseFirst = release;
          });
        }
        yield textChunk(`reply to ${text}`);
      };
    });
    const onDelivery = rs.fn();

    const first = useCase.execute(turnRequest({ conversationId: 'conv-th-1', prompt: 'one' }));
    await firstStarted;
    const second = useCase.execute(turnRequest({ conversationId: 'conv-th-1', prompt: 'two', onDelivery }));
    await rs.waitFor(() => expect(onDelivery).toHaveBeenCalledWith('queued'));

    expect(stubAgentPort.promptCalls).toHaveLength(1);

    releaseFirst();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.response).toBe(`reply to ${toCeo(`Mock system prompt.\n\n${idleTeam}${emptyBoard}one`)}`);
    expect(secondResult).toMatchObject({ status: 'completed', response: `reply to ${toCeo(`${idleTeam}${emptyBoard}two`)}` });
    expect(onDelivery.mock.calls).toEqual([['queued'], ['delivered']]);
  });

  it('should read a message that arrives before the first prompt with it, in a single session', async () => {
    let releaseFirst: () => void = () => undefined;
    const firstStarted = new Promise<void>((started) => {
      stubAgentPort.prompt = async function* (this: StubAgentPort, text: string) {
        this.promptCalls.push(text);
        if (this.promptCalls.length === 1) {
          started();
          await new Promise<void>((release) => {
            releaseFirst = release;
          });
        }
        yield textChunk('ok');
      };
    });

    const onDelivery = rs.fn();
    const first = useCase.execute(turnRequest({ prompt: 'one' }));
    const second = useCase.execute(turnRequest({ prompt: 'two', onDelivery }));
    await firstStarted;
    releaseFirst();
    const [, secondResult] = await Promise.all([first, second]);

    expect(stubAgentPort.promptCalls).toEqual([toCeo(`Mock system prompt.\n\n${idleTeam}${emptyBoard}one\n\n${buildUserMessagePrompt('two')}`)]);
    expect(stubAgentPort.createSessionCalls).toHaveLength(1);
    expect(secondResult).toMatchObject({ status: 'steered', response: '' });
    expect(onDelivery.mock.calls).toEqual([['queued'], ['delivered']]);
  });

  it('should return failed when the session cannot be saved', async () => {
    sessionStore.updateSession = async () => {
      throw new Error('EACCES: permission denied');
    };

    const result = await useCase.execute(turnRequest());

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('EACCES: permission denied');
    expect(stubAgentPort.promptCalls).toHaveLength(0);
  });

  it('should honour a cancellation requested while the delegate is still connecting', async () => {
    stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Go.</delegate>'];
    let finishConnect: () => void = () => undefined;
    const connecting = new Promise<void>((started) => {
      delegateStubPort.connect = async () => {
        started();
        await new Promise<void>((resolve) => {
          finishConnect = resolve;
        });
      };
    });

    const turn = useCase.execute(turnRequest());
    await connecting;

    await expect(runtime.cancel('conv-1')).resolves.toBe(true);
    finishConnect();
    const result = await turn;

    expect(result.status).toBe('cancelled');
    expect(delegateStubPort.promptCalls).toHaveLength(0);
    expect(delegateStubPort.createSessionCalls).toHaveLength(0);
  });

  it('should close the delegate and return cancelled when the delegate prompt is cancelled', async () => {
    stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Go.</delegate>'];
    delegateStubPort.promptErrorToThrow = new PromptCancelledError();

    const result = await useCase.execute(turnRequest());

    expect(result.status).toBe('cancelled');
    expect(delegateStubPort.closeSessionCalls).toBe(1);
    expect(delegateStubPort.connected).toBe(false);
  });

  it('should report a finished delegation without usage when collecting it fails', async () => {
    stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Go.</delegate>', 'Ok.'];
    delegateStubPort.mockResponses = ['Done.'];
    delegateStubPort.usageErrorToThrow = new Error('usage unavailable');
    const events: DelegationEvent[] = [];
    const log = rs.spyOn(Logger.prototype, 'log');

    await useCase.execute(turnRequest({ onDelegation: event => events.push(event) }));
    const messages = log.mock.calls.map(([message]) => String(message));
    log.mockRestore();

    const finished = events.find(event => event.phase === 'finished');
    expect(finished).toMatchObject({ phase: 'finished', response: 'Done.' });
    expect(finished && 'usage' in finished ? finished.usage : undefined).toBeUndefined();
    expect(messages).toContainEqual(expect.stringMatching(/^\[Delegation Finished\] .*, Prompts=1, PromptChars=\d+$/));
  });

  it('should close a cancelled delegation with its own phase', async () => {
    stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Go.</delegate>'];
    delegateStubPort.promptErrorToThrow = new PromptCancelledError();
    const events: DelegationEvent[] = [];

    await useCase.execute(turnRequest({ onDelegation: event => events.push(event) }));

    expect(events.map(event => event.phase)).toEqual(['started', 'cancelled']);
    expect(events[1]).toMatchObject({ delegationId: events[0]!.delegationId, durationMs: expect.any(Number) });
  });

  it('should tag what a turn and its delegates do with the conversation', async () => {
    stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Go.</delegate>', 'Ok.'];
    delegateStubPort.mockResponses = ['Done.'];
    const seen: (string | undefined)[] = [];

    await useCase.execute(turnRequest({ conversationId: 'conv-tagged', onDelegation: () => seen.push(logContext.current()) }));

    expect(seen).toEqual(['conv-tagged', 'conv-tagged']);
    expect(logContext.current()).toBeUndefined();
  });

  it('should pass the summary of a delegation to both of its events', async () => {
    stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app" summary="Adding the login screen">Go.</delegate>', 'Ok.'];
    delegateStubPort.mockResponses = ['Done.'];
    const events: DelegationEvent[] = [];

    await useCase.execute(turnRequest({ onDelegation: event => events.push(event) }));

    expect(events.map(event => event.summary)).toEqual(['Adding the login screen', 'Adding the login screen']);
  });

  it('should forward the activities of every agent and join the text a delegate yields', async () => {
    stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Go.</delegate>', 'Ok.'];
    delegateStubPort.prompt = async function* (this: StubAgentPort) {
      this.emitActivity({ kind: 'thought', id: 't', text: 'thinking' });
      yield textChunk('first ');
      yield textChunk('');
      yield textChunk('second');
    };
    const onActivity = rs.fn();

    await useCase.execute(turnRequest({ onActivity }));

    expect(onActivity).toHaveBeenCalledWith({ kind: 'thought', id: 't', text: 'thinking' }, 'DEVELOPER');
    expect(stubAgentPort.promptCalls[1]).toBe(toCeo('<agent_result role="DEVELOPER" project="my-app" agent="stub" model="default" effort="default">\nfirst second\n</agent_result>'));
    expect(delegateStubPort.activityListeners).toHaveLength(0);
  });

  describe('draft', () => {
    const writeAnswer = (port: StubAgentPort, writes: readonly string[], final: string) => {
      port.prompt = async function* (this: StubAgentPort) {
        writes.forEach(text => this.emitActivity({ kind: 'thought', id: 'm1', text }));
        yield textChunk(final);
      };
    };

    it('should hand the channel what the CEO has written for the user, without the protocol tags', async () => {
      writeAnswer(stubAgentPort, [
        '<user_language>English</user_language>',
        '<user_language>English</user_language>\n\nAll',
        '<user_language>English</user_language>\n\nAll done. <attach',
        '<user_language>English</user_language>\n\nAll done.',
      ], 'All done.');
      const onDraft = rs.fn();

      await useCase.execute(turnRequest({ onDraft }));

      expect(onDraft.mock.calls.map(([text]) => text)).toEqual(['', 'All', 'All done.', 'All done.']);
    });

    it('should hand the channel the answer without the envelope', async () => {
      writeAnswer(stubAgentPort, ['<final_response>Done.'], '<final_response>Done.</final_response>');
      const onDraft = rs.fn();

      const result = await useCase.execute(turnRequest({ onDraft }));

      expect(onDraft).toHaveBeenCalledWith('Done.');
      expect(result.response).toBe('Done.');
    });

    it('should leave out the answers other agents write', async () => {
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Go.</delegate>', 'Ok.'];
      writeAnswer(delegateStubPort, ['The delegate answer'], 'Done.');
      const onDraft = rs.fn();

      await useCase.execute(turnRequest({ onDraft }));

      expect(onDraft).not.toHaveBeenCalled();
    });

    it('should discard the draft before the CEO repairs its response', async () => {
      stubAgentPort.mockResponses = ['<delegate>no role</delegate>', 'Fixed.'];
      const drafts: string[] = [];
      const prompt = stubAgentPort.prompt.bind(stubAgentPort);
      stubAgentPort.prompt = async function* (this: StubAgentPort, text: string) {
        this.emitActivity({ kind: 'thought', id: 'm1', text: `Attempt ${this.promptCalls.length + 1}` });
        yield* prompt(text);
      };

      await useCase.execute(turnRequest({ onDraft: text => drafts.push(text) }));

      expect(drafts).toEqual(['Attempt 1', '', 'Attempt 2']);
    });

    it('should run a turn whose request does not ask for drafts', async () => {
      writeAnswer(stubAgentPort, ['Hi.'], 'Hi.');

      await expect(useCase.execute(turnRequest())).resolves.toMatchObject({ status: 'completed', response: 'Hi.' });
    });
  });

  it('should skip model configuration when the role has no default model', async () => {
    agentRegistry.getDefaultModel.mockReturnValue(undefined);
    stubAgentPort.mockResponses = ['Hi.'];

    await useCase.execute(turnRequest());

    expect(stubAgentPort.configCalls).toHaveLength(0);
  });

  it('should return cancelled when PromptCancelledError is thrown', async () => {
    stubAgentPort.promptErrorToThrow = new PromptCancelledError();

    const result = await useCase.execute(turnRequest());

    expect(result.status).toBe('cancelled');
  });

  it('should treat errors named PromptCancelledError as cancellation', async () => {
    const error = new Error('cancelled');
    error.name = 'PromptCancelledError';
    stubAgentPort.promptErrorToThrow = error;

    const result = await useCase.execute(turnRequest());

    expect(result.status).toBe('cancelled');
  });

  it('should return failed with the error message when a generic error is thrown', async () => {
    stubAgentPort.promptErrorToThrow = new Error('Generic error');

    const result = await useCase.execute(turnRequest());

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('Generic error');
  });

  it('should stringify non-Error failures', async () => {
    stubAgentPort.connect = async () => {
      throw 'raw failure';
    };

    const result = await useCase.execute(turnRequest());

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('raw failure');
  });

  describe('agent tools', () => {
    const toolsOf = (port: StubAgentPort, call = 0) => toolSessions.find(credentialOf(port.mcpServersSent[call]));
    /** Runs `inspect` when the port is prompted, while the session it opened is live. */
    const onPrompt = (port: StubAgentPort, inspect: () => void) => {
      const prompt = port.prompt.bind(port);
      port.prompt = async function* (text: string) {
        inspect();
        yield* prompt(text);
      };
    };

    afterEach(() => {
      rs.unstubAllEnvs();
    });

    it('should attach the tools to the CEO session it creates, acting for the CEO, and keep them while its port lives', async () => {
      stubAgentPort.supportsHttpMcp = true;
      stubAgentPort.mockResponses = ['Hi.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.mcpServersSent).toEqual([[{ name: 'arc', url: TOOLS_URL, headers: { authorization: expect.stringMatching(/^Bearer [\w-]{43}$/) } }]]);
      expect(toolsOf(stubAgentPort)?.requester).toEqual({ role: 'CEO', roleName: 'CEO', conversationId: 'conv-1', agentInterface: 'tools' });
    });

    it('should attach the tools again to a session it loads', async () => {
      await sessionStore.seed(buildSessionContext({ agentSessions: [{ role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null, artifactId: null }] }));
      stubAgentPort.supportsHttpMcp = true;
      stubAgentPort.mockResponses = ['Hi.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.loadSessionCalls).toEqual([{ cwd: '/mock/workspace', sessionId: 'conv-old' }]);
      expect(toolsOf(stubAgentPort)?.requester.role).toBe('CEO');
    });

    it('should open one tool session for both the failed load and the session created in its place', async () => {
      await sessionStore.seed(buildSessionContext({ agentSessions: [{ role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null, artifactId: null }] }));
      stubAgentPort.supportsHttpMcp = true;
      stubAgentPort.loadSessionResult = false;
      stubAgentPort.mockResponses = ['Hi.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.mcpServersSent).toHaveLength(2);
      expect(stubAgentPort.mcpServersSent[1]).toEqual(stubAgentPort.mcpServersSent[0]);
    });

    it('should attach nothing to an agent that does not take HTTP MCP servers', async () => {
      stubAgentPort.mockResponses = ['Hi.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.mcpServersSent).toEqual([[]]);
    });

    it('should attach nothing with AGENT_MCP_ENABLED=false', async () => {
      rs.stubEnv('AGENT_MCP_ENABLED', 'false');
      stubAgentPort.supportsHttpMcp = true;
      stubAgentPort.mockResponses = ['Hi.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.mcpServersSent).toEqual([[]]);
    });

    it('should send the skill activity of the CEO tools to the turn running now', async () => {
      stubAgentPort.supportsHttpMcp = true;
      stubAgentPort.mockResponses = ['Hi.', 'Again.'];
      const first = rs.fn();
      const second = rs.fn();
      await useCase.execute(turnRequest({ onActivity: first }));
      await useCase.execute(turnRequest({ onActivity: second }));
      const activity = { kind: 'skill' as const, id: 's-1', action: 'read' as const, names: ['a'], status: 'completed' as const };

      toolsOf(stubAgentPort)?.onSkill?.(activity);

      expect(stubAgentPort.mcpServersSent).toHaveLength(1);
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledWith(activity, 'CEO');
    });

    it('should give a delegated agent tools that act for its delegation and close them when its work ends', async () => {
      delegateStubPort.supportsHttpMcp = true;
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Implement login.</delegate>', 'Done.'];
      delegateStubPort.mockResponses = ['Login implemented.'];
      let whileWorking: ReturnType<typeof toolsOf>;
      onPrompt(delegateStubPort, () => {
        whileWorking = toolsOf(delegateStubPort);
      });

      await useCase.execute(turnRequest());

      expect(whileWorking!.requester).toEqual({ role: 'DEVELOPER', roleName: 'DEVELOPER', conversationId: 'conv-1', delegationId: expect.any(String), agentInterface: 'tools' });
      expect(toolsOf(delegateStubPort)).toBeUndefined();
    });

    describe('the interface of the session', () => {
      const testing = { name: 'testing', description: 'How to test.', content: 'Test it.' };
      const seedDeveloper = (agentInterface: 'tags' | 'tools') => sessionStore.seed(buildSessionContext({
        agentSessions: [
          {
            role: 'DEVELOPER',
            agentId: 'stub',
            sessionId: 'dev-old',
            projectName: 'my-app',
            artifactId: null,
            ...promptHashOf(`DEVELOPER ${agentInterface} prompt\n\n${buildSkillCatalogPrompt([testing], agentInterface)}`),
          },
        ],
      }));

      beforeEach(() => {
        agentRegistry.getSystemPrompt.mockImplementation((role: string, agentInterface: string) => `${role} ${agentInterface} prompt`);
        agentRegistry.getReentryNote.mockImplementation((role: string, agentInterface: string) => `[RE-ENTRY] ${role} ${agentInterface}`);
        agentSkills.skills = { CEO: [testing], DEVELOPER: [testing] };
      });

      it('should write the system prompt and the skill catalog of a session with tools for the tools interface', async () => {
        stubAgentPort.supportsHttpMcp = true;
        stubAgentPort.mockResponses = ['Hi.'];

        await useCase.execute(turnRequest());

        expect(stubAgentPort.promptCalls[0]).toBe(toCeo(`CEO tools prompt\n\n${buildSkillCatalogPrompt([testing], 'tools')}\n\n${idleTeam}${emptyBoard}Hi`));
      });

      it('should write the re-entry note and the catalog of a resumed session with tools for the tools interface', async () => {
        seedDeveloper('tools');
        delegateStubPort.supportsHttpMcp = true;
        stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Fix it.</delegate>', 'Done.'];
        delegateStubPort.mockResponses = ['Fixed.'];

        await useCase.execute(turnRequest());

        expect(delegateStubPort.promptCalls[0]).toBe(toAgent(`[RE-ENTRY] DEVELOPER tools\n\n${buildSkillCatalogPrompt([testing], 'tools')}\n\nFix it.`));
      });

      it('should keep the tags interface for an agent that does not take HTTP MCP servers', async () => {
        seedDeveloper('tags');
        stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Fix it.</delegate>', 'Done.'];
        delegateStubPort.mockResponses = ['Fixed.'];

        await useCase.execute(turnRequest());

        expect(stubAgentPort.promptCalls[0]).toBe(toCeo(`CEO tags prompt\n\n${buildSkillCatalogPrompt([testing], 'tags')}\n\n${idleTeam}${emptyBoard}Hi`));
        expect(delegateStubPort.promptCalls[0]).toBe(toAgent(`[RE-ENTRY] DEVELOPER tags\n\n${buildSkillCatalogPrompt([testing], 'tags')}\n\nFix it.`));
      });

      it('should keep the tags interface with AGENT_MCP_ENABLED=false', async () => {
        rs.stubEnv('AGENT_MCP_ENABLED', 'false');
        stubAgentPort.supportsHttpMcp = true;
        stubAgentPort.mockResponses = ['Hi.'];

        await useCase.execute(turnRequest());

        expect(stubAgentPort.promptCalls[0]).toBe(toCeo(`CEO tags prompt\n\n${buildSkillCatalogPrompt([testing], 'tags')}\n\n${idleTeam}${emptyBoard}Hi`));
      });

      it('should write the system prompt of a live CEO session with tools for the tools interface on every message', async () => {
        stubAgentPort.supportsHttpMcp = true;
        agentRegistry.isSystemPromptEveryTurn.mockReturnValue(true);
        stubAgentPort.mockResponses = ['Hi.', 'Again.'];

        await useCase.execute(turnRequest());
        await useCase.execute(turnRequest({ prompt: 'Again' }));

        expect(stubAgentPort.promptCalls[1]).toContain('CEO tools prompt');
      });

      it('should read a skill requested with a tag in the variant of the session that requested it', async () => {
        delegateStubPort.supportsHttpMcp = true;
        stubAgentPort.mockResponses = ['<skill_read name="testing"/>', '<delegate role="DEVELOPER" summary="Working on it" project="my-app">Fix it.</delegate>', 'Done.'];
        delegateStubPort.mockResponses = ['<skill_read name="testing"/>', 'Fixed.'];

        await useCase.execute(turnRequest());

        expect(agentSkills.readInterfaces).toEqual(['tags', 'tools']);
      });
    });
  });

  describe('agent session recovery', () => {
    const persistedSession = () =>
      sessionStore.seed(buildSessionContext({ agentSessions: [{ role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null, artifactId: null, ...mockPrompt }] }));
    const storedAgentSessions = async () => (await sessionStore.findSession('conv-1'))?.agentSessions;

    it('should persist the agent session id created for a new conversation', async () => {
      stubAgentPort.mockResponses = ['Hi.'];

      await useCase.execute(turnRequest());

      expect(await storedAgentSessions()).toEqual([{ role: 'CEO', agentId: 'stub', sessionId: 'session-1', projectName: null, artifactId: null, ...mockPrompt }]);
    });

    it('should resume the persisted agent session without resending the system prompt', async () => {
      await persistedSession();
      stubAgentPort.mockResponses = ['Welcome back.'];

      await useCase.execute(turnRequest({ prompt: 'Continue' }));

      expect(stubAgentPort.loadSessionCalls).toEqual([{ cwd: '/mock/workspace', sessionId: 'conv-old' }]);
      expect(stubAgentPort.createSessionCalls).toHaveLength(0);
      expect(stubAgentPort.promptCalls).toEqual([toCeo(`${idleTeam}${emptyBoard}Continue`)]);
      expect(await storedAgentSessions()).toEqual([{ role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null, artifactId: null, ...mockPrompt }]);
    });

    it('should resend the system prompt with every user message of a role that asks for it, even when resumed', async () => {
      await persistedSession();
      agentRegistry.isSystemPromptEveryTurn.mockImplementation((role: string) => role === 'CEO');
      agentRegistry.getSystemPrompt.mockImplementation((role: string) => `${role} prompt`);
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Go.</delegate>', 'Done.'];
      delegateStubPort.mockResponses = ['Implemented.'];

      await useCase.execute(turnRequest({ prompt: 'Continue' }));

      expect(stubAgentPort.createSessionCalls).toHaveLength(0);
      expect(stubAgentPort.promptCalls).toEqual([
        toCeo(`CEO prompt\n\n${idleTeam}${emptyBoard}Continue`),
        toCeo('<agent_result role="DEVELOPER" project="my-app" agent="stub" model="default" effort="default">\nImplemented.\n</agent_result>'),
      ]);
      expect(delegateStubPort.promptCalls).toEqual([toAgent('DEVELOPER prompt\n\nGo.')]);
    });

    it('should not resend the system prompt with the repair prompt of a role that asks for it every user message', async () => {
      await persistedSession();
      agentRegistry.isSystemPromptEveryTurn.mockReturnValue(true);
      stubAgentPort.mockResponses = ['Go.</delegate>', 'Fixed.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls[1]).toMatch(/^\[DELEGATION_ERROR\]/);
    });

    it('should create a new session and store its id when the load fails', async () => {
      await persistedSession();
      stubAgentPort.loadSessionResult = false;
      stubAgentPort.mockResponses = ['Fresh start.'];

      await useCase.execute(turnRequest({ prompt: 'Continue' }));

      expect(stubAgentPort.createSessionCalls).toEqual(['/mock/workspace']);
      expect(stubAgentPort.promptCalls).toEqual([toCeo(`Mock system prompt.\n\n${idleTeam}${emptyBoard}Continue`)]);
      expect(await storedAgentSessions()).toEqual([{ role: 'CEO', agentId: 'stub', sessionId: 'session-1', projectName: null, artifactId: null, ...mockPrompt }]);
    });

    it('should persist the delegate session id alongside the CEO session id', async () => {
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Go.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['Done.'];

      await useCase.execute(turnRequest());

      expect(delegateStubPort.loadSessionCalls).toHaveLength(0);
      expect(await storedAgentSessions()).toEqual([
        { role: 'CEO', agentId: 'stub', sessionId: 'session-1', projectName: null, artifactId: null, ...mockPrompt },
        { role: 'DEVELOPER', agentId: 'stub', sessionId: 'session-1', projectName: 'my-app', artifactId: null, ...mockPrompt },
      ]);
    });

    it('should resume the stored delegate session without resending the system prompt', async () => {
      sessionStore.seed(buildSessionContext({
        agentSessions: [{ role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null, artifactId: null, ...mockPrompt }, { role: 'DEVELOPER', agentId: 'stub', sessionId: 'dev-old', projectName: 'my-app', artifactId: null, ...mockPrompt }],
      }));
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Fix it.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['Fixed.'];

      await useCase.execute(turnRequest());

      expect(delegateStubPort.loadSessionCalls).toEqual([{ cwd: '/mock/workspace/my-app', sessionId: 'dev-old' }]);
      expect(delegateStubPort.createSessionCalls).toHaveLength(0);
      expect(delegateStubPort.promptCalls).toEqual([toAgent('Fix it.')]);
      expect(await storedAgentSessions()).toEqual([
        { role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null, artifactId: null, ...mockPrompt },
        { role: 'DEVELOPER', agentId: 'stub', sessionId: 'dev-old', projectName: 'my-app', artifactId: null, ...mockPrompt },
      ]);
    });

    it('should start a fresh delegate session when sessionMode is new in delegation marker', async () => {
      sessionStore.seed(buildSessionContext({
        agentSessions: [{ role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null, artifactId: null, ...mockPrompt }, { role: 'DEVELOPER', agentId: 'stub', sessionId: 'dev-old', projectName: 'my-app', artifactId: null, ...mockPrompt }],
      }));
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app" session="new">Fix it from scratch.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['Fixed.'];

      await useCase.execute(turnRequest());

      expect(delegateStubPort.loadSessionCalls).toHaveLength(0);
      expect(delegateStubPort.createSessionCalls).toEqual(['/mock/workspace/my-app']);
      expect(delegateStubPort.promptCalls).toEqual([toAgent('Mock system prompt.\n\nFix it from scratch.')]);
      expect(await storedAgentSessions()).toEqual([
        { role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null, artifactId: null, ...mockPrompt },
        { role: 'DEVELOPER', agentId: 'stub', sessionId: 'session-1', projectName: 'my-app', artifactId: null, ...mockPrompt },
      ]);
    });

    it('should start a fresh delegate session when persona defaults to new session mode', async () => {
      sessionStore.seed(buildSessionContext({
        agentSessions: [{ role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null, artifactId: null, ...mockPrompt }, { role: 'CODE_REVIEWER', agentId: 'stub', sessionId: 'rev-old', projectName: 'my-app', artifactId: null, ...mockPrompt }],
      }));
      stubAgentPort.mockResponses = ['<delegate role="CODE_REVIEWER" summary="Working on it" project="my-app">Review it.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['Reviewed.'];

      await useCase.execute(turnRequest());

      expect(delegateStubPort.loadSessionCalls).toHaveLength(0);
      expect(delegateStubPort.createSessionCalls).toEqual(['/mock/workspace/my-app']);
      expect(delegateStubPort.promptCalls).toEqual([toAgent('Mock system prompt.\n\nReview it.')]);
      expect(await storedAgentSessions()).toEqual([
        { role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null, artifactId: null, ...mockPrompt },
        { role: 'CODE_REVIEWER', agentId: 'stub', sessionId: 'session-1', projectName: 'my-app', artifactId: null, ...mockPrompt },
      ]);
    });

    it('should resume the delegate session created in an earlier round of the same turn', async () => {
      stubAgentPort.mockResponses = [
        '<delegate role="DEVELOPER" summary="Working on it" project="my-app">Build it.</delegate>',
        '<delegate role="DEVELOPER" summary="Working on it" project="my-app">Now test it.</delegate>',
        'Ok.',
      ];
      delegateStubPort.mockResponses = ['Built.', 'Tested.'];

      await useCase.execute(turnRequest());

      expect(delegateStubPort.createSessionCalls).toEqual(['/mock/workspace/my-app']);
      expect(delegateStubPort.loadSessionCalls).toEqual([{ cwd: '/mock/workspace/my-app', sessionId: 'session-1' }]);
      expect(delegateStubPort.promptCalls).toEqual([toAgent('Mock system prompt.\n\nBuild it.'), toAgent('Now test it.')]);
    });

    it('should replace only the delegate role session when its load fails', async () => {
      sessionStore.seed(buildSessionContext({
        agentSessions: [
          { role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null, artifactId: null, ...mockPrompt },
          { role: 'DEVELOPER', agentId: 'stub', sessionId: 'dev-old', projectName: 'my-app', artifactId: null, ...mockPrompt },
          { role: 'REVIEWER', agentId: 'stub', sessionId: 'rev-old', projectName: null, artifactId: null },
        ],
      }));
      delegateStubPort.loadSessionResult = false;
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Go.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['Done.'];

      await useCase.execute(turnRequest());

      expect(delegateStubPort.promptCalls).toEqual([toAgent('Mock system prompt.\n\nGo.')]);
      expect(await storedAgentSessions()).toEqual([
        { role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null, artifactId: null, ...mockPrompt },
        { role: 'REVIEWER', agentId: 'stub', sessionId: 'rev-old', projectName: null, artifactId: null },
        { role: 'DEVELOPER', agentId: 'stub', sessionId: 'session-1', projectName: 'my-app', artifactId: null, ...mockPrompt },
      ]);
    });

    it('should keep the CEO agent connected when the turn fails', async () => {
      stubAgentPort.promptErrorToThrow = new Error('agent crashed');
      stubAgentPort.currentSessionId = 'session-live';

      await useCase.execute(turnRequest());

      expect(stubAgentPort.connected).toBe(true);
      expect(stubAgentPort.currentSessionId).toBe('session-live');
    });

    it('should keep the CEO agent connected when the turn is cancelled', async () => {
      stubAgentPort.promptErrorToThrow = new PromptCancelledError();

      await useCase.execute(turnRequest());

      expect(stubAgentPort.connected).toBe(true);
    });
  });

  describe('agent settings', () => {
    const settings = buildStubSettings({
      CEO: buildStubProfile('stub', {
        agentName: 'Stub Agent',
        modelId: 'm-fast',
        modelName: 'Fast Model',
        effortId: 'high',
        effortName: 'High',
      }),
    });

    it('should apply the global settings to the CEO and to delegates', async () => {
      settingsStore.settings = settings;
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Go.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['Done.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.configCalls).toContainEqual({ modelId: 'm-fast', effortId: 'high' });
      expect(delegateStubPort.configCalls).toEqual([{ modelId: 'm-fast', effortId: 'high' }]);
      expect(agentRegistry.getDefaultModel).not.toHaveBeenCalled();
    });

    it('should omit the effort when the selected model has none', async () => {
      settingsStore.settings = buildStubSettings({
        CEO: { ...settings.profiles.CEO!, effortId: null, effortName: null },
      });
      stubAgentPort.mockResponses = ['Hi.'];

      const result = await useCase.execute(turnRequest());

      expect(stubAgentPort.configCalls).toEqual([{ modelId: 'm-fast', effortId: undefined }]);
      expect(result.agentInfo).toEqual({
        roleName: 'CEO',
        agentName: 'stub',
        modelName: 'Fast Model',
        effortName: undefined,
      });
    });

    it('should report the configured model and effort on every status', async () => {
      settingsStore.settings = settings;
      const expected = {
        roleName: 'CEO',
        agentName: 'stub',
        modelName: 'Fast Model',
        effortName: 'High',
      };

      stubAgentPort.mockResponses = ['Hi.'];
      const completed = await useCase.execute(turnRequest({ conversationId: 'conv-a' }));
      stubAgentPort.promptErrorToThrow = new PromptCancelledError();
      const cancelled = await useCase.execute(turnRequest({ conversationId: 'conv-a' }));
      stubAgentPort.promptErrorToThrow = new Error('boom');
      const failed = await useCase.execute(turnRequest({ conversationId: 'conv-a' }));

      expect(completed.agentInfo).toEqual(expected);
      expect(cancelled.agentInfo).toEqual(expected);
      expect(failed.agentInfo).toEqual(expected);
    });

    it('should report the agent current model when there are no settings', async () => {
      stubAgentPort.modelsToReturn = {
        availableModels: [
          { modelId: 'm1', name: 'm1', displayName: 'Model One' },
          { modelId: 'm2', name: 'm2', displayName: 'Model Two' },
        ],
        currentModelId: 'm2',
      };
      stubAgentPort.mockResponses = ['Hi.'];

      const result = await useCase.execute(turnRequest());

      expect(result.agentInfo?.modelName).toBe('Model Two');
      expect(result.agentInfo?.effortName).toBeUndefined();
    });
  });

  describe('agent selection', () => {
    const settingsOf = (overrides: Partial<AgentProfileSettings> = {}): AgentSettings =>
      buildStubSettings({
        CEO: buildStubProfile('other', {
          agentName: 'Other Agent',
          modelId: 'opus',
          modelName: 'Opus',
          ...overrides,
        }),
      });
    const storedAgentSessions = async () => (await sessionStore.findSession('conv-1'))?.agentSessions;

    it('should run the CEO and create delegates with the agent of the settings', async () => {
      settingsStore.settings = settingsOf();
      stubAgentPort.agentName = 'other';
      delegateStubPort.agentName = 'other';
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Go.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['Done.'];
      const events: DelegationEvent[] = [];

      const result = await useCase.execute(turnRequest({ onDelegation: event => events.push(event) }));

      expect(portFactory.createdAgentIds).toEqual(['other', 'other']);
      expect(stubAgentPort.configCalls).toContainEqual({ modelId: 'opus', effortId: undefined });
      expect(delegateStubPort.configCalls).toEqual([{ modelId: 'opus', effortId: undefined }]);
      expect(result.agentInfo).toMatchObject({ agentName: 'other', modelName: 'Opus' });
      expect(events.find(event => event.phase === 'finished')).toMatchObject({
        agentInfo: { agentName: 'other', modelName: 'Opus' },
      });
    });

    it('should use the factory default agent when there are no settings', async () => {
      portFactory.defaultAgentId = 'fallback';
      stubAgentPort.agentName = 'fallback';
      delegateStubPort.agentName = 'fallback';
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Go.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['Done.'];

      const result = await useCase.execute(turnRequest());

      expect(portFactory.createdAgentIds).toEqual(['fallback', 'fallback']);
      expect(result.agentInfo?.agentName).toBe('fallback');
    });

    it('should not evaluate the factory default agent when the role has a saved profile', async () => {
      settingsStore.settings = settingsOf({ agentId: 'stub' });
      stubAgentPort.mockResponses = ['Hi.'];

      await useCase.execute(turnRequest());

      expect(portFactory.defaultAgentIdReads).toBe(0);
    });

    it('should apply the role default model when the settings carry only the agent', async () => {
      settingsStore.settings = settingsOf({ agentId: 'stub', modelId: null, modelName: null });
      stubAgentPort.modelsToReturn = {
        availableModels: [{ modelId: 'current', name: 'current', displayName: 'Current Model' }],
        currentModelId: 'current',
      };
      stubAgentPort.mockResponses = ['Hi.'];

      const result = await useCase.execute(turnRequest());

      expect(stubAgentPort.configCalls).toEqual([{ modelId: 'mock-model-v1' }]);
      expect(result.agentInfo).toEqual({
        roleName: 'CEO',
        agentName: 'stub',
        modelName: 'Current Model',
        effortName: undefined,
      });
    });

    it('should ignore settings saved for a different agent than the one running', async () => {
      settingsStore.settings = settingsOf({ effortId: 'high', effortName: 'High' });
      stubAgentPort.modelsToReturn = {
        availableModels: [{ modelId: 'current', name: 'current', displayName: 'Current Model' }],
        currentModelId: 'current',
      };
      stubAgentPort.mockResponses = ['Hi.'];

      const result = await useCase.execute(turnRequest());

      expect(stubAgentPort.agentName).toBe('stub');
      expect(stubAgentPort.configCalls).toEqual([{ modelId: 'mock-model-v1' }]);
      expect(result.agentInfo).toEqual({
        roleName: 'CEO',
        agentName: 'stub',
        modelName: 'Current Model',
        effortName: undefined,
      });
    });

    it('should fail with the selected agent in the footer when the turn fails before any CEO port exists', async () => {
      settingsStore.load = async () => {
        throw new Error('settings unreadable');
      };

      const result = await useCase.execute(turnRequest());

      expect(result).toEqual({
        response: '',
        status: 'failed',
        errorMessage: 'settings unreadable',
        agentInfo: { roleName: 'CEO', agentName: 'stub' },
        usage: undefined,
      });
      expect(portFactory.createdAgentIds).toHaveLength(0);
    });

    it('should persist the session ids under the agent that created them', async () => {
      settingsStore.settings = settingsOf();
      stubAgentPort.agentName = 'other';
      delegateStubPort.agentName = 'other';
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Go.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['Done.'];

      await useCase.execute(turnRequest());

      expect(await storedAgentSessions()).toEqual([
        { role: 'CEO', agentId: 'other', sessionId: 'session-1', projectName: null, artifactId: null, ...mockPrompt },
        { role: 'DEVELOPER', agentId: 'other', sessionId: 'session-1', projectName: 'my-app', artifactId: null, ...mockPrompt },
      ]);
    });

    it('should not resume a session stored for another agent and keep its entry', async () => {
      sessionStore.seed(buildSessionContext({
        agentSessions: [{ role: 'CEO', agentId: 'agy', sessionId: 'agy-old', projectName: null, artifactId: null }],
      }));
      stubAgentPort.mockResponses = ['Hi.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.loadSessionCalls).toHaveLength(0);
      expect(stubAgentPort.createSessionCalls).toEqual(['/mock/workspace']);
      expect(await storedAgentSessions()).toEqual([
        { role: 'CEO', agentId: 'agy', sessionId: 'agy-old', projectName: null, artifactId: null },
        { role: 'CEO', agentId: 'stub', sessionId: 'session-1', projectName: null, artifactId: null, ...mockPrompt },
      ]);
    });

    it('should resume the session of the running agent among several stored agents', async () => {
      sessionStore.seed(buildSessionContext({
        agentSessions: [
          { role: 'CEO', agentId: 'agy', sessionId: 'agy-old', projectName: null, artifactId: null },
          { role: 'CEO', agentId: 'stub', sessionId: 'stub-old', projectName: null, artifactId: null, ...mockPrompt },
        ],
      }));
      stubAgentPort.mockResponses = ['Hi.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.loadSessionCalls).toEqual([{ cwd: '/mock/workspace', sessionId: 'stub-old' }]);
      expect(await storedAgentSessions()).toEqual([
        { role: 'CEO', agentId: 'agy', sessionId: 'agy-old', projectName: null, artifactId: null },
        { role: 'CEO', agentId: 'stub', sessionId: 'stub-old', projectName: null, artifactId: null, ...mockPrompt },
      ]);
    });

    it('should replace only the entry of the same role and agent when a session is rebound', async () => {
      sessionStore.seed(buildSessionContext({
        agentSessions: [
          { role: 'CEO', agentId: 'agy', sessionId: 'agy-old', projectName: null, artifactId: null },
          { role: 'CEO', agentId: 'stub', sessionId: 'stub-old', projectName: null, artifactId: null, ...mockPrompt },
        ],
      }));
      stubAgentPort.loadSessionResult = false;
      stubAgentPort.mockResponses = ['Hi.'];

      await useCase.execute(turnRequest());

      expect(await storedAgentSessions()).toEqual([
        { role: 'CEO', agentId: 'agy', sessionId: 'agy-old', projectName: null, artifactId: null },
        { role: 'CEO', agentId: 'stub', sessionId: 'session-1', projectName: null, artifactId: null, ...mockPrompt },
      ]);
    });

    it('should switch the CEO agent between turns keeping both agents sessions', async () => {
      const portsByAgent = new Map<string, StubAgentPort>();
      const switchingFactory = new StubAgentPortFactory((agentId) => {
        const port = new StubAgentPort();
        port.agentName = agentId;
        port.mockResponses = [`reply from ${agentId}`];
        portsByAgent.set(agentId, port);
        return port;
      });
      wire(switchingFactory);

      const first = await useCase.execute(turnRequest());
      settingsStore.settings = settingsOf({ modelId: null, modelName: null });
      const second = await useCase.execute(turnRequest({ prompt: 'Again' }));

      expect(first.response).toBe('reply from stub');
      expect(second.response).toBe('reply from other');
      expect(second.agentInfo?.agentName).toBe('other');
      expect(portsByAgent.get('stub')!.closeSessionCalls).toBe(1);
      expect(portsByAgent.get('stub')!.connected).toBe(false);
      expect(await storedAgentSessions()).toEqual([
        { role: 'CEO', agentId: 'stub', sessionId: 'session-1', projectName: null, artifactId: null, ...mockPrompt },
        { role: 'CEO', agentId: 'other', sessionId: 'session-1', projectName: null, artifactId: null, ...mockPrompt },
      ]);
    });
  });

  describe('per-role profiles', () => {
    const ceoProfile = buildStubProfile('stub', { modelId: 'opus', modelName: 'Opus' });
    const developerProfile = (agentId: string, modelId = 'flash') =>
      buildStubProfile(agentId, { modelId, modelName: modelId.toUpperCase(), effortId: 'low', effortName: 'Low' });
    const storedAgentSessions = async () => (await sessionStore.findSession('conv-1'))?.agentSessions;
    let created: StubAgentPort[];
    let responses: Map<string, string[]>;
    const portsOf = (agentId: string) => created.filter(port => port.agentName === agentId);

    beforeEach(() => {
      created = [];
      responses = new Map();
      portFactory = new StubAgentPortFactory((agentId) => {
        const port = new StubAgentPort();
        port.agentName = agentId;
        port.mockResponses = responses.get(agentId) ?? [];
        created.push(port);
        return port;
      });
      wire(portFactory);
    });

    it('should tell the CEO which agent, model and effort ran a delegate and which are running', async () => {
      settingsStore.settings = buildStubSettings({ CEO: ceoProfile, DEVELOPER: developerProfile('dev-a') });
      responses.set('stub', ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Go.</delegate>', 'Ok.']);
      responses.set('dev-a', ['Done.']);
      let running: string | undefined;
      const originalRegister = runtime.registerDelegation.bind(runtime);
      runtime.registerDelegation = (conversationKey, delegation) => {
        running = `${delegation.agentInfo.agentName}/${delegation.agentInfo.modelName}/${delegation.agentInfo.effortName}`;
        originalRegister(conversationKey, delegation);
      };

      await useCase.execute(turnRequest());

      expect(running).toBe('dev-a/FLASH/Low');
      expect(portsOf('stub')[0].promptCalls[1]).toContain(
        '<agent_result role="DEVELOPER" project="my-app" agent="dev-a" model="FLASH" effort="Low">\nDone.\n</agent_result>',
      );
    });

    it('should keep the agent, model and effort a delegate started with when the settings change meanwhile', async () => {
      settingsStore.settings = buildStubSettings({ CEO: ceoProfile, DEVELOPER: developerProfile('dev-a') });
      responses.set('stub', ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Go.</delegate>', 'Ok.']);
      const developer = new StubAgentPort();
      developer.agentName = 'dev-a';
      developer.prompt = async function* () {
        settingsStore.settings = buildStubSettings({ DEVELOPER: developerProfile('dev-a', 'pro') });
        yield textChunk('Done.');
      };
      portFactory = new StubAgentPortFactory((agentId) => {
        if (agentId === 'dev-a') {
          return developer;
        }
        const port = new StubAgentPort();
        port.agentName = agentId;
        port.mockResponses = responses.get(agentId) ?? [];
        created.push(port);
        return port;
      });
      wire(portFactory);

      await useCase.execute(turnRequest());

      expect(created[0].promptCalls[1]).toContain('agent="dev-a" model="FLASH" effort="Low"');
    });

    it('should label a delegate without a configured model or effort as default', async () => {
      responses.set('stub', ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Go.</delegate>', 'Ok.']);

      await useCase.execute(turnRequest());

      expect(created[0].promptCalls[1]).toContain('agent="stub" model="default" effort="default"');
    });

    it('should run the CEO and a delegate on the agents of their own profiles', async () => {
      settingsStore.settings = buildStubSettings({ CEO: ceoProfile, DEVELOPER: developerProfile('dev-a') });
      responses.set('stub', ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Go.</delegate>', 'Ok.']);
      responses.set('dev-a', ['Done.']);
      const events: DelegationEvent[] = [];

      const result = await useCase.execute(turnRequest({ onDelegation: event => events.push(event) }));

      expect(portFactory.createdAgentIds).toEqual(['stub', 'dev-a']);
      expect(portsOf('stub')[0].configCalls).toEqual([
        { modelId: 'opus', effortId: undefined },
        { modelId: 'opus', effortId: undefined },
      ]);
      expect(portsOf('dev-a')[0].configCalls).toEqual([{ modelId: 'flash', effortId: 'low' }]);
      expect(result.agentInfo).toEqual({ roleName: 'CEO', agentName: 'stub', modelName: 'Opus', effortName: undefined });
      expect(events.find(event => event.phase === 'finished')?.agentInfo).toEqual({
        roleName: 'DEVELOPER',
        agentName: 'dev-a',
        modelName: 'FLASH',
        effortName: 'Low',
      });
      expect(await storedAgentSessions()).toEqual([
        { role: 'CEO', agentId: 'stub', sessionId: 'session-1', projectName: null, artifactId: null, ...mockPrompt },
        { role: 'DEVELOPER', agentId: 'dev-a', sessionId: 'session-1', projectName: 'my-app', artifactId: null, ...mockPrompt },
      ]);
    });

    it('should resolve the delegate agent at delegation start and open a new session for a new agent', async () => {
      settingsStore.settings = buildStubSettings({ CEO: ceoProfile, DEVELOPER: developerProfile('dev-a') });
      responses.set('stub', [
        '<delegate role="DEVELOPER" summary="Working on it" project="my-app">Build it.</delegate>',
        '<delegate role="DEVELOPER" summary="Working on it" project="my-app">Test it.</delegate>',
        'Ok.',
      ]);
      responses.set('dev-a', ['Built.']);
      responses.set('dev-b', ['Tested.']);
      const switchDeveloperAgent = (event: DelegationEvent) => {
        if (event.phase === 'finished') {
          settingsStore.settings = buildStubSettings({ CEO: ceoProfile, DEVELOPER: developerProfile('dev-b') });
        }
      };

      await useCase.execute(turnRequest({ onDelegation: switchDeveloperAgent }));

      expect(portFactory.createdAgentIds).toEqual(['stub', 'dev-a', 'dev-b']);
      expect(portsOf('dev-b')[0].loadSessionCalls).toHaveLength(0);
      expect(portsOf('dev-b')[0].createSessionCalls).toEqual(['/mock/workspace/my-app']);
      expect(await storedAgentSessions()).toEqual([
        { role: 'CEO', agentId: 'stub', sessionId: 'session-1', projectName: null, artifactId: null, ...mockPrompt },
        { role: 'DEVELOPER', agentId: 'dev-a', sessionId: 'session-1', projectName: 'my-app', artifactId: null, ...mockPrompt },
        { role: 'DEVELOPER', agentId: 'dev-b', sessionId: 'session-1', projectName: 'my-app', artifactId: null, ...mockPrompt },
      ]);
    });

    it('should keep the delegate session and reapply the config when only the model changes', async () => {
      settingsStore.settings = buildStubSettings({ CEO: ceoProfile, DEVELOPER: developerProfile('dev-a') });
      responses.set('stub', [
        '<delegate role="DEVELOPER" summary="Working on it" project="my-app">Build it.</delegate>',
        '<delegate role="DEVELOPER" summary="Working on it" project="my-app">Test it.</delegate>',
        'Ok.',
      ]);
      responses.set('dev-a', ['Built.', 'Tested.']);
      const switchDeveloperModel = (event: DelegationEvent) => {
        if (event.phase === 'finished') {
          settingsStore.settings = buildStubSettings({ CEO: ceoProfile, DEVELOPER: developerProfile('dev-a', 'pro') });
        }
      };

      await useCase.execute(turnRequest({ onDelegation: switchDeveloperModel }));

      const [first, second] = portsOf('dev-a');
      expect(first.configCalls).toEqual([{ modelId: 'flash', effortId: 'low' }]);
      expect(second.createSessionCalls).toHaveLength(0);
      expect(second.loadSessionCalls).toEqual([{ cwd: '/mock/workspace/my-app', sessionId: 'session-1' }]);
      expect(second.configCalls).toEqual([{ modelId: 'pro', effortId: 'low' }]);
      expect(await storedAgentSessions()).toEqual([
        { role: 'CEO', agentId: 'stub', sessionId: 'session-1', projectName: null, artifactId: null, ...mockPrompt },
        { role: 'DEVELOPER', agentId: 'dev-a', sessionId: 'session-1', projectName: 'my-app', artifactId: null, ...mockPrompt },
      ]);
    });

    it('should run a role without a profile on the default agent with its default model', async () => {
      portFactory.defaultAgentId = 'fallback';
      settingsStore.settings = buildStubSettings({ DEVELOPER: developerProfile('dev-a') });
      responses.set('fallback', ['<delegate role="CODE_REVIEWER" summary="Working on it" project="my-app">Review it.</delegate>', 'Reviewed.', 'Ok.']);

      const result = await useCase.execute(turnRequest());

      expect(portFactory.createdAgentIds).toEqual(['fallback', 'fallback']);
      expect(created[1].configCalls).toEqual([{ modelId: 'mock-model-v1' }]);
      expect(result).toMatchObject({ status: 'completed', response: 'Ok.', agentInfo: { agentName: 'fallback' } });
    });

    it('should only steer an active delegation whose role moved to another agent', async () => {
      const activePort = new StubAgentPort();
      activePort.agentName = 'dev-a';
      activePort.supportsSteering = true;
      activePort.currentSessionId = 'dev-session';
      steeringSupport.record('dev-a', true);
      const cancel = rs.fn();
      runtime.registerDelegation('conv-1', {
        delegationId: 'd-1',
        role: 'DEVELOPER',
        roleName: 'Developer',
        agentInfo: { roleName: 'Developer', agentName: 'stub' },
        projectName: 'my-app',
        artifactId: null,
        summary: 'Summary',
        taskSpec: 'Original task',
        cwd: '/mock/workspace/my-app',
        startedAt: Date.now(),
        agentPort: activePort,
        turn: { cancel } as any,
        control: control(),
        stop: rs.fn(),
      });
      settingsStore.settings = buildStubSettings({ CEO: ceoProfile, DEVELOPER: developerProfile('dev-b') });
      responses.set('stub', ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Change course.</delegate>', 'Ok.']);

      const result = await useCase.execute(turnRequest());

      expect(result).toMatchObject({ status: 'completed', response: 'Ok.' });
      expect(activePort.steeringPrompts).toEqual([expect.stringContaining('Change course.')]);
      expect(cancel).not.toHaveBeenCalled();
      expect(activePort.closeSessionCalls).toBe(0);
      expect(portFactory.createdAgentIds).toEqual(['stub']);
      expect(runtime.findActiveDelegation('conv-1', 'DEVELOPER')?.agentPort).toBe(activePort);
    });
  });

  describe('attachments extraction', () => {
    it('should extract existing attachments from completed turn response', async () => {
      fileSystem.readableFiles.add('/mock/workspace/screenshot.png');
      stubAgentPort.mockResponses = ['Here is the screenshot:\n<attachment path="screenshot.png">Screen</attachment>'];

      const result = await useCase.execute(turnRequest({ workspacePath: '/mock/workspace' }));

      expect(result).toMatchObject({ status: 'completed', response: 'Here is the screenshot:' });
      expect(result.attachments).toEqual(['/mock/workspace/screenshot.png']);
    });

    describe('resolving the paths the CEO wrote', () => {
      const attachmentsOf = async (...paths: string[]) => {
        stubAgentPort.mockResponses = [`Done.\n${paths.map(path => `<attachment path="${path}" />`).join('\n')}`];
        return (await useCase.execute(turnRequest({ workspacePath: '/workspace' }))).attachments;
      };

      it('should keep the absolute paths of existing files', async () => {
        fileSystem.readableFiles.add('/app/shot.png').add('/app/report.pdf');

        await expect(attachmentsOf('/app/shot.png', '/app/report.pdf')).resolves.toEqual(['/app/shot.png', '/app/report.pdf']);
      });

      it('should resolve relative paths against the workspace', async () => {
        fileSystem.readableFiles.add('/workspace/my-app/docs/report.pdf');

        await expect(attachmentsOf('my-app/docs/report.pdf')).resolves.toEqual(['/workspace/my-app/docs/report.pdf']);
      });

      it('should accept a file:// prefix', async () => {
        fileSystem.readableFiles.add('/app/shot.png');

        await expect(attachmentsOf('file:///app/shot.png')).resolves.toEqual(['/app/shot.png']);
      });

      it('should decode a percent-encoded file URL', async () => {
        fileSystem.readableFiles.add('/app/My Report.pdf');

        await expect(attachmentsOf('file:///app/My%20Report.pdf')).resolves.toEqual(['/app/My Report.pdf']);
      });

      it('should strip the prefix of a file URL that names a host', async () => {
        fileSystem.readableFiles.add('/workspace/app/shot.png');

        await expect(attachmentsOf('file://app/shot.png')).resolves.toEqual(['/workspace/app/shot.png']);
      });

      it('should drop paths that are not readable files', async () => {
        fileSystem.readableFiles.add('/app/shot.png');

        await expect(attachmentsOf('/app/missing.png', '/workspace/my-app', '/app/shot.png')).resolves.toEqual(['/app/shot.png']);
      });

      it('should list a file only once', async () => {
        fileSystem.readableFiles.add('/workspace/shot.png');

        await expect(attachmentsOf('/workspace/shot.png', 'shot.png')).resolves.toEqual(['/workspace/shot.png']);
      });
    });

    it('should hand the text around the delegations to the channel before the agents start', async () => {
      const events: string[] = [];
      stubAgentPort.mockResponses = ['Starting now.\n<delegate role="DEVELOPER" summary="Working on it" project="my-app">Go.</delegate>', 'Done.'];
      delegateStubPort.mockResponses = ['Implemented.'];

      await useCase.execute(turnRequest({
        onInterimMessage: message => events.push(`message: ${message}`),
        onDelegation: event => events.push(event.phase),
      }));

      expect(events).toEqual(['message: Starting now.', 'started', 'finished']);
      expect(delegateStubPort.promptCalls).toEqual([toAgent('Mock system prompt.\n\nGo.')]);
    });

    it('should not send an interim message when a delegation has no text around it', async () => {
      const onInterimMessage = rs.fn();
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Go.</delegate>', 'Done.'];
      delegateStubPort.mockResponses = ['Implemented.'];

      await useCase.execute(turnRequest({ onInterimMessage }));

      expect(onInterimMessage).not.toHaveBeenCalled();
    });

    it('should omit attachments when none exist in response', async () => {
      stubAgentPort.mockResponses = ['Plain response without images'];

      const result = await useCase.execute(turnRequest());

      expect(result.attachments).toBeUndefined();
    });
  });

  describe('incoming attachments prompt enrichment', () => {
    it('should enrich CEO prompt with [ATTACHMENTS] inventory when attachments are present', async () => {
      stubAgentPort.mockResponses = ['I have analyzed the attachments.'];

      const attachments = [
        {
          name: 'diagram.png',
          path: '/tmp/attachments/diagram.png',
          contentType: 'image/png',
          size: 1024,
        },
        {
          name: 'notes.txt',
          path: '/tmp/attachments/notes.txt',
          contentType: 'text/plain',
          size: 256,
        },
      ];

      const result = await useCase.execute(
        turnRequest({ prompt: 'Please review these files.', attachments }),
      );

      expect(result.status).toBe('completed');
      expect(stubAgentPort.promptCalls[0]).toContain('[ATTACHMENTS]');
      expect(stubAgentPort.promptCalls[0]).toContain(
        '- Name: diagram.png\n  Size: 1024 bytes\n  Type: image/png\n  Path: /tmp/attachments/diagram.png',
      );
      expect(stubAgentPort.promptCalls[0]).toContain(
        '- Name: notes.txt\n  Size: 256 bytes\n  Type: text/plain\n  Path: /tmp/attachments/notes.txt',
      );
      expect(stubAgentPort.promptCalls[0]).toContain(
        'Inspect these files using your available tools as needed.',
      );
      expect(stubAgentPort.promptCalls[0]).not.toContain('view_file');
      expect(stubAgentPort.promptCalls[0]).toContain('Please review these files.');
    });

    it('should not enrich prompt when attachments array is empty', async () => {
      stubAgentPort.mockResponses = ['No attachments.'];

      const result = await useCase.execute(
        turnRequest({ prompt: 'Hello world', attachments: [] }),
      );

      expect(result.status).toBe('completed');
      expect(stubAgentPort.promptCalls[0]).not.toContain('[ATTACHMENTS]');
      expect(stubAgentPort.promptCalls[0]).toContain('Hello world');
    });
  });

  describe('audio attachments', () => {
    const voice = { name: 'voice.ogg', path: '/tmp/attachments/voice.ogg', contentType: 'audio/ogg', size: 2048 };
    const photo = { name: 'photo.png', path: '/tmp/attachments/photo.png', contentType: 'image/png', size: 1024 };

    it('should give the CEO the transcript of an audio message in place of the audio file', async () => {
      stubAgentPort.mockResponses = ['Done.'];
      speechToText.transcripts[voice.path] = 'Build me a landing page';

      await useCase.execute(turnRequest({ prompt: '', attachments: [voice] }));

      expect(stubAgentPort.promptCalls[0]).toContain('Build me a landing page');
      expect(stubAgentPort.promptCalls[0]).not.toContain('[ATTACHMENTS]');
      expect(stubAgentPort.promptCalls[0]).not.toContain('voice.ogg');
      expect(fileSystem.deletedFiles).toEqual([voice.path]);
    });

    it('should put the transcript after the typed text and keep the other attachments listed', async () => {
      stubAgentPort.mockResponses = ['Done.'];
      speechToText.transcripts[voice.path] = 'make it blue';

      await useCase.execute(turnRequest({ prompt: 'Restyle this', attachments: [voice, photo] }));

      const prompt = stubAgentPort.promptCalls[0];
      expect(prompt).toContain('Restyle this\n\nmake it blue');
      expect(prompt).toContain('Path: /tmp/attachments/photo.png');
      expect(prompt).not.toContain('voice.ogg');
    });

    it('should tell the channel what was transcribed before the agents run', async () => {
      stubAgentPort.mockResponses = ['Done.'];
      speechToText.transcripts[voice.path] = 'hello there';
      const onTranscription = rs.fn();

      await useCase.execute(turnRequest({ attachments: [voice], onTranscription }));

      expect(onTranscription).toHaveBeenCalledExactlyOnceWith({
        transcripts: [{ name: 'voice.ogg', text: 'hello there' }],
        warnings: [],
      });
    });

    it('should keep the audio as an attachment, and warn, when nothing could be transcribed', async () => {
      stubAgentPort.mockResponses = ['Done.'];
      speechToText.failures[voice.path] = 'whisper crashed';
      const onTranscription = rs.fn();

      await useCase.execute(turnRequest({ prompt: '', attachments: [voice], onTranscription }));

      expect(onTranscription).toHaveBeenCalledWith({
        transcripts: [],
        warnings: [expect.stringContaining('whisper crashed')],
      });
      expect(stubAgentPort.promptCalls[0]).toContain('Path: /tmp/attachments/voice.ogg');
      expect(stubAgentPort.promptCalls[0]).toContain('The user sent attachments. Analyze the attached files.');
      expect(fileSystem.deletedFiles).toEqual([]);
    });

    it('should ask the agents to look at attachments when a message has no text and no audio', async () => {
      stubAgentPort.mockResponses = ['Done.'];

      await useCase.execute(turnRequest({ prompt: '', attachments: [photo] }));

      expect(stubAgentPort.promptCalls[0]).toContain('The user sent attachments. Analyze the attached files.');
    });

    it('should not report anything when the message has no audio', async () => {
      stubAgentPort.mockResponses = ['Done.'];
      const onTranscription = rs.fn();

      await useCase.execute(turnRequest({ attachments: [photo], onTranscription }));

      expect(onTranscription).not.toHaveBeenCalled();
    });

    it('should hand the asking agent the transcript of an answer spoken as audio', async () => {
      stubAgentPort.mockResponses = ['<question>Which colour?</question>', 'Thanks.'];
      speechToText.transcripts[voice.path] = 'Blue please';
      const onTranscription = rs.fn();

      await useCase.execute(turnRequest({
        onTranscription,
        onQuestion: () => queueMicrotask(() => questionQueue.submit('conv-1', { kind: 'text', text: '', attachments: [voice] })),
      }));

      expect(stubAgentPort.promptCalls[1]).toBe(toCeo([
        '<user_answers>',
        '<answer question="Which colour?" kind="other">Blue please</answer>',
        '</user_answers>',
      ].join('\n')));
      expect(onTranscription).toHaveBeenCalledWith({ transcripts: [{ name: 'voice.ogg', text: 'Blue please' }], warnings: [] });
    });

    it('should leave answers without audio untouched', async () => {
      stubAgentPort.mockResponses = ['<question>Which colour?</question>', 'Thanks.'];
      const onTranscription = rs.fn();

      await useCase.execute(turnRequest({
        onTranscription,
        onQuestion: () => queueMicrotask(() => questionQueue.submit('conv-1', { kind: 'text', text: 'Red' })),
      }));

      expect(stubAgentPort.promptCalls[1]).toContain('kind="other">Red</answer>');
      expect(onTranscription).not.toHaveBeenCalled();
    });
  });

  describe('CEO steering', () => {
    const holdFirstPrompt = async () => {
      let release: () => void = () => undefined;
      let started: () => void = () => undefined;
      const firstStarted = new Promise<void>((resolve) => {
        started = resolve;
      });
      stubAgentPort.prompt = async function* (this: StubAgentPort, text: string) {
        this.promptCalls.push(text);
        if (this.promptCalls.length === 1) {
          started();
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        yield textChunk(`reply to ${text}`);
      };
      return { firstStarted, release: () => release() };
    };

    it('should hand a steering message the transcript of its audio', async () => {
      stubAgentPort.supportsSteering = true;
      const gate = await holdFirstPrompt();
      const voice = { name: 'voice.ogg', path: '/tmp/attachments/voice.ogg', contentType: 'audio/ogg', size: 2048 };
      speechToText.transcripts[voice.path] = 'actually use blue';
      const first = useCase.execute(turnRequest({ prompt: 'Build a page' }));
      await gate.firstStarted;

      const steered = await useCase.execute(turnRequest({ prompt: '', attachments: [voice] }));
      gate.release();
      await first;

      expect(steered.status).toBe('steered');
      expect(stubAgentPort.steeringPrompts[0]).toContain('actually use blue');
      expect(stubAgentPort.steeringPrompts[0]).not.toContain('voice.ogg');
    });

    it('should inject a message that arrives while the CEO is running into the running round', async () => {
      stubAgentPort.supportsSteering = true;
      const gate = await holdFirstPrompt();
      const onDelivery = rs.fn();

      const first = useCase.execute(turnRequest({ prompt: 'one' }));
      await gate.firstStarted;
      const second = await useCase.execute(turnRequest({ prompt: 'two', onDelivery }));

      expect(second).toEqual({
        response: '',
        status: 'steered',
        agentInfo: expect.objectContaining({ roleName: 'CEO', agentName: 'stub' }),
      });
      expect(stubAgentPort.steeringPrompts).toHaveLength(1);
      expect(stubAgentPort.steeringPrompts[0]).toMatch(new RegExp(`^${escapeRegExp(`${idleTeam}${emptyBoard}`)}\\n\\[USER_MESSAGE\\]\\n[\\s\\S]*\\n\\ntwo\\n\\n\\[USER_LANGUAGE\\]`));
      expect(stubAgentPort.promptCalls).toHaveLength(1);
      expect(onDelivery.mock.calls).toEqual([['steered']]);

      gate.release();
      const firstResult = await first;

      expect(firstResult).toMatchObject({
        status: 'completed',
        response: `reply to ${toCeo(`Mock system prompt.\n\n${idleTeam}${emptyBoard}one`)}`,
      });
      expect(stubAgentPort.promptCalls).toHaveLength(1);
    });

    it('should steer with the attachments inventory and without the re-entry note of a live session', async () => {
      stubAgentPort.supportsSteering = true;
      agentRegistry.getReentryNote.mockReturnValue('CEO re-entry note');
      const gate = await holdFirstPrompt();

      const first = useCase.execute(turnRequest({ prompt: 'one' }));
      await gate.firstStarted;
      const second = await useCase.execute(turnRequest({
        prompt: 'two',
        attachments: [{ name: 'notes.txt', path: '/tmp/attachments/notes.txt', contentType: 'text/plain', size: 256 }],
      }));

      expect(second.status).toBe('steered');
      expect(stubAgentPort.steeringPrompts).toHaveLength(1);
      const steeringText = stubAgentPort.steeringPrompts[0]!;
      expect(steeringText.startsWith(`${idleTeam}${emptyBoard}\n[USER_MESSAGE]`)).toBe(true);
      expect(steeringText).toContain(
        '[ATTACHMENTS]\n- Name: notes.txt\n  Size: 256 bytes\n  Type: text/plain\n  Path: /tmp/attachments/notes.txt\n'
        + 'Inspect these files using your available tools as needed.\n\ntwo',
      );
      expect(steeringText.endsWith(toCeo('two'))).toBe(true);
      expect(steeringText).not.toContain('CEO re-entry note');

      gate.release();
      await first;
    });

    it('should list the running agents in the message injected into the running CEO round', async () => {
      stubAgentPort.supportsSteering = true;
      runtime.registerDelegation('conv-1', {
        delegationId: 'd-1',
        role: 'DEVELOPER',
        roleName: 'Developer',
        agentInfo: { roleName: 'Developer', agentName: 'stub' },
        projectName: 'my-app',
        artifactId: null,
        summary: 'Summary',
        taskSpec: 'Implement the endpoint',
        cwd: '/mock/workspace/my-app',
        startedAt: Date.now(),
        agentPort: new StubAgentPort(),
        turn: { cancel: rs.fn() } as any,
        control: control(),
        stop: rs.fn(),
      });
      const gate = await holdFirstPrompt();

      const first = useCase.execute(turnRequest({ prompt: 'one' }));
      await gate.firstStarted;
      const second = await useCase.execute(turnRequest({ prompt: 'two' }));

      expect(second.status).toBe('steered');
      expect(stubAgentPort.steeringPrompts[0]).toContain('- DEVELOPER: Agent: stub, Model: default, Effort: default, Status: working, Running: 0s, Project: my-app, Waiting for user: no, Steering: supported, Summary: "Summary"');
      expect(stubAgentPort.steeringPrompts[0]).toContain('two');

      gate.release();
      await first;
    });

    it('should queue the message and run it normally when the agent does not accept the steering', async () => {
      stubAgentPort.supportsSteering = true;
      stubAgentPort.steeringResult = 'not_running';
      const gate = await holdFirstPrompt();
      const onDelivery = rs.fn();

      const first = useCase.execute(turnRequest({ prompt: 'one' }));
      await gate.firstStarted;
      const second = useCase.execute(turnRequest({ prompt: 'two', onDelivery }));
      await rs.waitFor(() => expect(onDelivery).toHaveBeenCalledWith('queued'));

      expect(stubAgentPort.steeringPrompts).toHaveLength(1);
      expect(stubAgentPort.steeringPrompts[0]).toContain('two');
      expect(stubAgentPort.promptCalls).toHaveLength(1);

      gate.release();
      const [firstResult, secondResult] = await Promise.all([first, second]);

      expect(firstResult.status).toBe('completed');
      expect(secondResult).toMatchObject({ status: 'completed', response: `reply to ${toCeo(`${idleTeam}${emptyBoard}two`)}` });
    });

    it('should start the next turn with a message whose steering came back after the final prompt ended', async () => {
      stubAgentPort.supportsSteering = true;
      const gate = await holdFirstPrompt();
      let answerSteering: () => void = () => undefined;
      stubAgentPort.sendSteeringPrompt = async function (this: StubAgentPort, text: string) {
        this.steeringPrompts.push(text);
        await new Promise<void>((resolve) => {
          answerSteering = resolve;
        });
        return 'not_running';
      };
      const onDelivery = rs.fn();

      const first = useCase.execute(turnRequest({ prompt: 'one' }));
      await gate.firstStarted;
      const second = useCase.execute(turnRequest({ prompt: 'two', onDelivery }));
      await rs.waitFor(() => expect(stubAgentPort.steeringPrompts).toHaveLength(1));

      const { turn } = runtime.admit('conv-1') as { turn: ConversationTurn };
      gate.release();
      await rs.waitFor(() => expect(turn.prompting).toBe(false));
      answerSteering();

      await expect(first).resolves.toMatchObject({ status: 'completed' });
      await expect(second).resolves.toMatchObject({ status: 'completed', response: `reply to ${toCeo(`${idleTeam}${emptyBoard}two`)}` });
      expect(onDelivery.mock.calls).toEqual([['queued'], ['delivered']]);
    });

    it('should queue the message when the agent does not support steering', async () => {
      const gate = await holdFirstPrompt();
      const onDelivery = rs.fn();

      const first = useCase.execute(turnRequest({ prompt: 'one' }));
      await gate.firstStarted;
      const second = useCase.execute(turnRequest({ prompt: 'two', onDelivery }));
      await rs.waitFor(() => expect(onDelivery).toHaveBeenCalledWith('queued'));

      expect(stubAgentPort.steeringPrompts).toEqual([]);

      gate.release();
      const [, secondResult] = await Promise.all([first, second]);

      expect(secondResult).toMatchObject({ status: 'completed', response: `reply to ${toCeo(`${idleTeam}${emptyBoard}two`)}` });
    });

    it('should queue the message when the configured agent differs from the running CEO agent', async () => {
      stubAgentPort.supportsSteering = true;
      const gate = await holdFirstPrompt();
      const onDelivery = rs.fn();
      delegateStubPort.agentName = 'other';
      delegateStubPort.mockResponses = ['other agent reply'];

      const first = useCase.execute(turnRequest({ prompt: 'one' }));
      await gate.firstStarted;
      settingsStore.settings = buildStubSettings({ CEO: buildStubProfile('other', { agentName: 'Other' }) });
      const second = useCase.execute(turnRequest({ prompt: 'two', onDelivery }));
      await rs.waitFor(() => expect(onDelivery).toHaveBeenCalledWith('queued'));

      expect(stubAgentPort.steeringPrompts).toEqual([]);

      gate.release();
      const [, secondResult] = await Promise.all([first, second]);

      expect(secondResult).toMatchObject({ status: 'completed', response: 'other agent reply' });
      expect(stubAgentPort.promptCalls).toHaveLength(1);
    });
  });

  describe('user messages during a turn', () => {
    /** A CEO whose every prompt waits for `respond` or `fail`, and whose cancel fails the prompt waiting, as an agent does. */
    const scriptedCeoOn = (port: StubAgentPort, supportsSteering = false) => {
      port.supportsSteering = supportsSteering;
      let current: { resolve: (text: string) => void; reject: (error: Error) => void } | undefined;
      port.prompt = async function* (this: StubAgentPort, text: string) {
        this.promptCalls.push(text);
        const reply = await new Promise<string>((resolve, reject) => {
          current = { resolve, reject };
        });
        this.lastAgentMessage = reply;
        yield textChunk(reply);
      };
      port.cancel = async () => {
        port.cancelCalls++;
        current?.reject(new PromptCancelledError());
      };
      const waitForPrompt = (prompt: number) => rs.waitFor(() => expect(port.promptCalls).toHaveLength(prompt));
      return {
        waitForPrompt,
        respond: async (text: string, prompt: number) => {
          await waitForPrompt(prompt);
          current!.resolve(text);
        },
        fail: async (error: Error, prompt: number) => {
          await waitForPrompt(prompt);
          current!.reject(error);
        },
      };
    };
    const scriptedCeo = (supportsSteering = false) => scriptedCeoOn(stubAgentPort, supportsSteering);
    const onlyOnUserDecision = { project: 'optional', userInitiatedOnly: true } as const;

    it('should read a message that waited with the next prompt of the running turn', async () => {
      const ceo = scriptedCeo();
      delegateStubPort.mockResponses = ['Built.'];
      const onDelivery = rs.fn();

      const first = useCase.execute(turnRequest({ prompt: 'one' }));
      await ceo.waitForPrompt(1);
      const second = useCase.execute(turnRequest({ prompt: 'two', onDelivery }));
      await rs.waitFor(() => expect(onDelivery).toHaveBeenCalledWith('queued'));
      await ceo.respond('<delegate role="DEVELOPER" summary="Building" project="my-app">Build.</delegate>', 1);

      await expect(second).resolves.toMatchObject({ status: 'steered', response: '', agentInfo: { roleName: 'CEO', agentName: 'stub' } });
      expect(onDelivery.mock.calls).toEqual([['queued'], ['delivered']]);
      await ceo.waitForPrompt(2);
      expect(stubAgentPort.promptCalls[1]).toContain(`${emptyBoard}${buildUserMessagePrompt('two')}`);
      await ceo.respond('Noted, still building.', 2);
      await ceo.respond('Done.', 3);

      await expect(first).resolves.toMatchObject({ status: 'completed', response: 'Done.' });
      expect(stubAgentPort.promptCalls[2]).toContain('Built.');
      expect(stubAgentPort.createSessionCalls).toHaveLength(1);
    });

    it('should wake the CEO waiting for its delegates with a message, in the same turn', async () => {
      const ceo = scriptedCeo();
      let finishDelegate: (text: string) => void = () => undefined;
      delegateStubPort.prompt = async function* (this: StubAgentPort, text: string) {
        this.promptCalls.push(text);
        yield textChunk(await new Promise<string>((resolve) => {
          finishDelegate = resolve;
        }));
      };
      const onInterimMessage = rs.fn();
      const onDelivery = rs.fn();

      const first = useCase.execute(turnRequest({ prompt: 'one', onInterimMessage }));
      await ceo.respond('<delegate role="DEVELOPER" summary="Building" project="my-app">Build.</delegate>', 1);
      await rs.waitFor(() => expect(delegateStubPort.promptCalls).toHaveLength(1));

      const second = useCase.execute(turnRequest({ prompt: 'How is it going?', onDelivery }));
      await ceo.waitForPrompt(2);
      await expect(second).resolves.toMatchObject({ status: 'steered' });
      expect(onDelivery.mock.calls).toEqual([['delivered']]);
      expect(stubAgentPort.promptCalls[1]).toContain('Status: working');
      expect(stubAgentPort.promptCalls[1]).toContain(`${emptyBoard}${buildUserMessagePrompt('How is it going?')}`);
      expect(stubAgentPort.promptCalls[1]).not.toContain('<agent_result');
      await ceo.respond('Still building.', 2);
      await rs.waitFor(() => expect(onInterimMessage).toHaveBeenCalledWith('Still building.'));

      finishDelegate('Built.');
      await ceo.respond('Done.', 3);

      await expect(first).resolves.toMatchObject({ status: 'completed', response: 'Done.' });
      expect(stubAgentPort.promptCalls[2]).toContain('Built.');
      expect(stubAgentPort.createSessionCalls).toHaveLength(1);
    });

    it('should accept a delegation only the user may start in the round a message woke', async () => {
      agentRegistry.getDelegationContract.mockImplementation((role: string) => (role === 'TECH_LEAD' ? onlyOnUserDecision : { project: 'optional' }) as DelegationContract);
      const ceo = scriptedCeo();
      let finishDelegate: (text: string) => void = () => undefined;
      delegateStubPort.prompt = async function* (this: StubAgentPort, text: string) {
        this.promptCalls.push(text);
        yield textChunk(this.promptCalls.length === 1
          ? await new Promise<string>((resolve) => {
            finishDelegate = resolve;
          })
          : 'Docker installed.');
      };

      const first = useCase.execute(turnRequest({ prompt: 'Build it' }));
      await ceo.respond('<delegate role="DEVELOPER" summary="Building" project="my-app">Build.</delegate>', 1);
      await rs.waitFor(() => expect(delegateStubPort.promptCalls).toHaveLength(1));
      await useCase.execute(turnRequest({ prompt: 'Yes, have Docker installed.' }));
      await ceo.respond('<delegate role="TECH_LEAD" summary="Installing Docker">Install Docker.</delegate>', 2);
      finishDelegate('Built.');
      await ceo.waitForPrompt(3);
      await ceo.respond('Waiting for both.', 3);
      await rs.waitFor(() => expect(stubAgentPort.promptCalls.length).toBeGreaterThanOrEqual(4));
      await ceo.respond('Done.', 4);

      await expect(first).resolves.toMatchObject({ status: 'completed' });
      expect(stubAgentPort.promptCalls.join('\n')).not.toContain('[DELEGATION_ERROR]');
      expect(delegateStubPort.promptCalls[1]).toContain('Install Docker.');
    });

    it('should accept a delegation only the user may start when a message steered into a later round asked for it', async () => {
      agentRegistry.getDelegationContract.mockImplementation((role: string) => (role === 'TECH_LEAD' ? onlyOnUserDecision : { project: 'optional' }) as DelegationContract);
      const ceo = scriptedCeo(true);
      delegateStubPort.mockResponses = ['Built.', 'Docker installed.'];

      const first = useCase.execute(turnRequest({ prompt: 'Build it' }));
      await ceo.respond('<delegate role="DEVELOPER" summary="Building" project="my-app">Build.</delegate>', 1);
      await ceo.waitForPrompt(2);
      await expect(useCase.execute(turnRequest({ prompt: 'Yes, have Docker installed.' }))).resolves.toMatchObject({ status: 'steered' });
      expect(stubAgentPort.steeringPrompts[0]).toContain(buildUserMessagePrompt('Yes, have Docker installed.'));
      await ceo.respond('<delegate role="TECH_LEAD" summary="Installing Docker">Install Docker.</delegate>', 2);
      await ceo.respond('Installed.', 3);

      await expect(first).resolves.toMatchObject({ status: 'completed', response: 'Installed.' });
      expect(stubAgentPort.promptCalls[2]).not.toContain('[DELEGATION_ERROR]');
      expect(delegateStubPort.promptCalls[1]).toContain('Install Docker.');
    });

    it('should send a steered message again with the retry of the prompt it joined', async () => {
      retryPolicy = { baseDelayMs: 60_000, maxDelayMs: 60_000, maxTotalMs: 600_000 };
      const ceo = scriptedCeo(true);
      const onRetry = (event: RetryEvent) => event.kind === 'scheduled' && queueMicrotask(() => turnRetry.retryNow('conv-1'));

      const first = useCase.execute(turnRequest({ prompt: 'one', onRetry }));
      await ceo.waitForPrompt(1);
      await expect(useCase.execute(turnRequest({ prompt: 'two' }))).resolves.toMatchObject({ status: 'steered' });
      await ceo.fail(new Error('connection lost'), 1);
      await ceo.respond('Recovered.', 2);

      await expect(first).resolves.toMatchObject({ status: 'completed', response: 'Recovered.' });
      expect(stubAgentPort.promptCalls[1]).toMatch(/^Mock system prompt\.\n\n\[RETRY\]/);
      expect(stubAgentPort.promptCalls[1]).toContain(`one\n\n${buildUserMessagePrompt('two')}`);
    });

    it.each([
      ['failed', (ceo: ReturnType<typeof scriptedCeo>) => ceo.fail(new Error('boom'), 1), 'Your previous turn failed: boom'],
      [
        'cancelled', async () => {
          await runtime.cancel('conv-1');
        }, 'Your previous turn was cancelled.',
      ],
    ])('should tell the next turn which messages a %s turn read', async (_status, end, notice) => {
      const ceo = scriptedCeo(true);

      const first = useCase.execute(turnRequest({ prompt: 'one' }));
      await ceo.waitForPrompt(1);
      await useCase.execute(turnRequest({ prompt: 'two' }));
      await end(ceo);
      await first;
      const next = useCase.execute(turnRequest({ prompt: 'three' }));
      await ceo.respond('Ok.', 2);
      await next;

      expect(stubAgentPort.promptCalls[1]).toContain(`- ${notice} It had read these messages the user sent while it ran: "two".`);
    });

    it('should leave a message to the next turn when the prompt it was being steered into ends first', async () => {
      const ceo = scriptedCeo(true);
      const list = artifacts.list.bind(artifacts);
      let release: () => void = () => undefined;
      let reached: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        reached = resolve;
      });
      let calls = 0;
      artifacts.list = async (...args: Parameters<typeof list>) => {
        calls++;
        if (calls === 2) {
          reached();
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return list(...args);
      };

      const first = useCase.execute(turnRequest({ prompt: 'one' }));
      await ceo.waitForPrompt(1);
      const second = useCase.execute(turnRequest({ prompt: 'two' }));
      await held;
      await ceo.respond('One done.', 1);
      const { turn } = runtime.admit('conv-1') as { turn: ConversationTurn };
      await rs.waitFor(() => expect(turn.prompting).toBe(false));
      release();
      await expect(first).resolves.toMatchObject({ status: 'completed', response: 'One done.' });
      await ceo.respond('Two done.', 2);

      await expect(second).resolves.toMatchObject({ status: 'completed', response: 'Two done.' });
      expect(stubAgentPort.steeringPrompts).toEqual([]);
    });

    it('should cancel the messages waiting with the turn, and start none of them', async () => {
      const ceo = scriptedCeo();
      const deliveries: string[][] = [[], []];

      const first = useCase.execute(turnRequest({ prompt: 'one' }));
      await ceo.waitForPrompt(1);
      const waiting = ['two', 'three'].map((prompt, index) => useCase.execute(turnRequest({ prompt, onDelivery: delivery => deliveries[index]!.push(delivery) })));
      await rs.waitFor(() => expect(deliveries).toEqual([['queued'], ['queued']]));

      await runtime.cancel('conv-1');

      await expect(first).resolves.toMatchObject({ status: 'cancelled' });
      await expect(Promise.all(waiting)).resolves.toEqual([{ response: '', status: 'cancelled' }, { response: '', status: 'cancelled' }]);
      expect(deliveries).toEqual([['queued', 'cancelled'], ['queued', 'cancelled']]);
      expect(stubAgentPort.promptCalls).toHaveLength(1);

      const after = useCase.execute(turnRequest({ prompt: 'four' }));
      await ceo.respond('Fresh start.', 2);
      await expect(after).resolves.toMatchObject({ status: 'completed', response: 'Fresh start.' });
      expect(stubAgentPort.promptCalls[1]).toContain('Your previous turn was cancelled.');
      expect(stubAgentPort.promptCalls[1]).not.toContain('two');
    });

    it('should keep the messages that joined a resumable turn with its open work, and resume with them after a restart', async () => {
      const ceo = scriptedCeo(true);
      void useCase.execute(turnRequest({ prompt: 'one', resumable: true }));
      await ceo.waitForPrompt(1);
      await useCase.execute(turnRequest({ prompt: 'two' }));
      await rs.waitFor(() => expect(openWorkStore.saved['conv-1']?.[0]).toMatchObject({ root: true, taskSpec: 'one', updates: ['two'] }));

      openWork.onModuleDestroy();
      const restarted = new StubAgentPort();
      restarted.mockResponses = ['Resumed.'];
      wire(new StubAgentPortFactory(() => restarted));
      await new RestoreOpenWorkUseCase(openWork, questionQueue).onModuleInit();
      const [work] = openWork.continuable('conv-1');

      const result = await useCase.resume(work!.id, turnRequest());

      expect(result).toMatchObject({ status: 'completed', response: 'Resumed.' });
      expect(restarted.promptCalls[0]).toContain('[RESUMED_WORK]');
      expect(restarted.promptCalls[0]).toContain('one\n\nInstructions you received after it, in order; each takes precedence over what it contradicts:\n- two');
    });

    it('should resume work once the running turn ends, or never when the user stops it', async () => {
      const ceo = scriptedCeo();
      void useCase.execute(turnRequest({ prompt: 'one', resumable: true }));
      await ceo.waitForPrompt(1);
      await rs.waitFor(() => expect(openWorkStore.saved['conv-1']).toHaveLength(1));
      openWork.onModuleDestroy();
      const restarted = new StubAgentPort();
      wire(new StubAgentPortFactory(() => restarted));
      await new RestoreOpenWorkUseCase(openWork, questionQueue).onModuleInit();
      const [work] = openWork.continuable('conv-1');
      const held = scriptedCeoOn(restarted);
      const running = useCase.execute(turnRequest({ prompt: 'now' }));
      await held.waitForPrompt(1);

      const resumed = useCase.resume(work!.id, turnRequest());
      await runtime.cancel('conv-1');

      await expect(resumed).resolves.toEqual({ response: '', status: 'cancelled' });
      await expect(running).resolves.toMatchObject({ status: 'cancelled' });
      expect(restarted.promptCalls).toHaveLength(1);
    });
  });

  describe('active delegations and transparent steering', () => {
    it('should prepend [TEAM_PROFILES] block to CEO prompt when active delegations exist', async () => {
      const activeDelegatePort = new StubAgentPort();
      const conversationKey = 'conv-1';
      runtime.registerDelegation(conversationKey, {
        delegationId: 'd-1',
        role: 'DEVELOPER',
        roleName: 'Developer',
        agentInfo: { roleName: 'Developer', agentName: 'stub' },
        projectName: 'project-a',
        artifactId: null,
        summary: 'Summary',
        taskSpec: 'Run build and tests',
        cwd: '/mock/workspace/project-a',
        startedAt: Date.now(),
        agentPort: activeDelegatePort,
        turn: { cancel: rs.fn() } as any,
        control: control(),
        stop: rs.fn(),
      });
      runtime.registerDelegation(conversationKey, {
        delegationId: 'd-1',
        role: 'CODE_REVIEWER',
        roleName: 'Code Reviewer',
        agentInfo: { roleName: 'Code Reviewer', agentName: 'stub' },
        projectName: null,
        artifactId: null,
        summary: 'Summary',
        taskSpec: 'Review code',
        cwd: '/mock/workspace',
        startedAt: Date.now(),
        agentPort: activeDelegatePort,
        turn: { cancel: rs.fn() } as any,
        control: control(),
        stop: rs.fn(),
      });

      stubAgentPort.mockResponses = ['Understood, letting developer continue.'];
      const result = await useCase.execute(turnRequest({ prompt: 'How is it going?' }));

      expect(result.status).toBe('completed');
      expect(stubAgentPort.promptCalls[0]).toContain('[TEAM_PROFILES]');
      expect(stubAgentPort.promptCalls[0]).toContain('- DEVELOPER: Agent: stub, Model: default, Effort: default, Status: working, Running: 0s, Project: project-a, Waiting for user: no, Steering: unknown, Summary: "Summary"');
      expect(stubAgentPort.promptCalls[0]).toContain('- CODE_REVIEWER: Agent: stub, Model: default, Effort: default, Status: working, Running: 0s, Project: none, Waiting for user: no, Steering: unknown, Summary: "Summary"');
      expect(stubAgentPort.promptCalls[0]).toContain('How is it going?');
    });

    it('should not remove a newer active delegation when a previous delegation completes its finally block', async () => {
      const conversationKey = 'conv-1';
      const newerDelegatePort = new StubAgentPort();
      const newerDelegation = {
        delegationId: 'd-1',
        role: 'DEVELOPER',
        roleName: 'Developer',
        agentInfo: { roleName: 'Developer', agentName: 'stub' },
        projectName: 'project-a',
        artifactId: null,
        summary: 'Summary',
        taskSpec: 'Concurrent newer task',
        cwd: '/mock/workspace/project-a',
        startedAt: Date.now(),
        agentPort: newerDelegatePort,
        turn: { cancel: rs.fn() } as any,
        control: control(),
        stop: rs.fn(),
      };

      const unregisterSpy = rs.spyOn(runtime, 'unregisterDelegation');

      delegateStubPort.prompt = async function* () {
        runtime.registerDelegation(conversationKey, newerDelegation);
        yield textChunk('Original delegation finished');
      };

      stubAgentPort.mockResponses = [
        '<delegate role="DEVELOPER" summary="Working on it" project="project-a">Run initial task.</delegate>',
        'Done.',
      ];

      const result = await useCase.execute(turnRequest());

      expect(result.status).toBe('completed');
      expect(unregisterSpy).toHaveBeenCalledWith(
        conversationKey,
        expect.objectContaining({
          role: 'DEVELOPER',
          taskSpec: 'Run initial task.',
        }),
      );
      expect(runtime.findActiveDelegation(conversationKey, 'DEVELOPER')).toBe(newerDelegation);
    });
  });

  describe('parallel delegations', () => {
    let delegatePorts: StubAgentPort[];

    const delegatePort = (response: string) => {
      const port = new StubAgentPort();
      port.mockResponses = [response];
      return port;
    };

    const readOnlyRoles = (...roles: string[]) => {
      agentRegistry.getDelegationContract.mockImplementation((role: string) => ({
        project: 'optional',
        sessionMode: 'overridable',
        ...(roles.includes(role) ? { readOnly: true } : {}),
      }) as DelegationContract);
    };

    /** A delegation running in another turn, which ends as soon as it is cancelled. */
    const activeDelegation = (role: string, projectName: string) => {
      const delegationControl = control();
      return {
        delegationId: `${role}-${projectName}`,
        role,
        roleName: role,
        agentInfo: { roleName: role, agentName: 'stub' },
        projectName,
        artifactId: null,
        summary: 'Summary',
        taskSpec: 'Running task',
        cwd: `/mock/workspace/${projectName}`,
        startedAt: Date.now(),
        agentPort: new StubAgentPort(),
        turn: { cancel: rs.fn(async () => delegationControl.finish('replaced')) } as any,
        control: delegationControl,
        stop: rs.fn(),
      };
    };

    beforeEach(() => {
      delegatePorts = [];
      workspacePort.resolveRepositoryPath.mockImplementation((project: string) => `/mock/workspace/${project}`);
      let created = 0;
      portFactory = new StubAgentPortFactory(() => (created++ === 0 ? stubAgentPort : delegatePorts.shift()!));
      wire(portFactory);
    });

    it('should run every delegation of one response at the same time and return all results in order', async () => {
      const started: string[] = [];
      let releaseAll!: () => void;
      const allStarted = new Promise<void>((resolve) => {
        releaseAll = resolve;
      });
      const gated = (name: string, response: string) => {
        const port = delegatePort(response);
        const original = port.prompt.bind(port);
        port.prompt = async function* (text: string) {
          started.push(name);
          if (started.length === 2) {
            releaseAll();
          }
          await allStarted;
          yield* original(text);
        };
        return port;
      };
      delegatePorts = [gated('backend', 'API ready.'), gated('frontend', 'Screen ready.')];
      stubAgentPort.mockResponses = [
        '<delegate role="DEVELOPER" summary="Working on it" project="project-a">Build the API.</delegate>\n<delegate role="CODE_REVIEWER" summary="Working on it" project="project-b">Plan the screen.</delegate>',
        'Both done.',
      ];

      const result = await useCase.execute(turnRequest());

      expect(result.response).toBe('Both done.');
      expect(started).toEqual(['backend', 'frontend']);
      expect(stubAgentPort.promptCalls[1]).toBe(toCeo(
        '<agent_result role="DEVELOPER" project="project-a" agent="stub" model="default" effort="default">\nAPI ready.\n</agent_result>\n\n<agent_result role="CODE_REVIEWER" project="project-b" agent="stub" model="default" effort="default">\nScreen ready.\n</agent_result>',
      ));
      expect(runtime.getActiveDelegations('conv-1')).toEqual([]);
    });

    it('should let a read-only agent work alongside an agent that modifies the same project', async () => {
      readOnlyRoles('CODE_REVIEWER');
      delegatePorts = [delegatePort('Implemented.'), delegatePort('Reviewed.')];
      stubAgentPort.mockResponses = [
        '<delegate role="DEVELOPER" summary="Working on it" project="my-app">Implement.</delegate>\n<delegate role="CODE_REVIEWER" summary="Working on it" project="my-app">Review main.</delegate>',
        'Ok.',
        'Ok.',
      ];

      const result = await useCase.execute(turnRequest());

      expect(result.status).toBe('completed');
      const handedOver = stubAgentPort.promptCalls.slice(1).join('\n');
      expect(handedOver).toContain('<agent_result role="DEVELOPER" project="my-app" agent="stub" model="default" effort="default">\nImplemented.\n</agent_result>');
      expect(handedOver).toContain('<agent_result role="CODE_REVIEWER" project="my-app" agent="stub" model="default" effort="default">\nReviewed.\n</agent_result>');
    });

    it('should reject two agents that modify the same project in one response', async () => {
      stubAgentPort.mockResponses = [
        '<delegate role="DEVELOPER" summary="Working on it" project="my-app">Implement.</delegate>\n<delegate role="CODE_REVIEWER" summary="Working on it" project="my-app">Push.</delegate>',
        'Sorry.',
      ];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls[1]).toContain(
        'CODE_REVIEWER cannot work in project folder "my-app" at the same time as DEVELOPER',
      );
      expect(portFactory.createdAgentIds).toEqual(['stub']);
    });

    const duplicateRole = 'DEVELOPER appears more than once. A conversation runs one agent per role: merge those tasks into a single delegation.';

    it.each([
      ['for the same project', '<delegate role="DEVELOPER" summary="Working on it" project="my-app">A.</delegate>\n<delegate role="DEVELOPER" summary="Working on it" project="my-app">B.</delegate>'],
      ['for different projects', '<delegate role="DEVELOPER" summary="Working on it" project="project-a">A.</delegate>\n<delegate role="DEVELOPER" summary="Working on it" project="project-b">B.</delegate>'],
      ['at the workspaces root', '<delegate role="DEVELOPER" summary="Working on it">A.</delegate>\n<delegate role="DEVELOPER" summary="Working on it">B.</delegate>'],
    ])('should reject the same role twice in one response %s', async (_scenario, response) => {
      stubAgentPort.mockResponses = [response, 'Sorry.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls[1]).toContain(duplicateRole);
    });

    it('should reject an agent that modifies a project another agent is already modifying', async () => {
      runtime.registerDelegation('conv-1', activeDelegation('GIT_OPS', 'my-app'));
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Implement.</delegate>', 'Sorry.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls[1]).toContain(
        'DEVELOPER cannot work in project folder "my-app" at the same time as GIT_OPS, which is already working there',
      );
    });

    it('should replace the running agent of the same role in another project and ignore running read-only agents', async () => {
      readOnlyRoles('TECH_LEAD');
      const running = activeDelegation('DEVELOPER', 'project-a');
      runtime.registerDelegation('conv-1', activeDelegation('TECH_LEAD', 'my-app'));
      runtime.registerDelegation('conv-1', running);
      delegatePorts = [delegatePort('Implemented.')];
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app" on_busy="interrupt">Implement.</delegate>', 'Ok.'];

      const result = await useCase.execute(turnRequest());

      expect(result.status).toBe('completed');
      expect(running.turn.cancel).toHaveBeenCalledTimes(1);
      expect(running.agentPort.steeringPrompts).toEqual([]);
      expect(runtime.getActiveDelegations('conv-1').map(delegation => delegation.role)).toEqual(['TECH_LEAD']);
    });

    it('should keep the sessions of one role apart per project', async () => {
      sessionStore.seed(buildSessionContext({
        agentSessions: [
          { role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null, artifactId: null },
          { role: 'DEVELOPER', agentId: 'stub', sessionId: 'dev-a', projectName: 'project-a', artifactId: null },
        ],
      }));
      delegatePorts = [delegatePort('Done in b.')];
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="project-b">Work on b.</delegate>', 'Ok.'];

      await useCase.execute(turnRequest());

      expect((await sessionStore.findSession('conv-1'))?.agentSessions).toEqual([
        { role: 'DEVELOPER', agentId: 'stub', sessionId: 'dev-a', projectName: 'project-a', artifactId: null },
        { role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null, artifactId: null, ...mockPrompt },
        { role: 'DEVELOPER', agentId: 'stub', sessionId: 'session-1', projectName: 'project-b', artifactId: null, ...mockPrompt },
      ]);
    });

    it('should keep the sessions bound by every parallel delegation', async () => {
      delegatePorts = [delegatePort('Done in a.'), delegatePort('Done in b.')];
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="project-a">A.</delegate>\n<delegate role="CODE_REVIEWER" summary="Working on it" project="project-b">B.</delegate>', 'Ok.'];

      await useCase.execute(turnRequest());

      const delegateSessions = (await sessionStore.findSession('conv-1'))?.agentSessions
        .filter(agentSession => agentSession.role !== 'CEO')
        .map(agentSession => `${agentSession.role}:${agentSession.projectName}`);
      expect(delegateSessions).toEqual(['DEVELOPER:project-a', 'CODE_REVIEWER:project-b']);
    });

    it('should keep binding sessions after one binding fails to save', async () => {
      const update = sessionStore.updateSession.bind(sessionStore);
      sessionStore.updateSession = async (conversationId, change) => update(conversationId, (session) => {
        const updated = change(session);
        if (updated?.agentSessions.at(-1)?.projectName === 'project-a') {
          throw new Error('EACCES: permission denied');
        }
        return updated;
      });
      delegatePorts = [delegatePort('Done in a.'), delegatePort('Done in b.')];
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="project-a">A.</delegate>\n<delegate role="CODE_REVIEWER" summary="Working on it" project="project-b">B.</delegate>', 'Ok.'];

      await useCase.execute(turnRequest());

      expect((await sessionStore.findSession('conv-1'))?.agentSessions.at(-1)?.projectName).toBe('project-b');
    });

    it('should announce a delegation that fails with the reason', async () => {
      const failing = delegatePort('');
      failing.promptErrorToThrow = new Error('agent crashed');
      delegatePorts = [failing];
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="project-a">A.</delegate>', 'Told the user.'];
      const events: DelegationEvent[] = [];

      await useCase.execute(turnRequest({ onDelegation: event => events.push(event) }));

      expect(events.map(event => event.phase)).toEqual(['started', 'failed']);
      expect(events[1]).toMatchObject({ role: 'DEVELOPER', summary: 'Working on it', errorMessage: 'agent crashed', durationMs: expect.any(Number) });
    });

    it('should hand the failure to the CEO and keep waiting for the other agents', async () => {
      const failing = delegatePort('');
      failing.promptErrorToThrow = new Error('agent crashed');
      const healthy = delegatePort('Done.');
      delegatePorts = [failing, healthy];
      stubAgentPort.mockResponses = [
        '<delegate role="DEVELOPER" summary="Working on it" project="project-a">A.</delegate>\n<delegate role="CODE_REVIEWER" summary="Working on it" project="project-b">B.</delegate>',
        'Retrying a.',
        'All handled.',
      ];

      const result = await useCase.execute(turnRequest());

      expect(result).toMatchObject({ status: 'completed', response: 'All handled.' });
      const handedOver = stubAgentPort.promptCalls.slice(1).join('\n');
      expect(handedOver).toContain('<agent_result role="DEVELOPER" project="project-a" agent="stub" model="default" effort="default" status="failed">\nagent crashed\n</agent_result>');
      expect(handedOver).toContain('<agent_result role="CODE_REVIEWER" project="project-b" agent="stub" model="default" effort="default">\nDone.\n</agent_result>');
      expect(healthy.closeSessionCalls).toBe(1);
    });

    const gatedPort = (response: string) => {
      let release!: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      const port = delegatePort(response);
      const original = port.prompt.bind(port);
      port.prompt = async function* (text: string) {
        await released;
        yield* original(text);
      };
      return { port, release };
    };

    it('should hand each result to the CEO as soon as its agent finishes and wait for the rest', async () => {
      const planner = delegatePort('Plan ready.');
      const reviewer = gatedPort('Review done.');
      delegatePorts = [planner, reviewer.port];
      stubAgentPort.mockResponses = [
        '<delegate role="TECH_LEAD" summary="Working on it" project="project-a">Plan.</delegate>\n<delegate role="CODE_REVIEWER" summary="Working on it" project="project-b">Review.</delegate>',
        'Plan received.',
        'All done.',
      ];
      const interim: string[] = [];

      const result = await useCase.execute(turnRequest({
        onInterimMessage: (message) => {
          interim.push(message);
          reviewer.release();
        },
      }));

      expect(result).toMatchObject({ status: 'completed', response: 'All done.' });
      expect(interim).toEqual(['Plan received.']);
      expect(stubAgentPort.promptCalls[1]).toContain('<agent_result role="TECH_LEAD" project="project-a" agent="stub" model="default" effort="default">\nPlan ready.\n</agent_result>');
      expect(stubAgentPort.promptCalls[1]).not.toContain('Review done.');
      expect(stubAgentPort.promptCalls[1]).toContain('- CODE_REVIEWER: Agent: stub, Model: default, Effort: default, Status: working, Running: 0s, Project: project-b');
      expect(stubAgentPort.promptCalls[2]).toContain('<agent_result role="CODE_REVIEWER" project="project-b" agent="stub" model="default" effort="default">\nReview done.\n</agent_result>');
      expect(stubAgentPort.promptCalls[2]).toContain('[TEAM_PROFILES]');
    });

    it('should hand over together the results that finish while the CEO is busy', async () => {
      rs.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const developer = gatedPort('Implemented.');
      const reviewer = gatedPort('Reviewed.');
      const planner = delegatePort('Planned.');
      delegatePorts = [planner, developer.port, reviewer.port];
      stubAgentPort.mockResponses = [
        '<delegate role="TECH_LEAD" summary="Working on it" project="project-a">Plan.</delegate>\n<delegate role="DEVELOPER" summary="Working on it" project="project-b">Build.</delegate>\n<delegate role="CODE_REVIEWER" summary="Working on it" project="my-app">Review.</delegate>',
        'Noted.',
        'Everything handled.',
      ];
      const ceoPrompt = stubAgentPort.prompt.bind(stubAgentPort);
      stubAgentPort.prompt = async function* (this: StubAgentPort, text: string) {
        if (this.promptCalls.length === 1) {
          developer.release();
          reviewer.release();
          await rs.advanceTimersByTimeAsync(0);
        }
        yield* ceoPrompt(text);
      };

      const result = await useCase.execute(turnRequest());
      rs.useRealTimers();

      expect(result.response).toBe('Everything handled.');
      expect(stubAgentPort.promptCalls).toHaveLength(3);
      expect(stubAgentPort.promptCalls[2]).toContain('Implemented.');
      expect(stubAgentPort.promptCalls[2]).toContain('Reviewed.');
    });

    it('should not send the running agents again while they have not changed and send them when they do', async () => {
      runtime.registerDelegation('conv-1', activeDelegation('TECH_LEAD', 'project-z'));
      const developer = delegatePort('Built.');
      const original = developer.prompt.bind(developer);
      developer.prompt = async function* (text: string) {
        runtime.registerDelegation('conv-1', activeDelegation('PRODUCT_OWNER', 'project-y'));
        yield* original(text);
      };
      delegatePorts = [developer, delegatePort('Planned.')];
      stubAgentPort.mockResponses = [
        '<delegate role="DEVELOPER" summary="Working on it" project="project-a">Build.</delegate>',
        '<delegate role="CODE_REVIEWER" summary="Working on it" project="project-b">Review.</delegate>',
        'Done.',
      ];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls[0]).toContain('- TECH_LEAD: Agent: stub, Model: default, Effort: default, Status: working, Running: 0s, Project: project-z');
      expect(stubAgentPort.promptCalls[1]).toContain('- PRODUCT_OWNER: Agent: stub, Model: default, Effort: default, Status: working, Running: 0s, Project: project-y');
      expect(stubAgentPort.promptCalls[2]).not.toContain('[TEAM_PROFILES]');
    });

    it('should send the team again when a profile changed while the agents worked', async () => {
      const developer = delegatePort('Built.');
      const original = developer.prompt.bind(developer);
      developer.prompt = async function* (text: string) {
        settingsStore.settings = buildStubSettings({ DEVELOPER: buildStubProfile('codex', { agentName: 'OpenAI Codex' }) });
        yield* original(text);
      };
      delegatePorts = [developer];
      stubAgentPort.mockResponses = [
        '<delegate role="DEVELOPER" summary="Working on it" project="project-a">Build.</delegate>',
        'Done.',
      ];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls[0]).toContain('- DEVELOPER: Agent: Stub Agent, Model: default, Effort: default, Status: idle');
      expect(stubAgentPort.promptCalls[1]).toContain('- DEVELOPER: Agent: OpenAI Codex, Model: default, Effort: default, Status: idle');
    });

    it('should show how long an agent has been running and whether it waits for the user', async () => {
      runtime.registerDelegation('conv-1', { ...activeDelegation('DEVELOPER', 'project-a'), startedAt: Date.now() - 125_000 });
      runtime.registerDelegation('conv-1', { ...activeDelegation('TECH_LEAD', 'project-b'), startedAt: Date.now() - 4_000 });
      const asked = questionQueue.ask(
        'conv-1',
        { role: 'DEVELOPER', roleName: 'Developer', projectName: 'project-a' },
        '',
        [{ text: 'Which one?', options: [] }],
        questionListener(),
      );
      stubAgentPort.mockResponses = ['Understood.'];

      await useCase.execute(turnRequest({ prompt: 'Status?' }));

      expect(stubAgentPort.promptCalls[0]).toContain('- DEVELOPER: Agent: stub, Model: default, Effort: default, Status: working, Running: 2m, Project: project-a, Waiting for user: yes, Steering: unknown, Summary: "Summary"');
      expect(stubAgentPort.promptCalls[0]).toContain('- TECH_LEAD: Agent: stub, Model: default, Effort: default, Status: working, Running: 4s, Project: project-b, Waiting for user: no, Steering: unknown, Summary: "Summary"');
      questionQueue.cancel('conv-1');
      await expect(asked).rejects.toBeInstanceOf(PromptCancelledError);
    });

    it('should stop the agents still running when the CEO response is invalid', async () => {
      const developer = delegatePort('Built.');
      const reviewer = delegatePort('never');
      let rejectReviewer!: (error: Error) => void;
      const reviewerStuck = new Promise<void>((_, reject) => {
        rejectReviewer = reject;
      });
      reviewer.prompt = async function* () {
        await reviewerStuck;
        yield textChunk('never');
      };
      reviewer.cancel = async () => {
        rejectReviewer(new PromptCancelledError());
      };
      delegatePorts = [developer, reviewer];
      stubAgentPort.mockResponses = [
        '<delegate role="DEVELOPER" summary="Working on it" project="project-a">Build.</delegate>\n<delegate role="CODE_REVIEWER" summary="Working on it" project="project-b">Review.</delegate>',
        '<delegate role="NOBODY" summary="Working on it">Go.</delegate>',
        '<delegate role="NOBODY" summary="Working on it">Go.</delegate>',
      ];

      const result = await useCase.execute(turnRequest());

      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('Invalid CEO response');
      expect(runtime.getActiveDelegations('conv-1')).toEqual([]);
      expect(reviewer.closeSessionCalls).toBe(1);
    });

    it('should keep the unfinished agents of a cancelled turn from running on', async () => {
      const reviewer = delegatePort('never');
      let rejectReviewer!: (error: Error) => void;
      const reviewerStuck = new Promise<void>((_, reject) => {
        rejectReviewer = reject;
      });
      reviewer.prompt = async function* () {
        await reviewerStuck;
        yield textChunk('never');
      };
      reviewer.cancel = async () => {
        rejectReviewer(new PromptCancelledError());
      };
      const developer = delegatePort('');
      developer.promptErrorToThrow = new PromptCancelledError();
      delegatePorts = [developer, reviewer];
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="project-a">Build.</delegate>\n<delegate role="CODE_REVIEWER" summary="Working on it" project="project-b">Review.</delegate>'];

      const result = await useCase.execute(turnRequest());

      expect(result.status).toBe('cancelled');
      expect(runtime.getActiveDelegations('conv-1')).toEqual([]);
      expect(reviewer.closeSessionCalls).toBe(1);
    });

    it('should hand a failure that is not an Error to the CEO as text', async () => {
      const failing = delegatePort('');
      failing.connect = async () => {
        throw 'transport closed';
      };
      delegatePorts = [failing];
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="project-a">A.</delegate>', 'Ok.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls[1]).toBe(toCeo('<agent_result role="DEVELOPER" project="project-a" agent="stub" model="default" effort="default" status="failed">\ntransport closed\n</agent_result>'));
    });

    it('should hand a missing delegate agent CLI to the CEO and still complete the turn', async () => {
      const message = 'The cursor agent CLI was not found in PATH (spawn cursor ENOENT).';
      const missing = delegatePort('');
      missing.connect = async () => {
        throw new Error(message);
      };
      delegatePorts = [missing];
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="project-a">A.</delegate>', 'Ok.'];

      const result = await useCase.execute(turnRequest());

      expect(result.status).toBe('completed');
      expect(stubAgentPort.promptCalls[1]).toBe(
        toCeo(`<agent_result role="DEVELOPER" project="project-a" agent="stub" model="default" effort="default" status="failed">\n${message}\n</agent_result>`),
      );
    });

    it('should report the turn as cancelled when any parallel delegation was cancelled', async () => {
      const failing = delegatePort('');
      failing.promptErrorToThrow = new Error('agent crashed');
      const cancelled = delegatePort('');
      cancelled.promptErrorToThrow = new PromptCancelledError();
      delegatePorts = [failing, cancelled];
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="project-a">A.</delegate>\n<delegate role="CODE_REVIEWER" summary="Working on it" project="project-b">B.</delegate>'];

      const result = await useCase.execute(turnRequest());

      expect(result.status).toBe('cancelled');
    });

    describe('what an unfinished turn leaves behind', () => {
      const stoppedReviewer = 'CODE_REVIEWER (Project: project-b, Task: "Review.") was stopped before finishing.';

      const failWhileReviewerWaitsForTheUser = async () => {
        const developer = delegatePort('Built.');
        const original = developer.prompt.bind(developer);
        developer.prompt = async function* (text: string) {
          await rs.waitFor(() => expect(questionQueue.hasPending('conv-1')).toBe(true));
          yield* original(text);
        };
        const reviewer = delegatePort('<question>Which one?</question>');
        delegatePorts = [developer, reviewer];
        stubAgentPort.mockResponses = [
          '<delegate role="DEVELOPER" summary="Working on it" project="project-a">Build.</delegate>\n<delegate role="CODE_REVIEWER" summary="Working on it" project="project-b">Review.</delegate>',
          '<delegate role="NOBODY" summary="Working on it">Go.</delegate>',
          '<delegate role="NOBODY" summary="Working on it">Go.</delegate>',
        ];

        const result = await useCase.execute(turnRequest({ onQuestion: rs.fn() }));

        return { result, reviewer };
      };

      it('should end a failed turn whose delegate waits for an answer nobody will give', async () => {
        const { result, reviewer } = await failWhileReviewerWaitsForTheUser();

        expect(result.status).toBe('failed');
        expect(result.errorMessage).toContain('Invalid CEO response');
        expect(questionQueue.hasPending('conv-1')).toBe(false);
        expect(runtime.getActiveDelegations('conv-1')).toEqual([]);
        expect(reviewer.closeSessionCalls).toBe(1);
      });

      it('should tell the CEO of the next turn how the failed one ended, and only that turn', async () => {
        const { result } = await failWhileReviewerWaitsForTheUser();
        stubAgentPort.mockResponses = ['Understood.', 'Fine.'];

        await useCase.execute(turnRequest({ prompt: 'What happened?' }));
        await useCase.execute(turnRequest({ prompt: 'And now?' }));

        const next = stubAgentPort.promptCalls[3]!;
        expect(next).toContain('[PREVIOUS_TURN]');
        expect(next).toContain(`- Your previous turn failed: ${result.errorMessage}`);
        expect(next).toContain(`- ${stoppedReviewer}`);
        expect(next).not.toContain('DEVELOPER (Project');
        expect(next.indexOf('[PREVIOUS_TURN]')).toBeLessThan(next.indexOf('[TEAM_PROFILES]'));
        expect(next).toContain('What happened?');
        expect(stubAgentPort.promptCalls[4]).not.toContain('[PREVIOUS_TURN]');
      });

      it('should not report as stopped a delegation the CEO replaced', async () => {
        const developer = delegatePort('never');
        let rejectDeveloper!: (error: Error) => void;
        const developerStuck = new Promise<void>((_, reject) => {
          rejectDeveloper = reject;
        });
        developer.prompt = async function* () {
          await developerStuck;
          yield textChunk('never');
        };
        developer.cancel = async () => {
          rejectDeveloper(new PromptCancelledError());
        };
        delegatePorts = [developer, delegatePort('Plan ready.'), delegatePort('Rebuilt.')];
        stubAgentPort.mockResponses = [
          '<delegate role="DEVELOPER" summary="Working on it" project="project-a">Build.</delegate>\n<delegate role="TECH_LEAD" summary="Working on it" project="project-b">Plan.</delegate>',
          '<delegate role="DEVELOPER" summary="Working on it" project="project-b" on_busy="interrupt">Rebuild.</delegate>',
          'Done.',
        ];

        const result = await useCase.execute(turnRequest());

        expect(result).toMatchObject({ status: 'completed', response: 'Done.' });
        expect(delegatePorts).toEqual([]);
        expect(stubAgentPort.promptCalls[2]).toContain('Rebuilt.');
        expect(runtime.pendingCeoNotices('conv-1').filter(notice => notice.includes('was stopped before finishing'))).toEqual([]);
      });

      describe('a delegation the CEO replaced', () => {
        const delegations = [
          '<delegate role="DEVELOPER" summary="Working on it" project="project-a">Build.</delegate>\n<delegate role="TECH_LEAD" summary="Working on it" project="project-b">Plan.</delegate>',
          '<delegate role="DEVELOPER" summary="Working on it" project="project-b" on_busy="interrupt">Rebuild.</delegate>',
          'Done.',
        ];

        /** A developer whose prompt only ends when it is cancelled, failing with `error`. */
        const stuckDeveloper = (error: Error) => {
          const developer = delegatePort('never');
          let fail!: (error: Error) => void;
          const stuck = new Promise<void>((_, reject) => {
            fail = reject;
          });
          developer.prompt = async function* () {
            await stuck;
            yield textChunk('never');
          };
          developer.cancel = async () => {
            fail(error);
          };
          return developer;
        };

        const replaceInTheSameTurn = async (developer: StubAgentPort, overrides: Partial<TurnRequest> = {}) => {
          const rebuilt = delegatePort('Rebuilt.');
          delegatePorts = [developer, delegatePort('Plan ready.'), rebuilt];
          stubAgentPort.mockResponses = [...delegations];
          const result = await useCase.execute(turnRequest(overrides));
          return { result, rebuilt };
        };

        const rebuiltResult = '<agent_result role="DEVELOPER" project="project-b" agent="stub" model="default" effort="default">\nRebuilt.\n</agent_result>';

        const expectOnlyTheReplacementReachedTheCeo = (result: { status: string; response: string }, rebuilt: StubAgentPort) => {
          expect(result).toMatchObject({ status: 'completed', response: 'Done.' });
          expect(rebuilt.promptCalls).toHaveLength(1);
          expect(stubAgentPort.promptCalls).toHaveLength(3);
          expect(stubAgentPort.promptCalls[2]).toContain(rebuiltResult);
          expect(stubAgentPort.promptCalls.filter(prompt => prompt.includes('status="failed"'))).toEqual([]);
          expect(runtime.pendingCeoNotices('conv-1')).toEqual([]);
          expect(runtime.getActiveDelegations('conv-1')).toEqual([]);
        };

        it('should complete the turn with the replacement result when the replaced agent is cancelled', async () => {
          const { result, rebuilt } = await replaceInTheSameTurn(stuckDeveloper(new PromptCancelledError()));

          expectOnlyTheReplacementReachedTheCeo(result, rebuilt);
        });

        it.each([
          ['a closed session', 'Resumed session disposed'],
          ['a lost connection', 'Not connected. Call connect() first.'],
        ])('should not hand the CEO a failed result when its cancel fails it with %s', async (_name, message) => {
          const { result, rebuilt } = await replaceInTheSameTurn(stuckDeveloper(new Error(message)));

          expectOnlyTheReplacementReachedTheCeo(result, rebuilt);
        });

        it('should report the replaced delegation as cancelled and the new one as finished', async () => {
          const events: DelegationEvent[] = [];

          await replaceInTheSameTurn(
            stuckDeveloper(new Error('Resumed session disposed')),
            { onDelegation: event => events.push(event) },
          );

          const phasesOf = (delegationId: string) => events.filter(event => event.delegationId === delegationId).map(event => event.phase);
          const developerIds = [...new Set(events.filter(event => event.role === 'DEVELOPER').map(event => event.delegationId))];
          expect(developerIds).toHaveLength(2);
          expect(phasesOf(developerIds[0]!)).toEqual(['started', 'cancelled']);
          expect(phasesOf(developerIds[1]!)).toEqual(['started', 'finished']);
        });

        it('should take the question of a replaced agent out of the queue and go on with the new agent', async () => {
          const asking = delegatePort('<question>Which?</question>');
          const onQuestion = rs.fn();
          const rebuilt = delegatePort('Rebuilt.');
          let pendingWhenRebuiltStarted: boolean | undefined;
          const original = rebuilt.prompt.bind(rebuilt);
          rebuilt.prompt = (text: string) => {
            pendingWhenRebuiltStarted = questionQueue.hasPending('conv-1');
            return original(text);
          };
          const plan = delegatePort('Plan ready.');
          const planOriginal = plan.prompt.bind(plan);
          plan.prompt = async function* (text: string) {
            await rs.waitFor(() => expect(onQuestion).toHaveBeenCalled());
            yield* planOriginal(text);
          };
          delegatePorts = [asking, plan, rebuilt];
          stubAgentPort.mockResponses = [...delegations];

          const result = await useCase.execute(turnRequest({ onQuestion }));

          expect(onQuestion).toHaveBeenCalledTimes(1);
          expect(pendingWhenRebuiltStarted).toBe(false);
          expect(questionQueue.hasPending('conv-1')).toBe(false);
          expectOnlyTheReplacementReachedTheCeo(result, rebuilt);
        });

        it('should answer with the result of the agent a message of the user replaced in the running turn', async () => {
          const rebuilt = delegatePort('Rebuilt.');
          delegatePorts = [stuckDeveloper(new Error('Resumed session disposed')), rebuilt];
          stubAgentPort.mockResponses = [
            '<delegate role="DEVELOPER" summary="Working on it" project="project-a">Build.</delegate>',
            '<delegate role="DEVELOPER" summary="Working on it" project="project-b" on_busy="interrupt">Rebuild.</delegate>',
            'Done.',
          ];

          const first = useCase.execute(turnRequest({ prompt: 'First' }));
          await rs.waitFor(() => expect(runtime.findActiveDelegation('conv-1', 'DEVELOPER')).toBeDefined());
          const second = await useCase.execute(turnRequest({ prompt: 'Second' }));

          expect(second).toMatchObject({ status: 'steered', response: '' });
          await expect(first).resolves.toMatchObject({ status: 'completed', response: 'Done.' });
          expect(stubAgentPort.promptCalls[2]).toContain(rebuiltResult);
          expect(stubAgentPort.promptCalls.filter(prompt => prompt.includes('status="failed"'))).toEqual([]);
          expect(runtime.pendingCeoNotices('conv-1')).toEqual([]);
        });

        it('should answer with the result of the agent that replaced a resumed delegation', async () => {
          const delegation = '<delegate role="DEVELOPER" project="my-app" summary="Build it">Build.</delegate>';
          stubAgentPort.mockResponses = [delegation];
          const beforeRestart = delegatePort('never');
          beforeRestart.prompt = async function* () {
            await new Promise(() => undefined);
            yield* [];
          };
          delegatePorts = [beforeRestart];
          void useCase.execute(turnRequest({ resumable: true }));
          await rs.waitFor(() => expect(openWorkStore.saved['conv-1']?.some(work => work.role === 'DEVELOPER')).toBe(true));
          openWork.onModuleDestroy();

          const ceo = new StubAgentPort();
          const resumedDeveloper = stuckDeveloper(new Error('Resumed session disposed'));
          const rebuilt = delegatePort('Rebuilt.');
          const developers = [resumedDeveloper, rebuilt];
          wire(new StubAgentPortFactory(agentId => (agentId === 'developer' ? developers.shift()! : ceo)));
          settingsStore.settings = buildStubSettings({ CEO: buildStubProfile('ceo'), DEVELOPER: buildStubProfile('developer') });
          await new RestoreOpenWorkUseCase(openWork, questionQueue).onModuleInit();
          ceo.mockResponses = ['<delegate role="DEVELOPER" project="project-a" summary="Rebuild it" on_busy="interrupt">Rebuild.</delegate>', 'Done.'];
          const [work] = openWork.continuable('conv-1');

          const resumed = useCase.resume(work!.id, turnRequest());
          await rs.waitFor(() => expect(runtime.findActiveDelegation('conv-1', 'DEVELOPER')).toBeDefined());
          const second = await useCase.execute(turnRequest({ resumable: true }));

          expect(second).toMatchObject({ status: 'steered', response: '' });
          await expect(resumed).resolves.toMatchObject({ status: 'completed', response: 'Done.' });
          expect(rebuilt.promptCalls).toHaveLength(1);
          expect(ceo.promptCalls.filter(prompt => prompt.includes('status="failed"'))).toEqual([]);
        });

        it('should still end as cancelled, and tell the CEO, a turn the user cancels while an agent works', async () => {
          const developer = stuckDeveloper(new PromptCancelledError());
          delegatePorts = [developer];
          stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="project-a">Build.</delegate>'];

          const turn = useCase.execute(turnRequest());
          await rs.waitFor(() => expect(runtime.findActiveDelegation('conv-1', 'DEVELOPER')).toBeDefined());
          await expect(runtime.cancel('conv-1')).resolves.toBe(true);

          await expect(turn).resolves.toMatchObject({ status: 'cancelled' });
          expect(runtime.pendingCeoNotices('conv-1')).toContain('DEVELOPER (Project: project-a, Task: "Build.") was stopped before finishing.');
        });
      });
    });
  });

  describe('edge cases', () => {
    it('should return cancelled with an empty response when cancelled before any CEO port exists', async () => {
      settingsStore.load = async () => {
        throw new PromptCancelledError();
      };

      const result = await useCase.execute(turnRequest());

      expect(result).toMatchObject({
        status: 'cancelled',
        response: '',
        agentInfo: { roleName: 'CEO', agentName: 'stub' },
      });
      expect(portFactory.createdAgentIds).toHaveLength(0);
    });

    it('should omit the project in the repair hint when a session mode is sent without a project', async () => {
      agentRegistry.getDelegationContract.mockReturnValueOnce({});
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" session="new">Go.</delegate>', 'Ok, asking you first.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls[1]).toContain(
        'Role "DEVELOPER" does not take a session mode. Use <delegate role="DEVELOPER" summary="<summary>"> without the session attribute.',
      );
    });

    it('should log a shortened preview of long delegation tasks without altering the task', async () => {
      const longTask = `Implement ${'a very long feature '.repeat(10)}`.trim();
      stubAgentPort.mockResponses = [`<delegate role="DEVELOPER" summary="Working on it" project="my-app">${longTask}</delegate>`, 'Ok.'];
      delegateStubPort.mockResponses = ['Done.'];

      await useCase.execute(turnRequest());

      expect(delegateStubPort.promptCalls).toEqual([toAgent(`Mock system prompt.\n\n${longTask}`)]);
    });

    it('should bind the agent session using the in-memory session when the store no longer holds it', async () => {
      const findSession = sessionStore.findSession.bind(sessionStore);
      let lookups = 0;
      sessionStore.findSession = async (conversationId) => {
        lookups++;
        return lookups === 1 ? findSession(conversationId) : null;
      };
      stubAgentPort.mockResponses = ['Hi.'];

      const result = await useCase.execute(turnRequest());

      expect(result.status).toBe('completed');
      const saved = await findSession('conv-1');
      expect(saved?.agentSessions).toEqual([{ role: 'CEO', agentId: 'stub', sessionId: 'session-1', projectName: null, artifactId: null, ...mockPrompt }]);
    });

    it('should ignore failures while closing the delegate after it finishes', async () => {
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Go.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['Done.'];
      delegateStubPort.closeSession = async () => {
        throw new Error('close failed');
      };
      delegateStubPort.disconnect = async () => {
        throw new Error('disconnect failed');
      };

      const result = await useCase.execute(turnRequest());

      expect(result).toMatchObject({ status: 'completed', response: 'Ok.' });
    });
  });

  describe('questions to the user', () => {
    const readAnswer = (text: string): QuestionAnswerInput => {
      const hasOptions = (questionQueue.current('conv-1')?.question.options.length ?? 0) > 0;
      return hasOptions && /^\d+$/.test(text.trim())
        ? { kind: 'option', optionIndex: Number(text.trim()) }
        : { kind: 'text', text };
    };

    const answerWith = (...inputs: string[]) => (): void => {
      queueMicrotask(() => {
        while (inputs.length > 0 && questionQueue.hasPending('conv-1')) {
          questionQueue.submit('conv-1', readAnswer(inputs.shift()!));
        }
      });
    };

    it('should hand the user answers to the asking delegate and deliver only its final result to the CEO', async () => {
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Discover it.</delegate>', 'Here is the document.'];
      delegateStubPort.mockResponses = [
        'I understood X.\n<question rationale="Defines the flow.">Who approves?<option>Manager</option><option>Finance</option></question>\n<question>What is the "limit"?</question>',
        'Document at /tmp/intent.md',
      ];
      const prompts: QuestionPrompt[] = [];
      const answer = answerWith('2', 'R$ 500');

      const result = await useCase.execute(turnRequest({
        onQuestion: (event) => {
          if (event.kind === 'asked') {
            prompts.push(event.prompt);
          }
          answer();
        },
      }));

      expect(result).toMatchObject({ status: 'completed', response: 'Here is the document.' });
      expect(prompts).toEqual([
        {
          asker: { role: 'DEVELOPER', roleName: 'DEVELOPER', projectName: 'my-app' },
          question: { text: 'Who approves?', rationale: 'Defines the flow.', options: ['Manager', 'Finance'] },
          number: 1,
          total: 2,
          message: 'I understood X.',
          waitingAskers: 0,
        },
      ]);
      expect(delegateStubPort.promptCalls[1]).toBe(toAgent([
        '<user_answers>',
        '<answer question="Who approves?" option="2">Finance</answer>',
        '<answer question="What is the &quot;limit&quot;?" kind="other">R$ 500</answer>',
        '</user_answers>',
      ].join('\n')));
      expect(stubAgentPort.promptCalls).toHaveLength(2);
      expect(stubAgentPort.promptCalls[1]).toBe(toCeo('<agent_result role="DEVELOPER" project="my-app" agent="stub" model="default" effort="default">\nDocument at /tmp/intent.md\n</agent_result>'));
    });

    it('should give the agent the path of each file attached to an answer', async () => {
      stubAgentPort.mockResponses = ['<question>Show me the current screen.</question>', 'Thanks.'];
      const file = { name: 'screen.png', path: '/tmp/attachments/screen.png', contentType: 'image/png', size: 10 };

      await useCase.execute(turnRequest({
        onQuestion: () => queueMicrotask(() => questionQueue.submit('conv-1', { kind: 'text', text: 'Here', attachments: [file] })),
      }));

      expect(stubAgentPort.promptCalls[1]).toBe(toCeo([
        '<user_answers>',
        '<answer question="Show me the current screen." kind="other">Here',
        '<attachment path="/tmp/attachments/screen.png" name="screen.png" type="image/png"/></answer>',
        '</user_answers>',
      ].join('\n')));
    });

    describe('when the user does not answer in time', () => {
      beforeEach(() => {
        questionTimeoutMs = 60_000;
        rs.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      });

      afterEach(() => {
        questionTimeoutMs = 0;
        rs.useRealTimers();
      });

      it('should tell the agent the recommended answer was assumed because the user was absent', async () => {
        stubAgentPort.mockResponses = [
          '<question>Which database?<option>Postgres</option><option recommended>SQLite</option></question>',
          'Using SQLite.',
        ];
        const onQuestion = rs.fn();

        const turn = useCase.execute(turnRequest({ onQuestion }));
        await rs.waitFor(() => expect(onQuestion).toHaveBeenCalledWith(expect.objectContaining({ kind: 'asked' })));
        rs.advanceTimersByTime(60_000);
        const result = await turn;

        expect(result).toMatchObject({ status: 'completed', response: 'Using SQLite.' });
        expect(onQuestion).toHaveBeenCalledWith(expect.objectContaining({ kind: 'timedOut', timeoutMs: 60_000 }));
        const answers = stubAgentPort.promptCalls[1]!;
        expect(answers).toContain('<answer question="Which database?" option="2" status="timed_out">SQLite</answer>');
        expect(answers).toContain('<note>The user was absent and did not reply in time.');
      });

      it('should tell the agent nothing was assumed when the question had no recommended option', async () => {
        stubAgentPort.mockResponses = ['<question>What is the limit?</question>', 'I will pick one.'];
        const onQuestion = rs.fn();

        const turn = useCase.execute(turnRequest({ onQuestion }));
        await rs.waitFor(() => expect(onQuestion).toHaveBeenCalled());
        rs.advanceTimersByTime(60_000);
        await turn;

        const answers = stubAgentPort.promptCalls[1]!;
        expect(answers).toContain('<answer question="What is the limit?" status="timed_out"></answer>');
        expect(answers).toContain('an answer with no option had no recommendation');
      });

      describe('on the task the agent holds', () => {
        const comments = async () => (await artifacts.get('conv-1', 'T-1'))!.history.filter(event => event.kind === 'commented');

        beforeEach(() => {
          agentRegistry.getDelegationContract.mockReturnValue({ project: 'optional', artifact: 'optional', asksUser: true });
          artifactStore.artifactsOf('conv-1').set('T-1', buildArtifact({ id: 'T-1', projectName: 'my-app' }));
        });

        const askAndWait = async (questions: string, whileAsked: () => void = () => undefined) => {
          stubAgentPort.mockResponses = ['<delegate role="TECH_LEAD" summary="Planning" artifact="T-1">Plan T-1.</delegate>', 'Planned.'];
          delegateStubPort.mockResponses = [questions, 'Plan ready.'];
          const onQuestion = rs.fn();
          const turn = useCase.execute(turnRequest({ onQuestion }));
          await rs.waitFor(() => expect(onQuestion).toHaveBeenCalledWith(expect.objectContaining({ kind: 'asked' })));
          whileAsked();
          rs.advanceTimersByTime(60_000);
          rs.advanceTimersByTime(60_000);
          return turn;
        };

        it('should write the assumed answers on the task, as the server', async () => {
          await askAndWait('<question>Which database?<option>Postgres</option><option recommended>SQLite</option></question><question>Which cache?<option recommended>None</option></question>');

          expect(await comments()).toEqual([
            expect.objectContaining({
              actor: { kind: 'system' },
              text: 'The user did not answer in time, so the recommended answer was assumed:\n- "Which database?": SQLite\n- "Which cache?": None',
            }),
          ]);
        });

        it('should log a comment the board refuses and go on', async () => {
          const warn = rs.spyOn(Logger.prototype, 'warn');

          const result = await askAndWait('<question>Which cache?<option recommended>None</option></question>', () => artifactStore.artifactsOf('conv-1').delete('T-1'));
          const messages = warn.mock.calls.map(([message]) => message);
          warn.mockRestore();

          expect(result.status).toBe('completed');
          expect(messages).toContainEqual(expect.stringMatching(/^Could not comment on T-1: /));
        });

        it('should write nothing when no answer was assumed', async () => {
          await askAndWait('<question>What is the limit?</question><question>Which name?</question>');

          expect(await comments()).toEqual([]);
        });
      });

      it('should write nothing on the board for a question of the CEO, which holds no task', async () => {
        artifactStore.artifactsOf('conv-1').set('T-1', buildArtifact({ id: 'T-1' }));
        stubAgentPort.mockResponses = ['<question>Which database?<option recommended>SQLite</option></question>', 'Using SQLite.'];
        const onQuestion = rs.fn();

        const turn = useCase.execute(turnRequest({ onQuestion }));
        await rs.waitFor(() => expect(onQuestion).toHaveBeenCalled());
        rs.advanceTimersByTime(60_000);
        await turn;

        expect((await artifacts.get('conv-1', 'T-1'))!.history).toEqual([]);
      });
    });

    it('should delegate to an agent only the user may start once the user has answered the CEO', async () => {
      agentRegistry.getDelegationContract.mockReturnValue({ project: 'optional', userInitiatedOnly: true });
      stubAgentPort.mockResponses = [
        'Shall I bring in IT?\n<question>Go ahead?<option>Yes</option></question>',
        '<delegate role="DEVELOPER" summary="Installing it">Install Docker.</delegate>',
        'Installed.',
      ];
      delegateStubPort.mockResponses = ['Docker installed.'];

      const result = await useCase.execute(turnRequest({ onQuestion: answerWith('1') }));

      expect(result).toMatchObject({ status: 'completed', response: 'Installed.' });
      expect(delegateStubPort.promptCalls).toHaveLength(1);
    });

    it('should hand the user answers to the CEO with its system prompt and finish with its next answer', async () => {
      agentRegistry.isSystemPromptEveryTurn.mockReturnValue(true);
      stubAgentPort.mockResponses = ['Before I start:\n<question>Which project?<option>Backend</option></question>', 'Starting on the backend.'];

      const result = await useCase.execute(turnRequest({ onQuestion: answerWith('1') }));

      expect(result).toMatchObject({ status: 'completed', response: 'Starting on the backend.' });
      expect(stubAgentPort.promptCalls[1]).toBe(toCeo(
        'Mock system prompt.\n\n<user_answers>\n<answer question="Which project?" option="1">Backend</answer>\n</user_answers>',
      ));
    });

    it('should ask the user in the order the parallel delegates asked', async () => {
      rs.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const ports = [new StubAgentPort(), new StubAgentPort()];
      let releaseSecond!: () => void;
      const secondMayAsk = new Promise<void>((resolve) => {
        releaseSecond = resolve;
      });
      ports[0]!.mockResponses = ['<question>First?</question>', 'First done.'];
      ports[1]!.mockResponses = ['<question>Second?</question>', 'Second done.'];
      const original = ports[1]!.prompt.bind(ports[1]);
      ports[1]!.prompt = async function* (text: string) {
        await secondMayAsk;
        yield* original(text);
      };
      let created = 0;
      workspacePort.resolveRepositoryPath.mockImplementation((project: string) => `/mock/workspace/${project}`);
      wire(new StubAgentPortFactory(() => (created++ === 0 ? stubAgentPort : ports.shift()!)));
      agentRegistry.getDelegationContract.mockReturnValue({ project: 'optional', sessionMode: 'overridable', readOnly: true, asksUser: true });
      stubAgentPort.mockResponses = [
        '<delegate role="DEVELOPER" summary="Working on it" project="project-a">A.</delegate>\n<delegate role="CODE_REVIEWER" summary="Working on it" project="project-b">B.</delegate>',
        'Both done.',
      ];
      const shown: string[] = [];
      const answers = answerWith('one', 'two');

      const result = await useCase.execute(turnRequest({
        onQuestion: (event) => {
          if (event.kind !== 'asked') {
            return;
          }
          shown.push(`${event.prompt.question.text} (${event.prompt.waitingAskers} waiting)`);
          if (shown.length === 1) {
            releaseSecond();
            void rs.advanceTimersByTimeAsync(0).then(answers);
          }
        },
      }));
      rs.useRealTimers();

      expect(result.response).toBe('Both done.');
      expect(shown).toEqual(['First? (0 waiting)']);
      const handedOver = stubAgentPort.promptCalls.slice(1).join('\n');
      expect(handedOver).toContain('<agent_result role="DEVELOPER" project="project-a" agent="stub" model="default" effort="default">\nFirst done.\n</agent_result>');
      expect(handedOver).toContain('<agent_result role="CODE_REVIEWER" project="project-b" agent="stub" model="default" effort="default">\nSecond done.\n</agent_result>');
    });

    it('should repair a CEO response with malformed questions', async () => {
      stubAgentPort.mockResponses = ['<question>Which?', 'Fixed.'];

      const result = await useCase.execute(turnRequest());

      expect(result.response).toBe('Fixed.');
      expect(stubAgentPort.promptCalls[1]).toContain('must be closed with </question>');
    });

    it('should ask the delegate to fix malformed questions once and then take its response as the result', async () => {
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it">Go.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['<option>A</option>', 'Still <option>B</option>'];

      await useCase.execute(turnRequest());

      expect(delegateStubPort.promptCalls[1]).toContain('[QUESTION_ERROR]');
      expect(stubAgentPort.promptCalls[1]).toBe(toCeo('<agent_result role="DEVELOPER" agent="stub" model="default" effort="default">\nStill <option>B</option>\n</agent_result>'));
    });

    it('should ask the user again after the delegate fixes its questions', async () => {
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it">Go.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['<question>Q?', '<question>Q?</question>', 'Done.'];

      await useCase.execute(turnRequest({ onQuestion: answerWith('yes') }));

      expect(delegateStubPort.promptCalls[2]).toContain('kind="other">yes</answer>');
      expect(stubAgentPort.promptCalls[1]).toBe(toCeo('<agent_result role="DEVELOPER" agent="stub" model="default" effort="default">\nDone.\n</agent_result>'));
    });

    it('should send back the questions of a delegate that does not ask the user, for its result to carry the decision', async () => {
      agentRegistry.getDelegationContract.mockReturnValue({ project: 'optional', sessionMode: 'overridable' });
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it">Go.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['<question>Q?</question>', 'I need the user to choose between A and B.'];
      const onQuestion = rs.fn();

      await useCase.execute(turnRequest({ onQuestion }));

      expect(onQuestion).not.toHaveBeenCalled();
      expect(delegateStubPort.promptCalls[1]).toContain(buildQuestionNotAllowedPrompt());
      expect(stubAgentPort.promptCalls[1]).toContain('I need the user to choose between A and B.');
    });

    it('should stop sending back the questions of a delegate that keeps asking, handing its response over', async () => {
      agentRegistry.getDelegationContract.mockReturnValue({ project: 'optional', sessionMode: 'overridable' });
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it">Go.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['<question>Q1?</question>', '<question>Q2?</question>', '<question>Q3?</question>', '<question>Q4?</question>'];

      await useCase.execute(turnRequest());

      expect(delegateStubPort.promptCalls.filter(prompt => prompt.includes(buildQuestionNotAllowedPrompt()))).toHaveLength(1);
      expect(stubAgentPort.promptCalls[1]).toContain('<agent_result role="DEVELOPER"');
    });

    it('should end the turn as cancelled when the questions are cancelled while the delegate waits', async () => {
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it">Go.</delegate>'];
      delegateStubPort.mockResponses = ['<question>Q?</question>'];

      const result = await useCase.execute(turnRequest({
        onQuestion: () => queueMicrotask(() => questionQueue.cancel('conv-1')),
      }));

      expect(result.status).toBe('cancelled');
      expect(questionQueue.hasPending('conv-1')).toBe(false);
    });
  });

  describe('open work across a restart', () => {
    const delegation = '<delegate role="DEVELOPER" project="my-app" summary="Build it">Build.</delegate>';

    /** New instances over the same disk, as a new server process would have, with the stubs ready for its agents. */
    const restart = async () => {
      openWork.onModuleDestroy();
      const ceo = new StubAgentPort();
      const developer = new StubAgentPort();
      wire(new StubAgentPortFactory(agentId => (agentId === 'developer' ? developer : ceo)));
      settingsStore.settings = buildStubSettings({ CEO: buildStubProfile('ceo'), DEVELOPER: buildStubProfile('developer') });
      await new RestoreOpenWorkUseCase(openWork, questionQueue).onModuleInit();
      return { ceo, developer };
    };

    const records = () => openWorkStore.saved['conv-1'] ?? [];

    it('should keep nothing for a turn that is not resumable', async () => {
      stubAgentPort.mockResponses = [delegation, 'Done.'];
      delegateStubPort.mockResponses = ['Built.'];

      await useCase.execute(turnRequest());

      expect(openWorkStore.saved).toEqual({});
    });

    it('should forget the work of a turn that ends', async () => {
      stubAgentPort.mockResponses = [delegation, 'Done.'];
      delegateStubPort.mockResponses = ['Built.'];

      await useCase.execute(turnRequest({ resumable: true }));

      expect(records()).toEqual([]);
    });

    it('should keep the answers on disk as they arrive and forget the questions once answered', async () => {
      stubAgentPort.mockResponses = [delegation, 'Done.'];
      delegateStubPort.mockResponses = ['<question>First?</question><question>Second?</question>', 'Built.'];
      const onQuestion = rs.fn();
      const turn = useCase.execute(turnRequest({ resumable: true, onQuestion }));
      await rs.waitFor(() => expect(onQuestion).toHaveBeenCalled());

      questionQueue.submit('conv-1', { kind: 'text', text: 'one' });
      await rs.waitFor(() => expect(records().find(work => work.role === 'DEVELOPER')?.questions?.answers.map(answer => answer.answer)).toEqual(['one']));
      questionQueue.submit('conv-1', { kind: 'text', text: 'two' });

      await expect(turn).resolves.toMatchObject({ status: 'completed' });
      expect(records()).toEqual([]);
    });

    it('should deliver the answers given after the restart like any answer and hand the delegate result to the CEO', async () => {
      stubAgentPort.mockResponses = [delegation];
      delegateStubPort.mockResponses = ['<question>Which colour?<option>Red</option><option>Blue</option></question>'];
      const onQuestion = rs.fn();
      void useCase.execute(turnRequest({ resumable: true, onQuestion }));
      await rs.waitFor(() => expect(onQuestion).toHaveBeenCalled());
      await rs.waitFor(() => expect(records().find(work => work.role === 'DEVELOPER')?.questions).toBeDefined());

      const { ceo, developer } = await restart();
      ceo.mockResponses = ['All done.'];
      developer.mockResponses = ['Built in blue.'];

      expect(questionQueue.current('conv-1')).toMatchObject({ question: { text: 'Which colour?' }, asker: { role: 'DEVELOPER', projectName: 'my-app' } });
      const submission = questionQueue.submit('conv-1', { kind: 'option', optionIndex: 2 });
      expect(submission).toMatchObject({ kind: 'answered' });
      const { restoredWork } = submission as { restoredWork: RestoredWorkAnswers };
      const workId = restoredWork.workId;
      const events: DelegationEvent[] = [];

      const result = await useCase.deliverAnswers(restoredWork, turnRequest({ onDelegation: event => events.push(event) }));

      expect(developer.loadSessionCalls).toHaveLength(1);
      expect(developer.promptCalls[0]).toContain('option="2">Blue</answer>');
      expect(developer.promptCalls[0]).not.toContain('[RESUMED_WORK]');
      expect(developer.promptCalls[0]).not.toContain('[LOST_SESSION]');
      expect(ceo.promptCalls[0]).toContain('Built in blue.');
      expect(result).toMatchObject({ status: 'completed', response: 'All done.' });
      expect(events.map(event => [event.phase, event.delegationId])).toEqual([['started', workId], ['finished', workId]]);
      expect(records()).toEqual([]);
    });

    it('should resume a delegate that stopped working, without answers', async () => {
      stubAgentPort.mockResponses = [delegation];
      delegateStubPort.prompt = async function* () {
        await new Promise(() => undefined);
        yield* [];
      };
      const onDelegation = rs.fn();
      void useCase.execute(turnRequest({ resumable: true, onDelegation }));
      await rs.waitFor(() => expect(records().some(work => work.role === 'DEVELOPER')).toBe(true));

      const { ceo, developer } = await restart();
      ceo.mockResponses = ['All done.'];
      developer.mockResponses = ['Built.'];
      const [work] = openWork.continuable('conv-1');
      expect(work).toMatchObject({ role: 'DEVELOPER', projectName: 'my-app', summary: 'Build it' });

      const result = await useCase.resume(work!.id, turnRequest());

      expect(developer.promptCalls[0]).toContain('[RESUMED_WORK]');
      expect(developer.promptCalls[0]).not.toContain('<user_answers>');
      expect(result.status).toBe('completed');
      expect(records()).toEqual([]);
    });

    it('should resume a CEO that asked, with the answers', async () => {
      stubAgentPort.mockResponses = ['<question>Go on?</question>'];
      const onQuestion = rs.fn();
      void useCase.execute(turnRequest({ resumable: true, prompt: 'Plan it', onQuestion }));
      await rs.waitFor(() => expect(onQuestion).toHaveBeenCalled());
      await rs.waitFor(() => expect(records()[0]?.questions).toBeDefined());

      const { ceo } = await restart();
      ceo.mockResponses = ['Planned.'];
      const { restoredWork } = questionQueue.submit('conv-1', { kind: 'text', text: 'yes' }) as { restoredWork: RestoredWorkAnswers };

      const result = await useCase.deliverAnswers(restoredWork, turnRequest());

      expect(ceo.promptCalls[0]).not.toContain('[RESUMED_WORK]');
      expect(ceo.promptCalls[0]).toContain('kind="other">yes</answer>');
      expect(result).toMatchObject({ status: 'completed', response: 'Planned.' });
      expect(records()).toEqual([]);
    });

    /** A delegate waiting for an answer when the server restarts, with the answer given on the new process. */
    const answeredAfterRestart = async () => {
      stubAgentPort.mockResponses = [delegation];
      delegateStubPort.mockResponses = ['<question>Which?</question>'];
      const onQuestion = rs.fn();
      void useCase.execute(turnRequest({ resumable: true, onQuestion }));
      await rs.waitFor(() => expect(onQuestion).toHaveBeenCalled());
      await rs.waitFor(() => expect(records().find(work => work.role === 'DEVELOPER')?.questions).toBeDefined());
      const { ceo, developer } = await restart();
      ceo.mockResponses = ['All done.'];
      developer.mockResponses = ['Built.'];
      const { restoredWork } = questionQueue.submit('conv-1', { kind: 'text', text: 'this' }) as { restoredWork: RestoredWorkAnswers };
      return { ceo, developer, restoredWork };
    };

    it('should give the task along with the answers to a delegate whose session is lost', async () => {
      const { developer, restoredWork } = await answeredAfterRestart();
      developer.loadSessionResult = false;

      await useCase.deliverAnswers(restoredWork, turnRequest());

      expect(developer.promptCalls[0]).toContain('[LOST_SESSION]');
      expect(developer.promptCalls[0]).toContain('Build.');
      expect(developer.promptCalls[0]).toContain('kind="other">this</answer>');
    });

    it('should ask again when a restart comes before the answers reach the delegate, and treat it as working after', async () => {
      const { developer, restoredWork } = await answeredAfterRestart();
      let connected!: () => void;
      const connecting = new Promise<void>((resolve) => {
        connected = resolve;
      });
      const connect = developer.connect.bind(developer);
      developer.connect = async () => {
        await connecting;
        await connect();
      };
      let questionsWhenSent: unknown = 'not sent';
      const prompt = developer.prompt.bind(developer);
      developer.prompt = (text: string) => {
        questionsWhenSent = records().find(work => work.role === 'DEVELOPER')?.questions;
        return prompt(text);
      };

      const turn = useCase.deliverAnswers(restoredWork, turnRequest());
      await rs.waitFor(() => expect(records().find(work => work.role === 'DEVELOPER')?.questions).toBeDefined());
      expect(questionsWhenSent).toBe('not sent');
      connected();
      await turn;

      expect(questionsWhenSent).toBeUndefined();
    });

    it('should give the task along with the answers to a CEO whose session is lost', async () => {
      stubAgentPort.mockResponses = ['<question>Go on?</question>'];
      const onQuestion = rs.fn();
      void useCase.execute(turnRequest({ resumable: true, prompt: 'Plan it', onQuestion }));
      await rs.waitFor(() => expect(onQuestion).toHaveBeenCalled());
      await rs.waitFor(() => expect(records()[0]?.questions).toBeDefined());
      const { ceo } = await restart();
      ceo.loadSessionResult = false;
      ceo.mockResponses = ['Planned.'];
      const { restoredWork } = questionQueue.submit('conv-1', { kind: 'text', text: 'yes' }) as { restoredWork: RestoredWorkAnswers };

      await useCase.deliverAnswers(restoredWork, turnRequest());

      expect(ceo.promptCalls[0]).toContain('[LOST_SESSION]');
      expect(ceo.promptCalls[0]).toContain('Plan it');
    });

    describe('on a task', () => {
      const taskDelegation = '<delegate role="DEVELOPER" artifact="T-1" summary="Build it">Build.</delegate>';
      const seedTask = () => artifactStore.artifactsOf('conv-1').set('T-1', buildArtifact({ id: 'T-1', projectName: 'my-app', sections: { technical_solution: 'Use JWT.' } }));
      const taskSession = { cwd: '/mock/workspace/my-app', sessionId: 'session-1' };

      beforeEach(() => {
        agentRegistry.getDelegationContract.mockReturnValue({ project: 'required', artifact: 'required', asksUser: true });
        seedTask();
      });

      /**
       * A delegate on T-1 stopped mid-round by a restart, with the task back on the board of the new process. `atWork`
       * is whether the agent had shown itself at work on the prompt by then.
       */
      const interruptedOnTask = async (atWork = true) => {
        stubAgentPort.mockResponses = [taskDelegation];
        delegateStubPort.prompt = async function* () {
          if (atWork) {
            delegateStubPort.emitActivity({ kind: 'tool', toolCallId: 'tool-1', title: 'Read', status: 'in_progress' });
          }
          await new Promise(() => undefined);
          yield* [];
        };
        void useCase.execute(turnRequest({ resumable: true }));
        await rs.waitFor(() => expect(records().some(work => work.role === 'DEVELOPER')).toBe(true));
        await rs.waitFor(async () => {
          const binding = (await sessionStore.findSession('conv-1'))?.agentSessions.find(agentSession => agentSession.role === 'DEVELOPER');
          expect(binding).toMatchObject({ sessionId: 'session-1' });
          expect(binding?.unanswered).toBe(atWork ? undefined : true);
        });
        const { ceo, developer } = await restart();
        seedTask();
        ceo.mockResponses = ['All done.'];
        developer.mockResponses = ['Built.'];
        const [work] = openWork.continuable('conv-1');
        return { ceo, developer, work: work! };
      };

      /** A delegate on T-1 waiting for an answer when the server restarts, with the answer given on the new process. */
      const answeredOnTask = async () => {
        stubAgentPort.mockResponses = [taskDelegation];
        delegateStubPort.mockResponses = ['<question>Which?</question>'];
        const onQuestion = rs.fn();
        void useCase.execute(turnRequest({ resumable: true, onQuestion }));
        await rs.waitFor(() => expect(onQuestion).toHaveBeenCalled());
        await rs.waitFor(() => expect(records().find(work => work.role === 'DEVELOPER')?.questions).toBeDefined());
        const { ceo, developer } = await restart();
        seedTask();
        ceo.mockResponses = ['All done.'];
        developer.mockResponses = ['Built.'];
        const { restoredWork } = questionQueue.submit('conv-1', { kind: 'text', text: 'this' }) as { restoredWork: RestoredWorkAnswers };
        return { ceo, developer, restoredWork };
      };

      it('should resume the session of the task for restored work, which carries on without the task again', async () => {
        const { developer, work } = await interruptedOnTask();

        await useCase.resume(work.id, turnRequest());

        expect(developer.loadSessionCalls).toEqual([taskSession]);
        expect(developer.promptCalls[0]).toContain('[RESUMED_WORK]');
        expect(developer.promptCalls[0]).not.toContain('[DELEGATED_ARTIFACT]');
      });

      it('should bring the system prompt and the task again to restored work whose session showed no sign of its prompt', async () => {
        const { developer, work } = await interruptedOnTask(false);

        await useCase.resume(work.id, turnRequest());

        expect(developer.loadSessionCalls).toEqual([taskSession]);
        expect(developer.promptCalls[0]).toMatch(/^Mock system prompt\.\n\n\[DELEGATED_ARTIFACT\]/);
        expect(developer.promptCalls[0]).toContain('## Technical solution\nUse JWT.');
        expect(developer.promptCalls[0]).toContain('[RESUMED_WORK]');
      });

      it('should give the whole task to restored work whose session is lost', async () => {
        const { developer, work } = await interruptedOnTask();
        developer.loadSessionResult = false;

        await useCase.resume(work.id, turnRequest());

        expect(developer.promptCalls[0]).toContain('Use JWT.\n[/DELEGATED_ARTIFACT]\n\n[RESUMED_WORK]');
      });

      it('should deliver the answers in the session of the task', async () => {
        const { developer, restoredWork } = await answeredOnTask();

        await useCase.deliverAnswers(restoredWork, turnRequest());

        expect(developer.loadSessionCalls).toEqual([taskSession]);
        expect(developer.promptCalls[0]).toContain('kind="other">this</answer>');
        expect(developer.promptCalls[0]).not.toContain('[DELEGATED_ARTIFACT]');
      });

      it('should give the whole task along with the answers to a delegate whose task session is lost', async () => {
        const { developer, restoredWork } = await answeredOnTask();
        developer.loadSessionResult = false;

        await useCase.deliverAnswers(restoredWork, turnRequest());

        expect(developer.promptCalls[0]).toMatch(/\[LOST_SESSION\][\s\S]*\[DELEGATED_ARTIFACT\][\s\S]*Use JWT\.[\s\S]*kind="other">this<\/answer>/);
      });

      describe('with a status flow', () => {
        const startedTask = () => artifactStore.artifactsOf('conv-1').set('T-1', buildArtifact({ id: 'T-1', projectName: 'my-app', status: 'in_progress' }));
        const expectVerdictApplied = async () => expect(await artifacts.get('conv-1', 'T-1')).toMatchObject({
          status: 'in_review',
          history: [{ kind: 'assigned' }, { kind: 'updated', changes: [{ field: 'status', from: 'in_progress', to: 'in_review' }] }, { kind: 'released' }],
        });

        beforeEach(() => {
          agentRegistry.getDelegationContract.mockReturnValue({
            project: 'required',
            artifact: 'required',
            asksUser: true,
            statusFlow: { from: ['ready', 'in_progress'], start: 'in_progress', verdicts: { DONE: 'in_review' } },
          });
        });

        it('should apply the verdict of restored work, whose task is already in its start status', async () => {
          const { ceo, developer, work } = await interruptedOnTask();
          startedTask();
          ceo.mockResponses = ['T-1 is in review.'];
          developer.mockResponses = ['DONE'];

          await useCase.resume(work.id, turnRequest());

          await expectVerdictApplied();
          expect(ceo.promptCalls[0]).toContain('artifact="T-1" verdict="DONE" artifact_status="in_review"');
        });

        it('should leave alone a task that restored work finds in a status the role does not take', async () => {
          const { ceo, developer, work } = await interruptedOnTask();
          artifactStore.artifactsOf('conv-1').set('T-1', buildArtifact({ id: 'T-1', projectName: 'my-app', status: 'cancelled' }));
          ceo.mockResponses = ['T-1 was cancelled.'];
          developer.mockResponses = ['DONE'];

          await useCase.resume(work.id, turnRequest());

          expect(await artifacts.get('conv-1', 'T-1')).toMatchObject({ status: 'cancelled', history: [{ kind: 'assigned' }, { kind: 'released' }] });
          expect(ceo.promptCalls[0]).toContain('artifact="T-1" verdict="DONE" artifact_status="cancelled"');
        });

        it('should apply the verdict of an agent the answers were delivered to', async () => {
          const { ceo, developer, restoredWork } = await answeredOnTask();
          startedTask();
          ceo.mockResponses = ['T-1 is in review.'];
          developer.mockResponses = ['DONE'];

          await useCase.deliverAnswers(restoredWork, turnRequest());

          await expectVerdictApplied();
        });
      });
    });

    it('should fail on work that is not interrupted', async () => {
      await expect(useCase.resume('unknown', turnRequest())).resolves.toMatchObject({ status: 'failed', errorMessage: 'No interrupted work: unknown' });
      await expect(useCase.deliverAnswers({ workId: 'unknown', answers: [] }, turnRequest())).resolves.toMatchObject({ status: 'failed' });
    });

    it('should replace what a restart left stopped when the role is delegated again', async () => {
      stubAgentPort.mockResponses = [delegation];
      delegateStubPort.mockResponses = ['<question>Which?</question>'];
      const onQuestion = rs.fn();
      void useCase.execute(turnRequest({ resumable: true, onQuestion }));
      await rs.waitFor(() => expect(onQuestion).toHaveBeenCalled());
      await rs.waitFor(() => expect(records().find(work => work.role === 'DEVELOPER')?.questions).toBeDefined());

      const { ceo, developer } = await restart();
      ceo.mockResponses = [delegation, 'Done.'];
      developer.mockResponses = ['Built.'];

      await useCase.execute(turnRequest({ resumable: true }));

      expect(questionQueue.hasPending('conv-1')).toBe(false);
      expect(records()).toEqual([]);
    });

    it('should keep the task as delegated and every instruction sent since, and resume with all of them', async () => {
      const steeredDelegation = '<delegate role="DEVELOPER" project="my-app" summary="Build more">Build more.</delegate>';
      stubAgentPort.mockResponses = [delegation, steeredDelegation];
      delegateStubPort.agentName = 'dev';
      delegateStubPort.supportsSteering = true;
      delegateStubPort.prompt = async function* () {
        await new Promise(() => undefined);
        yield* [];
      };
      void useCase.execute(turnRequest({ resumable: true }));
      await rs.waitFor(() => expect(steeringSupport.supports('dev')).toBe(true));

      const steered = await useCase.execute(turnRequest({ prompt: 'More', resumable: true }));

      expect(steered.status).toBe('steered');
      await rs.waitFor(() => expect(records().find(work => work.role === 'DEVELOPER')?.updates).toBeDefined());
      expect(records().find(work => work.role === 'DEVELOPER')).toMatchObject({ taskSpec: 'Build.', summary: 'Build more', updates: ['Build more.'] });

      const { ceo, developer } = await restart();
      ceo.mockResponses = ['All done.'];
      developer.mockResponses = ['Built.'];
      const [work] = openWork.continuable('conv-1');
      expect(work).toMatchObject({ role: 'DEVELOPER', summary: 'Build more' });

      await useCase.resume(work!.id, turnRequest());

      expect(developer.promptCalls[0]).toContain('Your task:\nBuild.\n\nInstructions you received after it, in order; each takes precedence over what it contradicts:\n- Build more.');
    });
  });

  describe('a delegation to a role already at work', () => {
    let devPorts: StubAgentPort[];
    let leadPorts: StubAgentPort[];

    /** A delegate whose every prompt waits for `respond`, and whose cancel fails the prompt waiting, as an agent does. */
    const scriptedDelegate = (supportsSteering = false) => {
      const port = new StubAgentPort();
      port.agentName = 'dev';
      port.supportsSteering = supportsSteering;
      let current: { resolve: (text: string) => void; reject: (error: Error) => void } | undefined;
      port.prompt = async function* (text: string) {
        port.promptCalls.push(text);
        const reply = await new Promise<string>((resolve, reject) => {
          current = { resolve, reject };
        });
        port.lastAgentMessage = reply;
        yield textChunk(reply);
      };
      port.cancel = async () => {
        port.cancelCalls++;
        current?.reject(new PromptCancelledError());
      };
      const respond = async (text: string, prompt: number) => {
        await rs.waitFor(() => expect(port.promptCalls).toHaveLength(prompt));
        current!.resolve(text);
      };
      const fail = async (error: Error, prompt: number) => {
        await rs.waitFor(() => expect(port.promptCalls).toHaveLength(prompt));
        current!.reject(error);
      };
      devPorts.push(port);
      return { port, respond, fail };
    };

    /** The CEO answers each prompt from what it holds, since two turns share it in an order the agents decide. */
    const ceoAnswers = (answers: readonly (readonly [string, string])[]) => {
      stubAgentPort.prompt = async function* (this: StubAgentPort, text: string) {
        this.promptCalls.push(text);
        const reply = answers.find(([marker]) => text.includes(marker))?.[1] ?? 'Unexpected prompt.';
        this.lastAgentMessage = reply;
        yield textChunk(reply);
      };
    };

    const delegate = (spec: string, attributes = '') => `<delegate role="DEVELOPER" summary="${spec}" project="my-app"${attributes}>${spec}</delegate>`;
    const resultOf = (body: string, attributes = '') => `<agent_result role="DEVELOPER" project="my-app" agent="dev" model="default" effort="default"${attributes}>\n${body}\n</agent_result>`;
    const steeredIds = (events: readonly DelegationEvent[]) => events.filter(event => event.phase === 'steered');
    /** Sends a message while the turn runs and waits for the delegation the CEO answered it with to reach the agent at work. */
    const sendDuringTurn = async (prompt: string) => {
      await expect(useCase.execute(turnRequest({ prompt }))).resolves.toMatchObject({ status: 'steered' });
      await rs.waitFor(() => expect(runtime.pendingAgentReceipts('conv-1').length).toBeGreaterThan(0));
    };
    const onTask = (id: string, spec: string, attributes = '') => `<delegate role="DEVELOPER" summary="${spec}" artifact="${id}"${attributes}>${spec}</delegate>`;
    const withTasks = (...ids: string[]) => {
      agentRegistry.getDelegationContract.mockImplementation(() => ({ project: 'optional', sessionMode: 'overridable', artifact: 'optional', asksUser: true }) as DelegationContract);
      ids.forEach(id => artifactStore.artifactsOf('conv-1').set(id, buildArtifact({ id, projectName: 'my-app' })));
    };
    /** Holds the next call of a method of the board, from the moment `arm` is called, until `release`. */
    const holdBoard = (method: 'get' | 'release') => {
      const original = artifacts[method].bind(artifacts) as (...args: unknown[]) => Promise<unknown>;
      let armed = false;
      let reached!: () => void;
      const held = new Promise<void>((resolve) => {
        reached = resolve;
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      (artifacts as unknown as Record<string, unknown>)[method] = async (...args: unknown[]) => {
        if (armed) {
          armed = false;
          reached();
          await gate;
        }
        return original(...args);
      };
      return {
        arm: () => {
          armed = true;
        },
        held,
        release,
      };
    };

    beforeEach(() => {
      devPorts = [];
      leadPorts = [];
      settingsStore.settings = buildStubSettings({ DEVELOPER: buildStubProfile('dev'), TECH_LEAD: buildStubProfile('lead') });
      workspacePort.resolveRepositoryPath.mockImplementation((project: string) => `/mock/workspace/${project}`);
      portFactory = new StubAgentPortFactory((agentId) => {
        if (agentId === 'dev') {
          return devPorts.shift()!;
        }
        return agentId === 'lead' ? leadPorts.shift()! : stubAgentPort;
      });
      wire(portFactory);
    });

    describe('on the same task, with steering', () => {
      it('should steer the instruction into the running prompt and tell the CEO with the result, in no round of its own', async () => {
        const developer = scriptedDelegate(true);
        ceoAnswers([['FIRST', delegate('Build.')], ['SECOND', delegate('Add tests too.')], ['RESULT-ONE', 'Done.']]);
        const events: DelegationEvent[] = [];

        const first = useCase.execute(turnRequest({ prompt: 'FIRST', onDelegation: event => events.push(event) }));
        await rs.waitFor(() => expect(developer.port.promptCalls).toHaveLength(1));
        await sendDuringTurn('SECOND');

        expect(stubAgentPort.promptCalls[1]).toContain('Waiting for user: no, Steering: supported, Summary: "Build."');
        expect(developer.port.steeringPrompts).toEqual([expect.stringMatching(/^\[INSTRUCTION_UPDATE\]\n[\s\S]*\nNew instruction:\nAdd tests too\.\n\n[\s\S]*background[\s\S]*\n\[\/INSTRUCTION_UPDATE\]\n\n\[USER_LANGUAGE\]/)]);
        expect(steeredIds(events)).toEqual([expect.objectContaining({ delegationId: events[0]!.delegationId, summary: 'Add tests too.', taskSpec: 'Add tests too.' })]);
        expect(runtime.findActiveDelegation('conv-1', 'DEVELOPER')?.summary).toBe('Add tests too.');

        await developer.respond('RESULT-ONE', 1);

        await expect(first).resolves.toMatchObject({ status: 'completed', response: 'Done.' });
        expect(stubAgentPort.promptCalls).toHaveLength(3);
        expect(stubAgentPort.promptCalls[2]).toContain(`${resultOf('Your instruction reached the agent in the middle of its current prompt. Its result answers it.', ' status="steered"')}\n\n${resultOf('RESULT-ONE')}`);
        expect(events.filter(event => event.phase === 'finished')).toEqual([expect.objectContaining({ summary: 'Add tests too.' })]);
      });

      it('should keep an instruction that finds the agent between prompts for its next prompt instead of restarting it', async () => {
        const developer = scriptedDelegate(true);
        developer.port.steeringResult = 'not_running';
        ceoAnswers([['FIRST', delegate('Build.')], ['SECOND', delegate('Add tests too.')], ['RESULT-TWO', 'Done.']]);

        const first = useCase.execute(turnRequest({ prompt: 'FIRST' }));
        await rs.waitFor(() => expect(developer.port.promptCalls).toHaveLength(1));
        await sendDuringTurn('SECOND');
        await developer.respond('RESULT-ONE', 1);
        await developer.respond('RESULT-TWO', 2);

        await expect(first).resolves.toMatchObject({ status: 'completed', response: 'Done.' });
        expect(developer.port.promptCalls[1]).toMatch(/^\[INSTRUCTION_UPDATE\][\s\S]*Add tests too\./);
        expect(developer.port.createSessionCalls).toHaveLength(1);
        expect(stubAgentPort.promptCalls[2]).toContain(resultOf('The agent was between prompts, so your instruction goes with its next prompt, in the same session. Its result answers it.', ' status="queued"'));
        expect(stubAgentPort.promptCalls[2]).toContain(resultOf('RESULT-TWO'));
        expect(stubAgentPort.promptCalls[2]).not.toContain('RESULT-ONE');
      });

      it('should deliver an instruction kept while the agent waits for the user with the answers', async () => {
        const developer = scriptedDelegate(true);
        developer.port.steeringResult = 'not_running';
        ceoAnswers([['FIRST', delegate('Build.')], ['SECOND', delegate('Add tests too.')], ['RESULT-ONE', 'Done.']]);

        const first = useCase.execute(turnRequest({ prompt: 'FIRST', onQuestion: rs.fn() }));
        await developer.respond('<question>Which database?</question>', 1);
        await rs.waitFor(() => expect(questionQueue.hasPending('conv-1')).toBe(true));
        await sendDuringTurn('SECOND');
        questionQueue.submit('conv-1', { kind: 'text', text: 'Postgres' });
        await developer.respond('RESULT-ONE', 2);

        await expect(first).resolves.toMatchObject({ status: 'completed' });
        expect(developer.port.promptCalls[1]).toMatch(/<user_answers>[\s\S]*Postgres[\s\S]*\[INSTRUCTION_UPDATE\][\s\S]*Add tests too\./);
      });

      it('should tell the agent steered on its task what changed on the task since it was sent', async () => {
        withTasks('T-1');
        const developer = scriptedDelegate(true);
        ceoAnswers([
          ['FIRST', onTask('T-1', 'Build T-1.')],
          ['SECOND', `Noted. <artifact_comment id="T-1">The user wants JWT.</artifact_comment>\n${onTask('T-1', 'Use JWT.')}`],
          ['RESULT-ONE', 'Done.'],
        ]);

        const first = useCase.execute(turnRequest({ prompt: 'FIRST' }));
        await rs.waitFor(() => expect(developer.port.promptCalls).toHaveLength(1));
        await sendDuringTurn('SECOND');
        await developer.respond('RESULT-ONE', 1);
        await first;

        expect(developer.port.steeringPrompts[0]).toContain('Your artifact as it stands now:\n# T-1 · Artifact T-1');
        expect(developer.port.steeringPrompts[0]).toContain('Below are only the sections changed and the comments added since T-1 was last sent to you; everything else on it is unchanged.');
        expect(developer.port.steeringPrompts[0]).toContain('The user wants JWT.');
      });
    });

    describe('without on_busy where it is needed', () => {
      const busy = (projectName: string | null, artifactId: string | null, agentName: string) => {
        const port = new StubAgentPort();
        port.agentName = agentName;
        runtime.registerDelegation('conv-1', {
          delegationId: 'd-1',
          role: 'DEVELOPER',
          roleName: 'DEVELOPER',
          agentInfo: { roleName: 'DEVELOPER', agentName },
          projectName,
          artifactId,
          summary: 'Summary',
          taskSpec: 'Running task',
          cwd: '/mock/workspace',
          startedAt: Date.now(),
          agentPort: port,
          turn: { cancel: rs.fn() } as any,
          control: control(),
          stop: rs.fn(),
        });
      };
      const wait = '- on_busy="wait": this delegation runs once the current work delivers its result, and you get both results. Nothing is lost, but it waits that long.';
      const sameWorkInterrupt = '- on_busy="interrupt": its current prompt stops now and it goes on with your text as its next prompt in the same session, keeping what it learned; only the step it was in the middle of is cut short.';
      const otherWorkInterrupt = '- on_busy="interrupt": its current work ends where it stands (its task keeps its status and its changes stay in the project) and this delegation starts now, in its own session.';

      it.each([
        ['on the same work without steering', 'my-app', null, false, 'is already working in project folder "my-app", and its coding agent does not take a new instruction in the middle of a prompt.', sameWorkInterrupt],
        ['on the same work before its steering is known', 'my-app', null, undefined, 'is already working in project folder "my-app", and its coding agent has not said yet whether it takes a new instruction in the middle of a prompt.', sameWorkInterrupt],
        ['on another task', 'my-app', 'T-9', true, 'is already working on T-9, on other work than this delegation.', otherWorkInterrupt],
        ['at the workspaces root', null, null, true, 'is already working at the workspaces root, on other work than this delegation.', otherWorkInterrupt],
      ])('should explain both choices for an agent %s', async (_case, projectName, artifactId, steering, why, interrupt) => {
        busy(projectName, artifactId, 'busy-agent');
        if (steering !== undefined) {
          steeringSupport.record('busy-agent', steering);
        }
        ceoAnswers([['[DELEGATION_ERROR]', 'Sorry.'], ['CHANGE-REQUEST', delegate('Change it.')]]);

        await useCase.execute(turnRequest({ prompt: 'CHANGE-REQUEST' }));

        expect(stubAgentPort.promptCalls[1]).toContain(`DEVELOPER ${why} Add on_busy to the <delegate> tag to say what happens to that work:\n${wait}\n${interrupt}`);
        expect(portFactory.createdAgentIds).toEqual(['stub']);
      });

      it('should ask for on_busy when a new session for the task the agent is on cannot join its running prompt, even with steering', async () => {
        withTasks('T-1');
        busy('my-app', 'T-1', 'busy-agent');
        steeringSupport.record('busy-agent', true);
        ceoAnswers([['[DELEGATION_ERROR]', 'Sorry.'], ['CHANGE-REQUEST', onTask('T-1', 'Start over.', ' session="new"')]]);

        await useCase.execute(turnRequest({ prompt: 'CHANGE-REQUEST' }));

        expect(stubAgentPort.promptCalls[1]).toContain(`DEVELOPER is already working on T-1, and this delegation starts a new session for that task, which cannot join the running prompt. Add on_busy to the <delegate> tag to say what happens to that work:\n${wait}\n${otherWorkInterrupt}`);
        expect(portFactory.createdAgentIds).toEqual(['stub']);
      });

      it('should still steer an instruction on the same task that asks to resume its session', async () => {
        withTasks('T-1');
        busy('my-app', 'T-1', 'busy-agent');
        steeringSupport.record('busy-agent', true);
        ceoAnswers([['[DELEGATION_ERROR]', 'Sorry.'], ['CHANGE-REQUEST', onTask('T-1', 'Go on.', ' session="resume"')]]);

        await useCase.execute(turnRequest({ prompt: 'CHANGE-REQUEST' }));

        expect(stubAgentPort.promptCalls[1]).not.toContain('[DELEGATION_ERROR]');
      });
    });

    describe('with on_busy="wait"', () => {
      it('should run the instruction in the same session once the current run gives its result, and give the CEO both', async () => {
        const developer = scriptedDelegate();
        ceoAnswers([
          ['FIRST', delegate('Build.')],
          ['SECOND', delegate('Add tests too.', ' on_busy="wait"')],
          ['RESULT-ONE', 'Done one.'],
          ['RESULT-TWO', 'Done two.'],
        ]);
        const events: DelegationEvent[] = [];

        const first = useCase.execute(turnRequest({ prompt: 'FIRST', onDelegation: event => events.push(event) }));
        await rs.waitFor(() => expect(developer.port.promptCalls).toHaveLength(1));
        const second = useCase.execute(turnRequest({ prompt: 'SECOND', onDelegation: event => events.push(event) }));
        await rs.waitFor(() => expect(stubAgentPort.promptCalls).toHaveLength(2));
        expect(runtime.findActiveDelegation('conv-1', 'DEVELOPER')?.control.queued).toBe(1);
        await developer.respond('RESULT-ONE', 1);
        await developer.respond('RESULT-TWO', 2);

        await expect(first).resolves.toMatchObject({ status: 'completed', response: 'Done two.' });
        await expect(second).resolves.toMatchObject({ status: 'steered' });
        expect(developer.port.promptCalls[1]).toBe(toAgent('[FOLLOW_UP]\nYour previous final response was delivered. The CEO sends this next instruction on the same work, in this same session.\n\nAdd tests too.\n[/FOLLOW_UP]'));
        expect(developer.port.createSessionCalls).toHaveLength(1);
        expect(portFactory.createdAgentIds.filter(agentId => agentId === 'dev')).toHaveLength(1);
        const prompts = stubAgentPort.promptCalls.join('\n');
        expect(prompts).toContain(resultOf('The agent finishes its current work first; your instruction then runs in the same session, and you get both results.', ' status="queued"'));
        expect(prompts).toContain(resultOf('RESULT-ONE'));
        expect(prompts).toContain(resultOf('RESULT-TWO'));
        const runs = [...new Set(events.filter(event => event.phase === 'finished').map(event => event.delegationId))];
        expect(runs).toHaveLength(2);
      });

      it('should show the CEO what waits for the agent', async () => {
        const developer = scriptedDelegate();
        ceoAnswers([
          ['FIRST', delegate('Build.')],
          ['SECOND', delegate('Add tests too.', ' on_busy="wait"')],
          ['THIRD', 'Still working.'],
          ['RESULT-ONE', 'Done one.'],
          ['RESULT-TWO', 'Done two.'],
        ]);

        const first = useCase.execute(turnRequest({ prompt: 'FIRST' }));
        await rs.waitFor(() => expect(developer.port.promptCalls).toHaveLength(1));
        const second = useCase.execute(turnRequest({ prompt: 'SECOND' }));
        await rs.waitFor(() => expect(runtime.findActiveDelegation('conv-1', 'DEVELOPER')?.control.queued).toBe(1));
        await useCase.execute(turnRequest({ prompt: 'THIRD' }));
        await developer.respond('RESULT-ONE', 1);
        await developer.respond('RESULT-TWO', 2);
        await Promise.all([first, second]);

        expect(stubAgentPort.promptCalls[2]).toContain('Steering: not supported, Queued: 1, Summary: "Build."');
      });

      it('should start other work in its own session once the agent at work ended', async () => {
        const developer = scriptedDelegate();
        const other = scriptedDelegate();
        ceoAnswers([
          ['FIRST', delegate('Build.')],
          ['SECOND', '<delegate role="DEVELOPER" summary="Elsewhere" project="project-a" on_busy="wait">Fix project a.</delegate>'],
          ['RESULT-ONE', 'Done one.'],
          ['RESULT-A', 'Done a.'],
        ]);

        const first = useCase.execute(turnRequest({ prompt: 'FIRST' }));
        await rs.waitFor(() => expect(developer.port.promptCalls).toHaveLength(1));
        const second = useCase.execute(turnRequest({ prompt: 'SECOND' }));
        await rs.waitFor(() => expect(runtime.findActiveDelegation('conv-1', 'DEVELOPER')?.control.queued).toBe(1));
        expect(other.port.promptCalls).toEqual([]);
        await developer.respond('RESULT-ONE', 1);
        await other.respond('RESULT-A', 1);

        await expect(first).resolves.toMatchObject({ status: 'completed', response: 'Done a.' });
        await expect(second).resolves.toMatchObject({ status: 'steered' });
        expect(other.port.createSessionCalls).toEqual(['/mock/workspace/project-a']);
        expect(stubAgentPort.promptCalls.join('\n')).toContain('The agent finishes its current work first; this delegation starts after it, and you get both results.');
      });

      it('should take back the instruction and stop the agent when the turn fails before the instruction ran', async () => {
        const developer = scriptedDelegate();
        leadPorts.push(Object.assign(new StubAgentPort(), { agentName: 'lead', mockResponses: ['RESULT-LEAD'] }));
        ceoAnswers([
          ['FIRST', delegate('Build.')],
          ['SECOND', `${delegate('Add tests too.', ' on_busy="wait"')}\n<delegate role="TECH_LEAD" summary="Planning" project="project-b">Plan.</delegate>`],
          ['RESULT-LEAD', '<delegate role="NOBODY" summary="x">Go.</delegate>'],
          ['[DELEGATION_ERROR]', '<delegate role="NOBODY" summary="x">Go.</delegate>'],
          ['RESULT-ONE', 'Done one.'],
        ]);

        const lead = leadPorts[0]!;
        const leadPrompt = lead.prompt.bind(lead);
        let queuedWhileLeadWorked: number | undefined;
        lead.prompt = async function* (text: string) {
          await rs.waitFor(() => expect(runtime.findActiveDelegation('conv-1', 'DEVELOPER')?.control.queued).toBe(1));
          queuedWhileLeadWorked = runtime.findActiveDelegation('conv-1', 'DEVELOPER')?.control.queued;
          yield* leadPrompt(text);
        };

        const first = useCase.execute(turnRequest({ prompt: 'FIRST' }));
        await rs.waitFor(() => expect(developer.port.promptCalls).toHaveLength(1));
        await expect(useCase.execute(turnRequest({ prompt: 'SECOND' }))).resolves.toMatchObject({ status: 'steered' });

        await expect(first).resolves.toMatchObject({ status: 'failed' });
        expect(queuedWhileLeadWorked).toBe(1);
        expect(developer.port.cancelCalls).toBe(1);
        expect(developer.port.promptCalls).toHaveLength(1);
        expect(runtime.getActiveDelegations('conv-1')).toEqual([]);
      });

      it('should stop the agent when the turn of its running instruction ends', async () => {
        const developer = scriptedDelegate();
        leadPorts.push(Object.assign(new StubAgentPort(), { agentName: 'lead', mockResponses: ['RESULT-LEAD'] }));
        ceoAnswers([
          ['FIRST', delegate('Build.')],
          ['RESULT-ONE', 'Done one.'],
          ['SECOND', `${delegate('Add tests too.', ' on_busy="wait"')}\n<delegate role="TECH_LEAD" summary="Planning" project="project-b">Plan.</delegate>`],
          ['RESULT-LEAD', '<delegate role="NOBODY" summary="x">Go.</delegate>'],
          ['[DELEGATION_ERROR]', '<delegate role="NOBODY" summary="x">Go.</delegate>'],
        ]);
        const lead = leadPorts[0]!;
        const leadPrompt = lead.prompt.bind(lead);
        lead.prompt = async function* (text: string) {
          await rs.waitFor(() => expect(developer.port.promptCalls).toHaveLength(2));
          yield* leadPrompt(text);
        };

        const first = useCase.execute(turnRequest({ prompt: 'FIRST' }));
        await rs.waitFor(() => expect(developer.port.promptCalls).toHaveLength(1));
        const second = useCase.execute(turnRequest({ prompt: 'SECOND' }));
        await rs.waitFor(() => expect(runtime.findActiveDelegation('conv-1', 'DEVELOPER')?.control.queued).toBe(1));
        await developer.respond('RESULT-ONE', 1);

        await expect(first).resolves.toMatchObject({ status: 'failed' });
        await expect(second).resolves.toMatchObject({ status: 'steered' });
        expect(developer.port.cancelCalls).toBe(1);
        expect(runtime.getActiveDelegations('conv-1')).toEqual([]);
      });

      it('should give a failed result to an instruction whose agent failed before it ran', async () => {
        const developer = scriptedDelegate();
        ceoAnswers([
          ['FIRST', delegate('Build.')],
          ['SECOND', delegate('Add tests too.', ' on_busy="wait"')],
          ['agent crashed', 'Done one.'],
          ['before this instruction ran', 'Done two.'],
        ]);

        const first = useCase.execute(turnRequest({ prompt: 'FIRST' }));
        await rs.waitFor(() => expect(developer.port.promptCalls).toHaveLength(1));
        const second = useCase.execute(turnRequest({ prompt: 'SECOND' }));
        await rs.waitFor(() => expect(runtime.findActiveDelegation('conv-1', 'DEVELOPER')?.control.queued).toBe(1));
        await developer.fail(new Error('agent crashed'), 1);

        await expect(first).resolves.toMatchObject({ status: 'completed' });
        await expect(second).resolves.toMatchObject({ status: 'steered' });
        expect(stubAgentPort.promptCalls.join('\n')).toContain(resultOf('The agent\'s work ended (failed) before this instruction ran. Delegate it again if it still applies.', ' status="failed"'));
      });

      it('should cancel an instruction waiting for an agent the user cancels', async () => {
        const developer = scriptedDelegate();
        ceoAnswers([['FIRST', delegate('Build.')], ['SECOND', delegate('Add tests too.', ' on_busy="wait"')]]);

        const first = useCase.execute(turnRequest({ prompt: 'FIRST' }));
        await rs.waitFor(() => expect(developer.port.promptCalls).toHaveLength(1));
        const second = useCase.execute(turnRequest({ prompt: 'SECOND' }));
        await rs.waitFor(() => expect(runtime.findActiveDelegation('conv-1', 'DEVELOPER')?.control.queued).toBe(1));
        await runtime.cancel('conv-1');

        await expect(first).resolves.toMatchObject({ status: 'cancelled' });
        await expect(second).resolves.toMatchObject({ status: 'steered' });
      });
    });

    describe('waiting for an agent on other work', () => {
      const otherWork = '<delegate role="DEVELOPER" summary="Elsewhere" project="project-a" on_busy="wait">Fix project a.</delegate>';

      it('should stop waiting when the turn fails, and never start', async () => {
        const developer = scriptedDelegate();
        const lead = Object.assign(new StubAgentPort(), { agentName: 'lead', mockResponses: ['RESULT-LEAD'] });
        leadPorts.push(lead);
        const leadPrompt = lead.prompt.bind(lead);
        lead.prompt = async function* (text: string) {
          await rs.waitFor(() => expect(runtime.findActiveDelegation('conv-1', 'DEVELOPER')?.control.queued).toBe(1));
          yield* leadPrompt(text);
        };
        ceoAnswers([
          ['FIRST', delegate('Build.')],
          ['SECOND', `${otherWork}\n<delegate role="TECH_LEAD" summary="Planning" project="project-b">Plan.</delegate>`],
          ['RESULT-LEAD', '<delegate role="NOBODY" summary="x">Go.</delegate>'],
          ['[DELEGATION_ERROR]', '<delegate role="NOBODY" summary="x">Go.</delegate>'],
          ['RESULT-ONE', 'Done one.'],
        ]);

        const first = useCase.execute(turnRequest({ prompt: 'FIRST' }));
        await rs.waitFor(() => expect(developer.port.promptCalls).toHaveLength(1));
        await expect(useCase.execute(turnRequest({ prompt: 'SECOND' }))).resolves.toMatchObject({ status: 'steered' });

        await expect(first).resolves.toMatchObject({ status: 'failed' });
        expect(developer.port.cancelCalls).toBe(1);
        expect(devPorts).toHaveLength(0);
        expect(runtime.getActiveDelegations('conv-1')).toEqual([]);
      });

      it('should be cancelled with the agent it waits for', async () => {
        const developer = scriptedDelegate();
        ceoAnswers([['FIRST', delegate('Build.')], ['SECOND', otherWork]]);

        const first = useCase.execute(turnRequest({ prompt: 'FIRST' }));
        await rs.waitFor(() => expect(developer.port.promptCalls).toHaveLength(1));
        const second = useCase.execute(turnRequest({ prompt: 'SECOND' }));
        await rs.waitFor(() => expect(runtime.findActiveDelegation('conv-1', 'DEVELOPER')?.control.queued).toBe(1));
        await runtime.cancel('conv-1');

        await expect(first).resolves.toMatchObject({ status: 'cancelled' });
        await expect(second).resolves.toMatchObject({ status: 'steered' });
      });

      it('should be cancelled when the agent it waits for is', async () => {
        const developer = scriptedDelegate();
        ceoAnswers([['FIRST', delegate('Build.')], ['SECOND', otherWork]]);

        const first = useCase.execute(turnRequest({ prompt: 'FIRST' }));
        await rs.waitFor(() => expect(developer.port.promptCalls).toHaveLength(1));
        await useCase.execute(turnRequest({ prompt: 'SECOND' }));
        await rs.waitFor(() => expect(runtime.findActiveDelegation('conv-1', 'DEVELOPER')?.control.queued).toBe(1));
        await developer.fail(new PromptCancelledError(), 1);

        await expect(first).resolves.toMatchObject({ status: 'cancelled' });
        expect(devPorts).toHaveLength(0);
      });
    });

    describe('with on_busy="interrupt"', () => {
      it('should cancel the running prompt and send the instruction next in the same session', async () => {
        const developer = scriptedDelegate();
        ceoAnswers([['FIRST', delegate('Build.')], ['SECOND', delegate('Use JWT instead.', ' on_busy="interrupt"')], ['RESULT-JWT', 'Done.']]);

        const first = useCase.execute(turnRequest({ prompt: 'FIRST' }));
        await rs.waitFor(() => expect(developer.port.promptCalls).toHaveLength(1));
        await expect(useCase.execute(turnRequest({ prompt: 'SECOND' }))).resolves.toMatchObject({ status: 'steered' });
        await developer.respond('RESULT-JWT', 2);

        await expect(first).resolves.toMatchObject({ status: 'completed', response: 'Done.' });
        expect(developer.port.cancelCalls).toBe(1);
        expect(developer.port.createSessionCalls).toHaveLength(1);
        expect(developer.port.promptCalls[1]).toMatch(/\[INSTRUCTION_UPDATE\][\s\S]*Use JWT instead\./);
        expect(stubAgentPort.promptCalls[2]).toContain(resultOf('The agent\'s current prompt was cancelled, and your instruction is its next prompt, in the same session. Its result answers it.', ' status="interrupted"'));
        expect(runtime.pendingCeoNotices('conv-1')).toEqual([]);
      });

      it('should free an agent waiting for the user to take the instruction at once', async () => {
        const developer = scriptedDelegate();
        ceoAnswers([['FIRST', delegate('Build.')], ['SECOND', delegate('Use JWT instead.', ' on_busy="interrupt"')], ['RESULT-JWT', 'Done.']]);

        const first = useCase.execute(turnRequest({ prompt: 'FIRST', onQuestion: rs.fn() }));
        await developer.respond('<question>Which database?</question>', 1);
        await rs.waitFor(() => expect(questionQueue.hasPending('conv-1')).toBe(true));
        await useCase.execute(turnRequest({ prompt: 'SECOND' }));
        await developer.respond('RESULT-JWT', 2);

        await expect(first).resolves.toMatchObject({ status: 'completed' });
        expect(questionQueue.hasPending('conv-1')).toBe(false);
        expect(developer.port.cancelCalls).toBe(0);
        expect(developer.port.promptCalls[1]).toMatch(/^\[INSTRUCTION_UPDATE\][\s\S]*Use JWT instead\./);
      });

      it('should go on when cancelling the running prompt fails', async () => {
        const developer = scriptedDelegate();
        const cancel = developer.port.cancel.bind(developer.port);
        developer.port.cancel = async () => {
          await cancel();
          throw new Error('cancel failed');
        };
        ceoAnswers([['FIRST', delegate('Build.')], ['SECOND', delegate('Use JWT instead.', ' on_busy="interrupt"')], ['RESULT-JWT', 'Done.']]);

        const first = useCase.execute(turnRequest({ prompt: 'FIRST' }));
        await rs.waitFor(() => expect(developer.port.promptCalls).toHaveLength(1));
        await useCase.execute(turnRequest({ prompt: 'SECOND' }));
        await developer.respond('RESULT-JWT', 2);

        await expect(first).resolves.toMatchObject({ status: 'completed', response: 'Done.' });
      });

      it('should still cancel an interrupted agent that the user cancels', async () => {
        const developer = scriptedDelegate();
        ceoAnswers([['FIRST', delegate('Build.')], ['SECOND', delegate('Use JWT instead.', ' on_busy="interrupt"')]]);

        const first = useCase.execute(turnRequest({ prompt: 'FIRST' }));
        await rs.waitFor(() => expect(developer.port.promptCalls).toHaveLength(1));
        await useCase.execute(turnRequest({ prompt: 'SECOND' }));
        await rs.waitFor(() => expect(developer.port.promptCalls).toHaveLength(2));
        await runtime.cancel('conv-1');

        await expect(first).resolves.toMatchObject({ status: 'cancelled' });
      });
    });

    describe('when the work cannot go on', () => {
      it('should hand the CEO a failed result when the agent of a delegation cannot be created', async () => {
        portFactory = new StubAgentPortFactory((agentId) => {
          if (agentId === 'dev') {
            throw new Error('Unknown agent "dev".');
          }
          return stubAgentPort;
        });
        wire(portFactory);
        ceoAnswers([['FIRST', delegate('Build.')], ['Unknown agent', 'Told the user.']]);

        await expect(useCase.execute(turnRequest({ prompt: 'FIRST' }))).resolves.toMatchObject({ status: 'completed', response: 'Told the user.' });
        expect(stubAgentPort.promptCalls[1]).toContain(resultOf('Unknown agent "dev".', ' status="failed"').replace(' agent="dev" model="default" effort="default"', ''));
      });

      it('should hand the CEO a failed result when the board fails while the result is written', async () => {
        withTasks('T-1');
        const developer = scriptedDelegate();
        ceoAnswers([['FIRST', onTask('T-1', 'Build T-1.')], ['board is down', 'Told the user.']]);
        const get = artifacts.get.bind(artifacts);
        let failing = false;
        artifacts.get = async (...args: Parameters<typeof get>) => {
          if (failing) {
            throw new Error('The board is down.');
          }
          return get(...args);
        };

        const turn = useCase.execute(turnRequest({ prompt: 'FIRST' }));
        await rs.waitFor(() => expect(developer.port.promptCalls).toHaveLength(1));
        failing = true;
        await developer.respond('RESULT-ONE', 1);

        await expect(turn).resolves.toMatchObject({ response: 'Told the user.' });
        expect(stubAgentPort.promptCalls[1]).toContain('status="failed">\nThe board is down.\n</agent_result>');
        expect(runtime.getActiveDelegations('conv-1')).toEqual([]);
      });

      it('should steer an agent whose task left the board without telling it about the task', async () => {
        withTasks('T-1');
        const developer = scriptedDelegate(true);
        ceoAnswers([['FIRST', onTask('T-1', 'Build T-1.')], ['SECOND', onTask('T-1', 'Use JWT.')], ['RESULT-ONE', 'Done.']]);

        const first = useCase.execute(turnRequest({ prompt: 'FIRST' }));
        await rs.waitFor(() => expect(developer.port.promptCalls).toHaveLength(1));
        const validate = artifacts.get.bind(artifacts);
        artifacts.list = async () => [];
        artifacts.get = async (...args: Parameters<typeof validate>) => validate(...args);
        await sendDuringTurn('SECOND');
        await developer.respond('RESULT-ONE', 1);
        await first;

        expect(developer.port.steeringPrompts[0]).toContain('Use JWT.');
        expect(developer.port.steeringPrompts[0]).not.toContain('Your artifact as it stands now');
      });
    });

    describe('with on_busy="interrupt" on another task', () => {
      it('should end the work on the other task and wait for its artifact to be released before taking the new one', async () => {
        withTasks('T-1', 'T-2');
        const developer = scriptedDelegate();
        const replacement = scriptedDelegate();
        ceoAnswers([['FIRST', onTask('T-1', 'Build T-1.')], ['SECOND', onTask('T-2', 'Build T-2.', ' on_busy="interrupt"')], ['RESULT-TWO', 'Done.']]);
        const release = rs.spyOn(artifacts, 'release');
        const assign = rs.spyOn(artifacts, 'assign');

        const first = useCase.execute(turnRequest({ prompt: 'FIRST' }));
        await rs.waitFor(() => expect(developer.port.promptCalls).toHaveLength(1));
        const second = useCase.execute(turnRequest({ prompt: 'SECOND' }));
        await replacement.respond('RESULT-TWO', 1);

        await expect(first).resolves.toMatchObject({ status: 'completed', response: 'Done.' });
        await expect(second).resolves.toMatchObject({ status: 'steered' });
        const order = (spy: typeof release | typeof assign, id: string) => spy.mock.invocationCallOrder[spy.mock.calls.findIndex(call => call[1] === id)]!;
        expect(order(release, 'T-1')).toBeLessThan(order(assign, 'T-2'));
        expect(stubAgentPort.promptCalls[2]).toContain('<agent_result role="DEVELOPER" project="my-app" artifact="T-1" artifact_status="ready" agent="dev" model="default" effort="default" status="interrupted">\nThis work stopped where it stood to start your new delegation. What the agent changed in the project stays as it left it.\n</agent_result>');
        expect(runtime.pendingCeoNotices('conv-1').filter(notice => notice.includes('stopped before finishing'))).toEqual([]);
      });
    });

    describe('with session="new" on the same task', () => {
      it('should wait for the current run to end and start the new session of the task, whose binding replaces the old one', async () => {
        withTasks('T-1');
        const developer = scriptedDelegate(true);
        const replacement = scriptedDelegate(true);
        ceoAnswers([['FIRST', onTask('T-1', 'Build T-1.')], ['SECOND', onTask('T-1', 'Start over on T-1.', ' session="new" on_busy="wait"')], ['RESULT-ONE', 'Done one.'], ['RESULT-TWO', 'Done two.']]);

        const first = useCase.execute(turnRequest({ prompt: 'FIRST' }));
        await rs.waitFor(() => expect(developer.port.promptCalls).toHaveLength(1));
        const second = useCase.execute(turnRequest({ prompt: 'SECOND' }));
        await rs.waitFor(() => expect(runtime.pendingAgentReceipts('conv-1').length).toBeGreaterThan(0));
        expect(replacement.port.promptCalls).toEqual([]);
        await developer.respond('RESULT-ONE', 1);
        await replacement.respond('RESULT-TWO', 1);

        await expect(first).resolves.toMatchObject({ status: 'completed' });
        await expect(second).resolves.toMatchObject({ status: 'steered' });
        expect(developer.port.promptCalls).toHaveLength(1);
        expect(developer.port.steeringPrompts).toEqual([]);
        expect(replacement.port.loadSessionCalls).toEqual([]);
        expect(replacement.port.createSessionCalls).toEqual(['/mock/workspace/my-app']);
        expect(replacement.port.promptCalls[0]).toMatch(/^Mock system prompt\.\n\n\[DELEGATED_ARTIFACT\]\nYou hold T-1[\s\S]*Start over on T-1\./);
        const bindings = (await sessionStore.findSession('conv-1'))?.agentSessions.filter(binding => binding.artifactId === 'T-1');
        expect(bindings).toHaveLength(1);
      });

      it('should end the current work and start the new session of the task at once, whatever the steering of the agent', async () => {
        withTasks('T-1');
        const developer = scriptedDelegate(true);
        const replacement = scriptedDelegate(true);
        ceoAnswers([['FIRST', onTask('T-1', 'Build T-1.')], ['SECOND', onTask('T-1', 'Start over on T-1.', ' session="new" on_busy="interrupt"')], ['RESULT-TWO', 'Done.']]);
        const release = rs.spyOn(artifacts, 'release');
        const assign = rs.spyOn(artifacts, 'assign');

        const first = useCase.execute(turnRequest({ prompt: 'FIRST' }));
        await rs.waitFor(() => expect(developer.port.promptCalls).toHaveLength(1));
        const second = useCase.execute(turnRequest({ prompt: 'SECOND' }));
        await replacement.respond('RESULT-TWO', 1);

        await expect(first).resolves.toMatchObject({ status: 'completed', response: 'Done.' });
        await expect(second).resolves.toMatchObject({ status: 'steered' });
        expect(developer.port.steeringPrompts).toEqual([]);
        expect(developer.port.promptCalls).toHaveLength(1);
        expect(replacement.port.createSessionCalls).toEqual(['/mock/workspace/my-app']);
        expect(replacement.port.promptCalls[0]).toContain('Start over on T-1.');
        const order = (spy: typeof release | typeof assign, nth: number) => spy.mock.invocationCallOrder[nth]!;
        expect(order(release, 0)).toBeLessThan(order(assign, 1));
        expect(stubAgentPort.promptCalls[2]).toContain('status="interrupted"');
      });
    });

    describe('a run that is finishing', () => {
      it('should take an instruction that arrives after its last prompt as a follow-up', async () => {
        withTasks('T-1');
        const developer = scriptedDelegate(true);
        ceoAnswers([['FIRST', onTask('T-1', 'Build T-1.')], ['SECOND', onTask('T-1', 'Add tests.')], ['RESULT-ONE', 'Done one.'], ['RESULT-TWO', 'Done two.']]);
        const board = holdBoard('get');

        const first = useCase.execute(turnRequest({ prompt: 'FIRST' }));
        await rs.waitFor(() => expect(developer.port.promptCalls).toHaveLength(1));
        board.arm();
        await developer.respond('RESULT-ONE', 1);
        await board.held;
        const second = useCase.execute(turnRequest({ prompt: 'SECOND' }));
        await rs.waitFor(() => expect(runtime.findActiveDelegation('conv-1', 'DEVELOPER')?.control.queued).toBe(1));
        board.release();
        await developer.respond('RESULT-TWO', 2);

        await expect(first).resolves.toMatchObject({ response: 'Done two.' });
        await expect(second).resolves.toMatchObject({ status: 'steered' });
        expect(developer.port.steeringPrompts).toEqual([]);
        expect(developer.port.promptCalls[1]).toMatch(/^\[FOLLOW_UP\][\s\S]*Your artifact as it stands now:\n# T-1[\s\S]*\n\nAdd tests\.\n\[\/FOLLOW_UP\]/);
      });

      it('should take an interruption that arrives after the last prompt as a follow-up', async () => {
        withTasks('T-1');
        const developer = scriptedDelegate();
        ceoAnswers([['FIRST', onTask('T-1', 'Build T-1.')], ['SECOND', onTask('T-1', 'Add tests.', ' on_busy="interrupt"')], ['RESULT-ONE', 'Done one.'], ['RESULT-TWO', 'Done two.']]);
        const board = holdBoard('get');

        const first = useCase.execute(turnRequest({ prompt: 'FIRST' }));
        await rs.waitFor(() => expect(developer.port.promptCalls).toHaveLength(1));
        board.arm();
        await developer.respond('RESULT-ONE', 1);
        await board.held;
        const second = useCase.execute(turnRequest({ prompt: 'SECOND' }));
        await rs.waitFor(() => expect(runtime.findActiveDelegation('conv-1', 'DEVELOPER')?.control.queued).toBe(1));
        board.release();
        await developer.respond('RESULT-TWO', 2);

        await expect(second).resolves.toMatchObject({ status: 'steered' });
        await expect(first).resolves.toMatchObject({ response: 'Done two.' });
        expect(developer.port.cancelCalls).toBe(0);
        expect(developer.port.promptCalls[1]).toContain('[FOLLOW_UP]');
      });

      it('should take as a follow-up an instruction the agent could not take because its run ended meanwhile', async () => {
        withTasks('T-1');
        const developer = scriptedDelegate(true);
        ceoAnswers([['FIRST', onTask('T-1', 'Build T-1.')], ['SECOND', onTask('T-1', 'Add tests.')], ['RESULT-ONE', 'Done one.'], ['RESULT-TWO', 'Done two.']]);
        const board = holdBoard('get');
        developer.port.sendSteeringPrompt = async () => {
          board.arm();
          await developer.respond('RESULT-ONE', 1);
          await board.held;
          return 'not_running';
        };

        const first = useCase.execute(turnRequest({ prompt: 'FIRST' }));
        await rs.waitFor(() => expect(developer.port.promptCalls).toHaveLength(1));
        const second = useCase.execute(turnRequest({ prompt: 'SECOND' }));
        await rs.waitFor(() => expect(runtime.findActiveDelegation('conv-1', 'DEVELOPER')?.control.queued).toBe(1));
        board.release();
        await developer.respond('RESULT-TWO', 2);

        await expect(second).resolves.toMatchObject({ status: 'steered' });
        await expect(first).resolves.toMatchObject({ response: 'Done two.' });
        expect(developer.port.promptCalls[1]).toContain('[FOLLOW_UP]');
      });

      it('should start an instruction that arrives while the agent closes once it ended, resuming the session of its task', async () => {
        withTasks('T-1');
        const developer = scriptedDelegate(true);
        const next = scriptedDelegate(true);
        ceoAnswers([['FIRST', onTask('T-1', 'Build T-1.')], ['SECOND', onTask('T-1', 'Add tests.')], ['RESULT-ONE', 'Done one.'], ['RESULT-TWO', 'Done two.']]);
        const board = holdBoard('release');

        const first = useCase.execute(turnRequest({ prompt: 'FIRST' }));
        await rs.waitFor(() => expect(developer.port.promptCalls).toHaveLength(1));
        board.arm();
        await developer.respond('RESULT-ONE', 1);
        await board.held;
        const second = useCase.execute(turnRequest({ prompt: 'SECOND' }));
        await rs.waitFor(() => expect(runtime.findActiveDelegation('conv-1', 'DEVELOPER')?.control.queued).toBe(1));
        board.release();
        await next.respond('RESULT-TWO', 1);

        await expect(first).resolves.toMatchObject({ response: 'Done two.' });
        await expect(second).resolves.toMatchObject({ status: 'steered' });
        expect(next.port.loadSessionCalls).toEqual([{ cwd: '/mock/workspace/my-app', sessionId: 'session-1' }]);
        expect(next.port.promptCalls[0]).toContain('Add tests.');
      });
    });
  });

  describe('artifacts', () => {
    const contracts: Record<string, DelegationContract> = {
      DEVELOPER: { project: 'required', sessionMode: 'overridable', artifact: 'required' },
      CODE_REVIEWER: { project: 'required', sessionMode: 'overridable', readOnly: true, artifact: 'required', needsReviewableWork: true },
      TECH_LEAD: { project: 'optional', readOnly: true, artifact: 'optional', asksUser: true },
      GIT_OPS: { project: 'optional' },
    };
    const accesses: Record<string, ArtifactAccess> = {
      CEO: { scope: 'board', create: true, sections: ['overview'], fields: ['status', 'refinement', 'title'] },
      DEVELOPER: { scope: 'task', sections: ['implementation_notes'], fields: ['branch'] },
      TECH_LEAD: { scope: 'tree', create: true, sections: ['technical_solution'], fields: ['refinement'] },
    };
    const seed = (...artifacts: Parameters<typeof buildArtifact>[0][]) =>
      artifacts.forEach(artifact => artifactStore.artifactsOf('conv-1').set(artifact.id, buildArtifact({ projectName: 'my-app', ...artifact })));

    beforeEach(() => {
      agentRegistry.getDelegationContract.mockImplementation((role: string) => contracts[role] ?? {});
      agentRegistry.getArtifactAccess.mockImplementation((role: string) => accesses[role] ?? { scope: 'task', sections: [], fields: [] });
      agentRegistry.hasRole.mockImplementation((role: string) => ['CEO', 'DEVELOPER', 'CODE_REVIEWER', 'TECH_LEAD', 'GIT_OPS'].includes(role));
    });

    it('should answer the artifact requests of the CEO in the same turn, discarding the draft, before it decides', async () => {
      stubAgentPort.mockResponses = ['Checking the board. <artifact_list/>', 'The board is empty.'];
      const onDraft = rs.fn();

      const result = await useCase.execute(turnRequest({ onDraft }));

      expect(result).toMatchObject({ status: 'completed', response: 'The board is empty.' });
      expect(stubAgentPort.promptCalls[1]).toContain('No artifact matches.');
      expect(onDraft).toHaveBeenCalledWith('');
    });

    it('should deliver the answer of the CEO in the same round as the updates and comments that go with it', async () => {
      seed({ id: 'T-1', title: 'Login' });
      stubAgentPort.mockResponses = ['Noted on the login task. <artifact_comment id="T-1">Use JWT.</artifact_comment>'];
      const onDraft = rs.fn();

      const result = await useCase.execute(turnRequest({ onDraft }));

      expect(result).toMatchObject({ status: 'completed', response: 'Noted on the login task.' });
      expect(stubAgentPort.promptCalls).toHaveLength(1);
      expect(onDraft).not.toHaveBeenCalledWith('');
      expect((await artifacts.get('conv-1', 'T-1'))?.history).toMatchObject([{ kind: 'commented', actor: { kind: 'agent', role: 'CEO' } }]);
    });

    it('should hand the CEO the id of what it created before taking an answer, so it can still delegate it', async () => {
      stubAgentPort.mockResponses = [
        'I will hand it to the developer. <artifact_create type="task" title="Login" project="my-app" business_refinement="skipped" technical_refinement="skipped"/>',
        '<delegate role="DEVELOPER" summary="Building" artifact="T-1">Implement T-1.</delegate>',
        'T-1 is built.',
      ];
      delegateStubPort.mockResponses = ['Built.'];
      const onDraft = rs.fn();

      const result = await useCase.execute(turnRequest({ onDraft }));

      expect(result).toMatchObject({ status: 'completed', response: 'T-1 is built.' });
      expect(stubAgentPort.promptCalls[1]).toContain('<request_result request="create" id="T-1" status="ok">');
      expect(stubAgentPort.promptCalls[1]).toContain('Your last response created artifacts, whose ids are in these results, so it was not taken as your final answer.');
      expect(onDraft).toHaveBeenCalledWith('');
      expect(delegateStubPort.promptCalls[0]).toContain('[DELEGATED_ARTIFACT]\nYou hold T-1');
    });

    it('should hand a delegate the id of what it created before taking its final answer', async () => {
      seed({ id: 'F-1', type: 'feature', title: 'Checkout' });
      stubAgentPort.mockResponses = ['<delegate role="TECH_LEAD" summary="Planning" artifact="F-1">Break F-1 into tasks.</delegate>', 'Planned.'];
      delegateStubPort.mockResponses = [
        'Created the task. <artifact_create type="task" title="Login" parent="F-1"/>',
        'Created T-1 under F-1.',
      ];

      await useCase.execute(turnRequest());

      expect(delegateStubPort.promptCalls[1]).toContain('<request_result request="create" id="T-1" status="ok">');
      expect(delegateStubPort.promptCalls[1]).toContain('then write your whole final answer again, opened the way your instructions say.');
      expect(stubAgentPort.promptCalls[1]).toContain('>\nCreated T-1 under F-1.\n</agent_result>');
    });

    it('should run the requests that go with a delegation and hand their results over with the agent results', async () => {
      seed({ id: 'T-1', title: 'Login', status: 'ready' });
      stubAgentPort.mockResponses = ['<artifact_update id="T-1" status="in_progress"/>\n<delegate role="DEVELOPER" summary="Building" artifact="T-1">Implement T-1.</delegate>', 'Done.'];
      delegateStubPort.mockResponses = ['Built.'];

      const result = await useCase.execute(turnRequest());

      expect(result).toMatchObject({ status: 'completed', response: 'Done.' });
      expect(delegateStubPort.promptCalls[0]).toContain('- Status: in_progress');
      expect(stubAgentPort.promptCalls[1]).toMatch(/^<request_results>\n<request_result request="update" id="T-1" status="ok">[\s\S]*<\/request_results>\n\n<agent_result role="DEVELOPER"/);
      expect(stubAgentPort.promptCalls[1]).not.toContain('was not taken as your final answer');
    });

    it('should hand the results of requests that go with questions over with the answers', async () => {
      stubAgentPort.mockResponses = ['<artifact_list/>\n<question>Which project?<option>demo</option></question>', 'Ok.'];
      const onQuestion = rs.fn();

      const turn = useCase.execute(turnRequest({ onQuestion }));
      await rs.waitFor(() => expect(onQuestion).toHaveBeenCalled());
      questionQueue.submit('conv-1', { kind: 'option', optionIndex: 1 });

      expect(await turn).toMatchObject({ status: 'completed', response: 'Ok.' });
      expect(stubAgentPort.promptCalls[1]).toMatch(/^<request_results>[\s\S]*No artifact matches\.[\s\S]*<\/request_results>\n\n<user_answers>/);
    });

    it('should hand a delegate the results of requests that go with its questions over with the answers', async () => {
      seed({ id: 'T-1' });
      stubAgentPort.mockResponses = ['<delegate role="TECH_LEAD" summary="Planning" artifact="T-1">Plan T-1.</delegate>', 'Done.'];
      delegateStubPort.mockResponses = ['<artifact_comment id="T-1">Starting.</artifact_comment><question>Which name?</question>', 'Planned.'];
      const onQuestion = rs.fn();

      const turn = useCase.execute(turnRequest({ onQuestion }));
      await rs.waitFor(() => expect(onQuestion).toHaveBeenCalled());
      questionQueue.submit('conv-1', { kind: 'text', text: 'multiply' });

      expect((await turn).status).toBe('completed');
      expect(delegateStubPort.promptCalls[1]).toMatch(/^<request_results>[\s\S]*Commented on T-1[\s\S]*<\/request_results>\n\n<user_answers>/);
    });

    it('should carry out the requests written outside the final response envelope, without asking again', async () => {
      seed({ id: 'T-1', status: 'ready' });
      stubAgentPort.mockResponses = ['<artifact_update id="T-1" status="in_progress"/>\nNo need for `<artifact_list/>` now.\n<final_response>Starting T-1.</final_response>'];
      const log = rs.spyOn(Logger.prototype, 'log');

      const result = await useCase.execute(turnRequest());
      const messages = log.mock.calls.map(([message]) => message);
      log.mockRestore();

      expect(result).toMatchObject({ status: 'completed', response: 'Starting T-1.' });
      expect(stubAgentPort.promptCalls).toHaveLength(1);
      expect(await artifacts.get('conv-1', 'T-1')).toMatchObject({ status: 'in_progress' });
      expect(messages).toContain('[Stray Requests] Role=CEO: artifact_update outside the final response, carried out');
    });

    it('should ask again when other protocol tags were written outside the final response envelope', async () => {
      stubAgentPort.mockResponses = [
        '<artifact_list status="all"/>\n<question>Which board?</question>\n<final_response>Vou conferir o quadro.</final_response>',
        '<final_response><artifact_list status="all"/></final_response>',
        'Nothing on the board yet.',
      ];
      const onDraft = rs.fn();

      const result = await useCase.execute(turnRequest({ onDraft }));

      expect(stubAgentPort.promptCalls[1]).toBe('[PROTOCOL_ERROR]\nYour previous response wrote <artifact_list>, <question> outside the <final_response> block, where text is only progress narration, so nothing was done with it.\nAnswer again with every protocol tag, and the text that goes with it, inside a single <final_response>...</final_response> block.');
      expect(stubAgentPort.promptCalls[2]).toContain('No artifact matches.');
      expect(result).toMatchObject({ status: 'completed', response: 'Nothing on the board yet.' });
      expect(onDraft).toHaveBeenCalledWith('');
    });

    it('should ask the CEO again when its response has more than one final response block, and use the single block it answers with', async () => {
      stubAgentPort.mockResponses = [
        '<final_response>Checking.<artifact_list status="all"/></final_response>\nInvented continuation.\n<final_response>Checking again.<artifact_list status="all"/></final_response>',
        '<final_response><artifact_list status="all"/></final_response>',
        '<final_response>Nothing on the board yet.</final_response>',
      ];
      const onDraft = rs.fn();
      const warn = rs.spyOn(Logger.prototype, 'warn');

      const result = await useCase.execute(turnRequest({ onDraft }));
      const messages = warn.mock.calls.map(([message]) => message);
      warn.mockRestore();

      expect(stubAgentPort.promptCalls[1]).toBe('[PROTOCOL_ERROR]\nYour previous response had 2 <final_response> blocks, but a turn has exactly one, so nothing was done with it.\nAnswer again with the whole answer, every protocol tag included, in a single <final_response>...</final_response> block at the end of the turn.');
      expect(stubAgentPort.promptCalls[2]).toContain('No artifact matches.');
      expect(result).toMatchObject({ status: 'completed', response: 'Nothing on the board yet.' });
      expect(onDraft).toHaveBeenCalledWith('');
      expect(messages).toContain('[Protocol Repair] Role=CEO: 2 final response blocks');
    });

    it('should repair a delegate whose response has more than one final response block, without touching the draft of the CEO', async () => {
      seed({ id: 'T-1' });
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Building" artifact="T-1">Implement T-1.</delegate>', 'Done.'];
      delegateStubPort.mockResponses = ['<final_response>Built.</final_response>\n<final_response>Built again.</final_response>', '<final_response>Built.</final_response>'];
      const onDraft = rs.fn();

      await useCase.execute(turnRequest({ onDraft }));

      expect(delegateStubPort.promptCalls[1]).toContain('Your previous response had 2 <final_response> blocks');
      expect(stubAgentPort.promptCalls[1]).toContain('>\nBuilt.\n</agent_result>');
      expect(onDraft).not.toHaveBeenCalledWith('');
    });

    it('should take the content of the only final response block, with narration before it and text after it, without asking again', async () => {
      stubAgentPort.mockResponses = ['Looking at it.\n<final_response>All done.</final_response>\nThis text is discarded.'];

      const result = await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls).toHaveLength(1);
      expect(result).toMatchObject({ status: 'completed', response: 'All done.' });
    });

    it('should take the whole text of a response without a final response block, without asking again', async () => {
      stubAgentPort.mockResponses = ['Just an answer.'];

      const result = await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls).toHaveLength(1);
      expect(result).toMatchObject({ status: 'completed', response: 'Just an answer.' });
    });

    it('should carry out the requests a delegate wrote outside its final response along with that response', async () => {
      seed({ id: 'T-1' });
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Building" artifact="T-1">Implement T-1.</delegate>', 'Done.'];
      delegateStubPort.mockResponses = ['<artifact_comment id="T-1">Built it.</artifact_comment><final_response>Built.</final_response>'];

      await useCase.execute(turnRequest());

      expect(delegateStubPort.promptCalls).toHaveLength(1);
      expect(stubAgentPort.promptCalls[1]).toContain('>\nBuilt.\n</agent_result>');
      expect((await artifacts.get('conv-1', 'T-1'))?.history).toContainEqual(expect.objectContaining({ kind: 'commented', text: 'Built it.' }));
    });

    it('should carry out once a request written both outside and inside the final response', async () => {
      seed({ id: 'T-1' });
      const comment = '<artifact_comment id="T-1">Noted.</artifact_comment>';
      stubAgentPort.mockResponses = [`${comment}\n<artifact_update id="T-1" title="Login"/>\n<final_response>Done.\n${comment}</final_response>`];

      const result = await useCase.execute(turnRequest());

      expect(result).toMatchObject({ status: 'completed', response: 'Done.' });
      expect((await artifacts.get('conv-1', 'T-1'))?.history.filter(event => event.kind === 'commented')).toHaveLength(1);
      expect(await artifacts.get('conv-1', 'T-1')).toMatchObject({ title: 'Login' });
    });

    it('should repair a delegate that wrote other protocol tags outside its final response, without touching the draft of the CEO', async () => {
      seed({ id: 'T-1' });
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Building" artifact="T-1">Implement T-1.</delegate>', 'Done.'];
      delegateStubPort.mockResponses = ['<artifact_comment id="T-1">x</artifact_comment><attachment>a.png</attachment><final_response>Built.</final_response>', 'Built.'];
      const onDraft = rs.fn();

      await useCase.execute(turnRequest({ onDraft }));

      expect(delegateStubPort.promptCalls[1]).toContain('[PROTOCOL_ERROR]');
      expect(onDraft).not.toHaveBeenCalledWith('');
    });

    it('should take the last response as it is when the requests never stop', async () => {
      stubAgentPort.mockResponses = Array.from({ length: 31 }, () => '<artifact_list/>');

      const result = await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls).toHaveLength(31);
      expect(result.status).toBe('completed');
    });

    it('should run the delegate in the artifact project with its content, holding it until it finishes', async () => {
      seed({ id: 'T-1', title: 'Login', sections: { technical_solution: 'Use JWT.' } });
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Building the login" artifact="t-1">Implement T-1.</delegate>', 'Done.'];
      delegateStubPort.mockResponses = ['<artifact_update id="T-1" branch="feat/t-1"/>', 'Built on feat/t-1.'];
      const onDelegation = rs.fn();

      const result = await useCase.execute(turnRequest({ onDelegation }));

      expect(result.status).toBe('completed');
      expect(workspacePort.resolveRepositoryPath).toHaveBeenCalledWith('my-app');
      expect(delegateStubPort.promptCalls[0]).toContain('[DELEGATED_ARTIFACT]\nYou hold T-1 while you work on it.\n\n# T-1 · Login');
      expect(delegateStubPort.promptCalls[0]).toContain('## Technical solution\nUse JWT.\n[/DELEGATED_ARTIFACT]\n\nImplement T-1.');
      expect(delegateStubPort.promptCalls[1]).toContain('<request_result request="update" id="T-1" status="ok">');
      expect(stubAgentPort.promptCalls[1]).toContain('<agent_result role="DEVELOPER" project="my-app" artifact="T-1" artifact_status="ready"');
      expect(onDelegation).toHaveBeenCalledWith(expect.objectContaining({ phase: 'started', artifactId: 'T-1' }));
      expect(await artifacts.get('conv-1', 'T-1')).toMatchObject({
        assignee: null,
        branch: 'feat/t-1',
        history: [
          { kind: 'assigned', summary: 'DEVELOPER took it' },
          { kind: 'updated' },
          { kind: 'released', summary: 'DEVELOPER released it: finished' },
        ],
      });
    });

    it('should report a delegation whose artifact another delegation of the role took meanwhile as failed', async () => {
      seed({ id: 'T-1', assignee: { role: 'DEVELOPER', roleName: 'DEVELOPER', delegationId: 'elsewhere', since: '2026-01-01T00:00:00.000Z' } });
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Building" artifact="T-1">Implement T-1.</delegate>', 'Ok.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls[1]).toContain('<agent_result role="DEVELOPER" project="my-app" artifact="T-1" artifact_status="ready" status="failed">\nT-1 is with DEVELOPER (DEVELOPER) right now');
      expect(delegateStubPort.connectCalls).toBe(0);
    });

    it('should tell the CEO the status of the artifact a failed delegation held', async () => {
      seed({ id: 'T-1', status: 'in_progress' });
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Building" artifact="T-1">Implement T-1.</delegate>', 'Ok.'];
      delegateStubPort.promptErrorToThrow = new Error('agent crashed');

      await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls[1]).toContain('<agent_result role="DEVELOPER" project="my-app" artifact="T-1" artifact_status="in_progress" agent="stub" model="default" effort="default" status="failed">\nagent crashed\n</agent_result>');
      expect(await artifacts.get('conv-1', 'T-1')).toMatchObject({ assignee: null, history: [expect.anything(), { kind: 'released', summary: 'DEVELOPER released it: failed' }] });
    });

    /**
     * Makes the delegate's next prompt run `during` before it answers, as a user acting on the board while it works; a
     * cancel meanwhile ends the prompt the way an ACP agent does.
     */
    const whileDelegateWorks = (during: () => Promise<unknown>, answer: string) => {
      const prompt = delegateStubPort.prompt.bind(delegateStubPort);
      delegateStubPort.prompt = async function* (text: string) {
        await during();
        if (delegateStubPort.cancelCalls > 0) {
          throw new PromptCancelledError();
        }
        delegateStubPort.mockResponses = [answer];
        yield* prompt(text);
      };
    };

    it('should tell the CEO when the user set the status of the artifact while the agent worked on it', async () => {
      seed({ id: 'T-1', status: 'in_progress' });
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Building" artifact="T-1">Implement T-1.</delegate>', 'Done.'];
      whileDelegateWorks(() => artifacts.update('conv-1', 'T-1', { status: 'in_review' }, { kind: 'user', channel: 'web' }), 'Built.');

      await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls[1]).toContain('<agent_result role="DEVELOPER" project="my-app" artifact="T-1" artifact_status="in_review" artifact_status_by="user"');
    });

    it('should stop the agent and report it to the CEO when the user ends the work on its artifact', async () => {
      seed({ id: 'T-1', status: 'in_progress' });
      const stopWork = new StopArtifactWorkUseCase(artifacts, runtime);
      stopWork.onModuleInit();
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Building" artifact="T-1">Implement T-1.</delegate>', 'Noted.'];
      whileDelegateWorks(async () => {
        await artifacts.update('conv-1', 'T-1', { status: 'cancelled' }, { kind: 'user', channel: 'web' });
        await rs.waitFor(() => expect(delegateStubPort.cancelCalls).toBe(1));
      }, 'Built anyway.');
      const onDelegation = rs.fn();

      const result = await useCase.execute(turnRequest({ onDelegation }));
      stopWork.onModuleDestroy();

      expect(result).toMatchObject({ status: 'completed', response: 'Noted.' });
      expect(stubAgentPort.promptCalls[1]).toContain('<agent_result role="DEVELOPER" project="my-app" artifact="T-1" artifact_status="cancelled" artifact_status_by="user" agent="stub" model="default" effort="default" status="stopped">\nThe user moved T-1 to cancelled on the board, which stopped this agent before it finished. What it changed in project "my-app" before stopping stays there as it left it');
      expect(onDelegation).toHaveBeenCalledWith(expect.objectContaining({ phase: 'cancelled', artifactId: 'T-1' }));
      expect(await artifacts.get('conv-1', 'T-1')).toMatchObject({ assignee: null, status: 'cancelled' });
      expect((await artifacts.get('conv-1', 'T-1'))?.history.at(-1)).toMatchObject({ kind: 'released', summary: 'DEVELOPER released it: stopped by the user' });
    });

    it('should log a release that fails without failing the delegation', async () => {
      seed({ id: 'T-1' });
      artifacts.release = () => Promise.reject(new Error('disk full'));
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Building" artifact="T-1">Implement T-1.</delegate>', 'Done.'];
      delegateStubPort.mockResponses = ['Built.'];

      expect((await useCase.execute(turnRequest())).status).toBe('completed');
    });

    describe('a session per task', () => {
      const storedAgentSessions = async () => (await sessionStore.findSession('conv-1'))?.agentSessions;
      const developerSession = (sessionId: string, artifactId: string | null) =>
        ({ role: 'DEVELOPER', agentId: 'stub', sessionId, projectName: 'my-app', artifactId, ...mockPrompt });

      beforeEach(async () => {
        sessionStore.seed(buildSessionContext({
          agentSessions: [developerSession('dev-project', null), developerSession('dev-t1', 'T-1')],
        }));
      });

      it('should create a session for a task the role has no session for, keeping those of its other work', async () => {
        seed({ id: 'T-1' }, { id: 'T-2' });
        stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Building" artifact="T-2">Implement T-2.</delegate>', 'Done.'];
        delegateStubPort.mockResponses = ['Built.'];

        await useCase.execute(turnRequest());

        expect(delegateStubPort.loadSessionCalls).toEqual([]);
        expect(delegateStubPort.createSessionCalls).toEqual(['/mock/workspace/my-app']);
        expect(await storedAgentSessions()).toEqual([
          developerSession('dev-project', null),
          developerSession('dev-t1', 'T-1'),
          { role: 'CEO', agentId: 'stub', sessionId: 'session-1', projectName: null, artifactId: null, ...mockPrompt },
          { ...developerSession('session-1', 'T-2'), workEndedAt: expect.any(String) },
        ]);
      });

      it('should resume the session of the task for session="resume" and for no session attribute', async () => {
        seed({ id: 'T-1' });
        stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Building" artifact="T-1" session="resume">Implement T-1.</delegate>', 'Done.'];
        delegateStubPort.mockResponses = ['Built.'];

        const result = await useCase.execute(turnRequest());

        expect(result.status).toBe('completed');
        expect(stubAgentPort.promptCalls[1]).not.toContain('[DELEGATION_ERROR]');
        expect(delegateStubPort.loadSessionCalls).toEqual([{ cwd: '/mock/workspace/my-app', sessionId: 'dev-t1' }]);
        expect(delegateStubPort.createSessionCalls).toEqual([]);
      });

      it('should start a new session for the task for session="new", replacing the binding of the task and keeping the others', async () => {
        seed({ id: 'T-1', sections: { technical_solution: 'Use JWT.' } });
        stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Building" artifact="T-1" session="new">Implement T-1.</delegate>', 'Done.'];
        delegateStubPort.mockResponses = ['Built.'];

        const result = await useCase.execute(turnRequest());

        expect(result.status).toBe('completed');
        expect(delegateStubPort.loadSessionCalls).toEqual([]);
        expect(delegateStubPort.createSessionCalls).toEqual(['/mock/workspace/my-app']);
        expect(delegateStubPort.promptCalls[0]).toMatch(/^Mock system prompt\.\n\n\[DELEGATED_ARTIFACT\]\nYou hold T-1 while you work on it\.[\s\S]*## Technical solution\nUse JWT\./);
        expect(await storedAgentSessions()).toEqual([
          developerSession('dev-project', null),
          { role: 'CEO', agentId: 'stub', sessionId: 'session-1', projectName: null, artifactId: null, ...mockPrompt },
          { ...developerSession('session-1', 'T-1'), workEndedAt: expect.any(String) },
        ]);
      });

      it('should resume the session a delegation with session="new" started in the next delegation of the task', async () => {
        seed({ id: 'T-1' });
        stubAgentPort.mockResponses = [
          '<delegate role="DEVELOPER" summary="Building" artifact="T-1" session="new">Start over on T-1.</delegate>',
          '<delegate role="DEVELOPER" summary="Fixing" artifact="T-1">Fix T-1.</delegate>',
          'Done.',
        ];
        delegateStubPort.mockResponses = ['Built.', 'Fixed.'];

        await useCase.execute(turnRequest());

        expect(delegateStubPort.createSessionCalls).toEqual(['/mock/workspace/my-app']);
        expect(delegateStubPort.loadSessionCalls).toEqual([{ cwd: '/mock/workspace/my-app', sessionId: 'session-1' }]);
        expect((await storedAgentSessions())?.filter(binding => binding.artifactId === 'T-1')).toEqual([{ ...developerSession('session-1', 'T-1'), workEndedAt: expect.any(String) }]);
      });

      it('should refuse the session attribute with an artifact to a role whose contract has no session mode', async () => {
        seed({ id: 'T-1' });
        stubAgentPort.mockResponses = ['<delegate role="TECH_LEAD" summary="Planning" artifact="T-1" session="new">Plan T-1.</delegate>', 'Ok.'];

        await useCase.execute(turnRequest());

        expect(stubAgentPort.promptCalls[1]).toContain('Role "TECH_LEAD" does not take a session mode. Use <delegate role="TECH_LEAD" summary="<summary>"> without the session attribute.');
        expect(delegateStubPort.createSessionCalls).toEqual([]);
      });

      it('should keep the session of the work without a task for a delegation without an artifact', async () => {
        stubAgentPort.mockResponses = ['<delegate role="TECH_LEAD" summary="Investigating" project="my-app">Investigate.</delegate>', 'Done.'];
        delegateStubPort.mockResponses = ['Found it.'];
        sessionStore.seed(buildSessionContext({
          agentSessions: [
            { role: 'TECH_LEAD', agentId: 'stub', sessionId: 'tl-t1', projectName: 'my-app', artifactId: 'T-1' },
            { role: 'TECH_LEAD', agentId: 'stub', sessionId: 'tl-project', projectName: 'my-app', artifactId: null },
          ],
        }));

        await useCase.execute(turnRequest());

        expect(delegateStubPort.loadSessionCalls).toEqual([{ cwd: '/mock/workspace/my-app', sessionId: 'tl-project' }]);
      });

      it('should give a resumed session only what changed on the task since its work on it ended, after the re-entry note', async () => {
        agentRegistry.getReentryNote.mockReturnValue('[RE-ENTRY] note');
        sessionStore.seed(buildSessionContext({ agentSessions: [{ ...developerSession('dev-t1', 'T-1'), workEndedAt: '2026-01-01T00:00:00.000Z' }] }));
        seed({
          id: 'T-1',
          title: 'Login',
          status: 'changes_requested',
          branch: 'feat/t-1',
          sections: { technical_solution: 'Use JWT.', implementation_notes: 'Done on feat/t-1.' },
          history: [
            { id: 'h1', at: '2026-01-01T00:00:00.000Z', actor: { kind: 'agent', role: 'DEVELOPER', roleName: 'DEVELOPER' }, kind: 'released', summary: 'DEVELOPER released it: finished' },
            { id: 'h2', at: '2026-01-01T01:00:00.000Z', actor: { kind: 'agent', role: 'CODE_REVIEWER', roleName: 'CODE_REVIEWER' }, kind: 'commented', summary: 'Commented', text: 'Missing a test.' },
          ],
        });
        stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Fixing" artifact="T-1">Fix the review findings.</delegate>', 'Done.'];
        delegateStubPort.mockResponses = ['Fixed.'];

        await useCase.execute(turnRequest());

        const [prompt] = delegateStubPort.promptCalls;
        expect(prompt).toMatch(/^\[RE-ENTRY\] note\n\n\[DELEGATED_ARTIFACT\]\nYou hold T-1 while you work on it\.\n\n# T-1 · Login\n/);
        expect(prompt).toContain('- Branch: feat/t-1');
        expect(prompt).toContain('2026-01-01T01:00:00.000Z CODE_REVIEWER: Missing a test.\n[/DELEGATED_ARTIFACT]\n\nFix the review findings.');
        expect(prompt).not.toContain('Use JWT.');
      });

      it('should tell a session what changed since its own work ended, the work of the role on another coding agent included', async () => {
        const developer = { kind: 'agent', role: 'DEVELOPER', roleName: 'DEVELOPER' } as const;
        sessionStore.seed(buildSessionContext({ agentSessions: [{ ...developerSession('dev-t1', 'T-1'), workEndedAt: '2026-01-01T00:00:00.000Z' }] }));
        seed({
          id: 'T-1',
          sections: { technical_solution: 'Use JWT.', implementation_notes: 'Built on the other agent.' },
          history: [
            { id: 'h1', at: '2026-01-01T00:00:00.000Z', actor: developer, kind: 'released', summary: 'DEVELOPER released it: finished' },
            { id: 'h2', at: '2026-01-01T01:00:00.000Z', actor: developer, kind: 'updated', summary: 'Updated', changes: [{ field: 'section:implementation_notes', to: 'replaced' }] },
            { id: 'h3', at: '2026-01-01T01:30:00.000Z', actor: developer, kind: 'released', summary: 'DEVELOPER released it: finished' },
          ],
        });
        stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Fixing" artifact="T-1">Fix it.</delegate>', 'Done.'];
        delegateStubPort.mockResponses = ['Fixed.'];

        await useCase.execute(turnRequest());

        expect(delegateStubPort.loadSessionCalls).toEqual([{ cwd: '/mock/workspace/my-app', sessionId: 'dev-t1' }]);
        expect(delegateStubPort.promptCalls[0]).toContain('## Implementation notes\nBuilt on the other agent.\n[/DELEGATED_ARTIFACT]');
        expect(delegateStubPort.promptCalls[0]).not.toContain('Use JWT.');
      });

      it('should give the whole task to a resumed session that records no end of its work', async () => {
        seed({ id: 'T-1', sections: { technical_solution: 'Use JWT.' } });
        stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Fixing" artifact="T-1">Fix it.</delegate>', 'Done.'];
        delegateStubPort.mockResponses = ['Fixed.'];

        await useCase.execute(turnRequest());

        expect(delegateStubPort.loadSessionCalls).toEqual([{ cwd: '/mock/workspace/my-app', sessionId: 'dev-t1' }]);
        expect(delegateStubPort.promptCalls[0]).toContain('## Technical solution\nUse JWT.\n[/DELEGATED_ARTIFACT]');
      });

      it('should give a feature whole to a resumed session, since what changed in its tasks is not in its own history', async () => {
        sessionStore.seed(buildSessionContext({
          agentSessions: [{ role: 'TECH_LEAD', agentId: 'stub', sessionId: 'tl-f1', projectName: 'my-app', artifactId: 'F-1', workEndedAt: '2026-01-01T00:00:00.000Z' }],
        }));
        seed({
          id: 'F-1',
          type: 'feature',
          title: 'Checkout',
          sections: { overview: 'Sell online.' },
          history: [{ id: 'h1', at: '2026-01-01T00:00:00.000Z', actor: { kind: 'agent', role: 'TECH_LEAD', roleName: 'TECH_LEAD' }, kind: 'released', summary: 'TECH_LEAD released it: finished' }],
        }, { id: 'T-1', title: 'Login', parentId: 'F-1' });
        stubAgentPort.mockResponses = ['<delegate role="TECH_LEAD" summary="Planning" artifact="F-1">Plan F-1 again.</delegate>', 'Done.'];
        delegateStubPort.mockResponses = ['Planned.'];

        await useCase.execute(turnRequest());

        expect(delegateStubPort.loadSessionCalls).toEqual([{ cwd: '/mock/workspace/my-app', sessionId: 'tl-f1' }]);
        expect(delegateStubPort.promptCalls[0]).toContain('- Type: feature');
        expect(delegateStubPort.promptCalls[0]).toContain('## Overview\nSell online.');
      });

      it('should record no end of work for a delegation that never reached a session', async () => {
        seed({ id: 'T-2' });
        delegateStubPort.errorToThrowOnConnect = new Error('agent missing');
        stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Building" artifact="T-2">Implement T-2.</delegate>', 'Done.'];

        await useCase.execute(turnRequest());

        expect((await storedAgentSessions())?.filter(binding => binding.workEndedAt)).toEqual([]);
      });

      it('should bring the system prompt and the whole task again to a session that answered no prompt', async () => {
        agentRegistry.getReentryNote.mockReturnValue('[RE-ENTRY] note');
        seed({ id: 'T-2', sections: { technical_solution: 'Use JWT.' } });
        const delegation = '<delegate role="DEVELOPER" summary="Building" artifact="T-2">Implement T-2.</delegate>';
        stubAgentPort.mockResponses = [delegation, 'Failed.'];
        delegateStubPort.errorToThrowOnPrompt = new Error('usage limit');

        await useCase.execute(turnRequest());

        expect(await storedAgentSessions()).toContainEqual({ ...developerSession('session-1', 'T-2'), promptHash: undefined, unanswered: true });

        delegateStubPort.errorToThrowOnPrompt = null;
        stubAgentPort.mockResponses = [delegation, 'Done.'];
        delegateStubPort.mockResponses = ['Built.'];

        await useCase.execute(turnRequest());

        const prompt = delegateStubPort.promptCalls.at(-1);
        expect(delegateStubPort.loadSessionCalls).toEqual([{ cwd: '/mock/workspace/my-app', sessionId: 'session-1' }]);
        expect(prompt).toMatch(/^Mock system prompt\.\n\n\[DELEGATED_ARTIFACT\]/);
        expect(prompt).toContain('## Technical solution\nUse JWT.\n[/DELEGATED_ARTIFACT]\n\nImplement T-2.');
        expect(prompt).not.toContain('[RE-ENTRY]');
        expect(await storedAgentSessions()).toContainEqual({ ...developerSession('session-1', 'T-2'), workEndedAt: expect.any(String) });
      });

      it('should keep the earlier end of work of a session whose delegation the agent did not answer', async () => {
        sessionStore.seed(buildSessionContext({ agentSessions: [{ ...developerSession('dev-t1', 'T-1'), workEndedAt: '2026-01-01T00:00:00.000Z' }] }));
        seed({ id: 'T-1', status: 'changes_requested' });
        stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Fixing" artifact="T-1">Fix it.</delegate>', 'Failed.'];
        delegateStubPort.errorToThrowOnPrompt = new Error('usage limit');

        await useCase.execute(turnRequest());

        expect(await storedAgentSessions()).toContainEqual({ ...developerSession('dev-t1', 'T-1'), workEndedAt: '2026-01-01T00:00:00.000Z' });
      });

      it('should leave alone the binding another session of the task took before the agent first answered', async () => {
        seed({ id: 'T-2' });
        stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Building" artifact="T-2">Implement T-2.</delegate>', 'Done.'];
        whileDelegateWorks(async () => sessionStore.seed(buildSessionContext({ agentSessions: [{ ...developerSession('dev-t2-elsewhere', 'T-2'), unanswered: true }] })), 'Built.');

        await useCase.execute(turnRequest());

        expect(await storedAgentSessions()).toContainEqual({ ...developerSession('dev-t2-elsewhere', 'T-2'), unanswered: true });
      });

      it('should log a session that fails to record its first answer, without failing the delegation', async () => {
        seed({ id: 'T-2' });
        const update = sessionStore.updateSession.bind(sessionStore);
        sessionStore.updateSession = async (conversationId, change) => update(conversationId, (session) => {
          const updated = change(session);
          if (session.agentSessions.some(binding => binding.unanswered && binding.role === 'DEVELOPER') && !updated?.agentSessions.some(binding => binding.unanswered)) {
            throw new Error('disk full');
          }
          return updated;
        });
        stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Building" artifact="T-2">Implement T-2.</delegate>', 'Done.'];
        delegateStubPort.mockResponses = ['Built.'];
        const error = rs.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

        const result = await useCase.execute(turnRequest());
        const messages = error.mock.calls.map(([message]) => message);
        error.mockRestore();

        expect(result.status).toBe('completed');
        expect(messages).toContain('[Session Record Failed] Role=DEVELOPER: disk full');
      });

      it('should bring the system prompt again to the live session of a CEO that answered no prompt', async () => {
        stubAgentPort.errorToThrowOnPrompt = new Error('usage limit');

        await useCase.execute(turnRequest());

        expect(await storedAgentSessions()).toContainEqual({ role: 'CEO', agentId: 'stub', sessionId: 'session-1', projectName: null, artifactId: null, unanswered: true });

        stubAgentPort.errorToThrowOnPrompt = null;
        stubAgentPort.mockResponses = ['Done.'];

        await useCase.execute(turnRequest());

        expect(stubAgentPort.createSessionCalls).toHaveLength(1);
        expect(stubAgentPort.promptCalls.at(-1)).toMatch(/^Mock system prompt\./);
        expect(await storedAgentSessions()).toContainEqual({ role: 'CEO', agentId: 'stub', sessionId: 'session-1', projectName: null, artifactId: null, ...mockPrompt });
      });

      it('should leave alone a binding another session of the task took while the agent worked', async () => {
        seed({ id: 'T-1' });
        stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Fixing" artifact="T-1">Fix it.</delegate>', 'Done.'];
        whileDelegateWorks(async () => sessionStore.seed(buildSessionContext({ agentSessions: [developerSession('dev-t1-elsewhere', 'T-1')] })), 'Fixed.');

        await useCase.execute(turnRequest());

        expect(await storedAgentSessions()).toContainEqual(developerSession('dev-t1-elsewhere', 'T-1'));
      });

      it('should log a session that fails to record the end of its work, without failing the delegation', async () => {
        seed({ id: 'T-1' });
        const update = sessionStore.updateSession.bind(sessionStore);
        sessionStore.updateSession = async (conversationId, change) => update(conversationId, (session) => {
          const updated = change(session);
          if (updated?.agentSessions.some(binding => binding.workEndedAt)) {
            throw new Error('disk full');
          }
          return updated;
        });
        stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Fixing" artifact="T-1">Fix it.</delegate>', 'Done.'];
        delegateStubPort.mockResponses = ['Fixed.'];
        const error = rs.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

        const result = await useCase.execute(turnRequest());
        const messages = error.mock.calls.map(([message]) => message);
        error.mockRestore();

        expect(result.status).toBe('completed');
        expect(messages).toContain('[Session Record Failed] T-1: disk full');
      });

      it('should give the whole task to a session created because the stored one failed to load', async () => {
        delegateStubPort.loadSessionResult = false;
        seed({
          id: 'T-1',
          sections: { technical_solution: 'Use JWT.' },
          history: [{ id: 'h1', at: '2026-01-01T00:00:00.000Z', actor: { kind: 'agent', role: 'DEVELOPER', roleName: 'DEVELOPER' }, kind: 'released', summary: 'DEVELOPER released it: finished' }],
        });
        stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Fixing" artifact="T-1">Fix it.</delegate>', 'Done.'];
        delegateStubPort.mockResponses = ['Fixed.'];

        await useCase.execute(turnRequest());

        expect(delegateStubPort.promptCalls[0]).toContain('## Technical solution\nUse JWT.\n[/DELEGATED_ARTIFACT]\n\nFix it.');
        expect(await storedAgentSessions()).toContainEqual({ ...developerSession('session-1', 'T-1'), workEndedAt: expect.any(String) });
      });

      it('should resume the reviewer\'s own review session on its second review of the same task', async () => {
        seed({ id: 'T-2', status: 'in_review', branch: 'feat/t-2' });
        const review = '<delegate role="CODE_REVIEWER" summary="Reviewing" artifact="T-2">Review T-2.</delegate>';
        stubAgentPort.mockResponses = [review, review, 'Done.'];
        delegateStubPort.mockResponses = ['CHANGES_REQUESTED', 'APPROVED'];

        await useCase.execute(turnRequest());

        expect(delegateStubPort.createSessionCalls).toEqual(['/mock/workspace/my-app']);
        expect(delegateStubPort.loadSessionCalls).toEqual([{ cwd: '/mock/workspace/my-app', sessionId: 'session-1' }]);
        expect(delegateStubPort.promptCalls[1]).toContain('Nothing on T-2 besides the facts above changed since you last worked on it.');
      });
    });

    it('should let an agent that may take an artifact work without one, in the folder it was given', async () => {
      stubAgentPort.mockResponses = ['<delegate role="TECH_LEAD" summary="Investigating" project="my-app">Investigate.</delegate>', 'Done.'];
      delegateStubPort.mockResponses = ['Found it.'];

      await useCase.execute(turnRequest());

      expect(delegateStubPort.promptCalls[0]).not.toContain('[DELEGATED_ARTIFACT]');
    });

    it.each([
      ['a task-bound agent without an artifact', [], '<delegate role="DEVELOPER" summary="x" project="my-app">Go.</delegate>', 'DEVELOPER works on a task of the board: add artifact="<task id>" to the <delegate> tag'],
      ['an agent that takes no artifact', [{ id: 'T-1' }], '<delegate role="GIT_OPS" summary="x" artifact="T-1">Go.</delegate>', 'Role "GIT_OPS" does not take an artifact.'],
      ['an unknown artifact', [], '<delegate role="DEVELOPER" summary="x" artifact="T-9">Go.</delegate>', 'Unknown artifact "T-9".'],
      ['a feature for a task-bound agent', [{ id: 'F-1', type: 'feature' }], '<delegate role="DEVELOPER" summary="x" artifact="F-1">Go.</delegate>', 'DEVELOPER works on tasks only, and F-1 is a feature.'],
      ['a frozen artifact', [{ id: 'T-1', status: 'frozen' }], '<delegate role="DEVELOPER" summary="x" artifact="T-1">Go.</delegate>', 'T-1 is frozen after too many delegations, and only the user takes it out.'],
      ['a closed artifact', [{ id: 'T-1', status: 'done' }], '<delegate role="DEVELOPER" summary="x" artifact="T-1">Go.</delegate>', 'T-1 is done. Set its status back to an open one'],
      ['a review with neither a pull request nor a branch', [{ id: 'T-1' }], '<delegate role="CODE_REVIEWER" summary="x" artifact="T-1">Go.</delegate>', 'CODE_REVIEWER inspects the work of T-1, which has neither a pull request nor a branch yet.'],
      ['an artifact another role holds', [{ id: 'T-1', assignee: { role: 'TECH_LEAD', roleName: 'TL', delegationId: 'd', since: '2026-01-01T00:00:00.000Z' } }], '<delegate role="DEVELOPER" summary="x" artifact="T-1">Go.</delegate>', 'T-1 is with TECH_LEAD right now, and an artifact is with one agent at a time.'],
      ['another project', [{ id: 'T-1' }], '<delegate role="DEVELOPER" summary="x" artifact="T-1" project="project-a">Go.</delegate>', 'T-1 belongs to project "my-app", so the work on it runs there'],
      ['another project than the first of a feature', [{ id: 'F-1', type: 'feature', projectNames: ['my-app', 'site'] }], '<delegate role="TECH_LEAD" summary="x" artifact="F-1" project="site">Plan.</delegate>', 'F-1 belongs to project "my-app", so the work on it runs there'],
      ['the same artifact twice', [{ id: 'T-1' }], '<delegate role="DEVELOPER" summary="x" artifact="T-1">Go.</delegate><delegate role="TECH_LEAD" summary="y" artifact="T-1">Plan.</delegate>', 'T-1 appears in more than one delegation.'],
    ] as const)('should reject %s', async (_name, artifactsToSeed, delegation, reason) => {
      seed(...artifactsToSeed);
      stubAgentPort.mockResponses = [delegation, delegation];

      const result = await useCase.execute(turnRequest());

      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain(reason);
    });

    describe('the specification of a delegation with an artifact', () => {
      const delegateWith = (spec: string, attributes = 'artifact="T-1"') => [`<delegate role="DEVELOPER" summary="Building" ${attributes}>${spec}</delegate>`, 'Done.'];

      beforeEach(() => {
        seed({ id: 'T-1' });
        maxSpecChars = 20;
        delegateStubPort.mockResponses = ['Built.'];
      });

      it('should reject one longer than the limit, saying what to do instead', async () => {
        const [delegation] = delegateWith('Implement T-1 with JWT.');
        stubAgentPort.mockResponses = [delegation!, delegation!];

        const result = await useCase.execute(turnRequest());

        expect(result.status).toBe('failed');
        expect(stubAgentPort.promptCalls[1]).toContain(
          'The specification of T-1 has 23 characters, and the limit with an artifact is 20. The agent receives T-1 in full (its sections, branch, pull requests and comments), so say only what to do with it now. A fact the task lacks goes on it as a comment, where the agent reads it with the rest. Do not restate its sections.',
        );
      });

      it('should accept any length to redirect the agent of the role already working on that artifact', async () => {
        delegateStubPort.agentName = 'dev';
        delegateStubPort.supportsSteering = true;
        steeringSupport.record('dev', true);
        runtime.registerDelegation('conv-1', {
          delegationId: 'd-1',
          role: 'DEVELOPER',
          roleName: 'DEVELOPER',
          agentInfo: { roleName: 'DEVELOPER', agentName: 'stub' },
          projectName: 'my-app',
          artifactId: 'T-1',
          summary: 'Building',
          taskSpec: 'Implement T-1.',
          cwd: '/mock/workspace/my-app',
          startedAt: Date.now(),
          agentPort: delegateStubPort,
          turn: { cancel: rs.fn() } as any,
          control: control('Building'),
          stop: rs.fn(),
        });
        stubAgentPort.mockResponses = delegateWith('Stop the refactor and keep the old login API, as the user asked.');

        const result = await useCase.execute(turnRequest());

        expect(result).toMatchObject({ status: 'completed', response: 'Done.' });
        expect(delegateStubPort.steeringPrompts).toEqual([expect.stringContaining('Stop the refactor and keep the old login API, as the user asked.')]);
      });

      it('should keep the limit for a new session of the task the role is working on, which receives the artifact in full', async () => {
        delegateStubPort.agentName = 'dev';
        runtime.registerDelegation('conv-1', {
          delegationId: 'd-1',
          role: 'DEVELOPER',
          roleName: 'DEVELOPER',
          agentInfo: { roleName: 'DEVELOPER', agentName: 'dev' },
          projectName: 'my-app',
          artifactId: 'T-1',
          summary: 'Building',
          taskSpec: 'Implement T-1.',
          cwd: '/mock/workspace/my-app',
          startedAt: Date.now(),
          agentPort: delegateStubPort,
          turn: { cancel: rs.fn() } as any,
          control: control('Building'),
          stop: rs.fn(),
        });
        const [delegation] = delegateWith('Start over, keeping the old login API.', 'artifact="T-1" session="new" on_busy="wait"');
        stubAgentPort.mockResponses = [delegation!, delegation!];

        const result = await useCase.execute(turnRequest());

        expect(result.status).toBe('failed');
        expect(stubAgentPort.promptCalls[1]).toContain('The specification of T-1 has 38 characters, and the limit with an artifact is 20.');
      });

      it.each([
        ['one at the limit', () => delegateWith('Implement T-1 today.')],
        [
          'any length when the limit is 0', () => {
            maxSpecChars = 0;
            return delegateWith('Implement T-1 with JWT, as the user said.');
          },
        ],
        ['any length without an artifact', () => delegateWith('Investigate how the login works today.', 'project="my-app"')],
      ])('should accept %s', async (_name, responses) => {
        agentRegistry.getDelegationContract.mockImplementation((role: string) => (role === 'DEVELOPER' ? { project: 'optional', artifact: 'optional' } : {}));
        stubAgentPort.mockResponses = responses();

        const result = await useCase.execute(turnRequest());

        expect(result).toMatchObject({ status: 'completed', response: 'Done.' });
        expect(delegateStubPort.promptCalls).toHaveLength(1);
      });
    });

    describe('status flow', () => {
      const flows: Record<string, DelegationContract> = {
        ...contracts,
        DEVELOPER: {
          ...contracts.DEVELOPER,
          statusFlow: { from: ['ready', 'in_progress', 'changes_requested'], start: 'in_progress', verdicts: { DONE: 'in_review', INCOMPLETE: 'in_progress' } },
        },
        CODE_REVIEWER: {
          ...contracts.CODE_REVIEWER,
          statusFlow: { from: ['in_review'], verdicts: { APPROVED: 'approved', CHANGES_REQUESTED: 'changes_requested' } },
        },
        TECH_LEAD: { ...contracts.TECH_LEAD, refines: 'technical' },
      };
      const develop = '<delegate role="DEVELOPER" summary="Building" artifact="T-1">Implement T-1.</delegate>';
      const review = '<delegate role="CODE_REVIEWER" summary="Reviewing" artifact="T-1">Review T-1.</delegate>';
      const statusOf = async () => (await artifacts.get('conv-1', 'T-1'))?.status;

      beforeEach(() => {
        agentRegistry.getDelegationContract.mockImplementation((role: string) => flows[role] ?? {});
      });

      it.each([
        ['a status the role does not take', { status: 'in_review' }, develop, 'DEVELOPER works on T-1 only while it is ready, in_progress, changes_requested, and it is in_review right now. That status waits for another step'],
        ['a task that still owes a refinement', { status: 'backlog', refinement: { business: 'done', design: 'skipped', technical: 'pending' } }, develop, 'It still owes the technical refinement (TECH_LEAD)'],
        ['a frozen task with the reason of the freeze', { status: 'frozen' }, develop, 'T-1 is frozen after too many delegations'],
        ['a closed task with the reason of the closing', { status: 'done' }, develop, 'T-1 is done. Set its status back to an open one'],
        ['a review of a task out of order before checking its branch', { status: 'ready' }, review, 'CODE_REVIEWER works on T-1 only while it is in_review, and it is ready right now.'],
      ] as const)('should reject %s', async (_name, task, delegation, reason) => {
        seed({ id: 'T-1', ...task });
        stubAgentPort.mockResponses = [delegation, delegation];

        const result = await useCase.execute(turnRequest());

        expect(result.status).toBe('failed');
        expect(result.errorMessage).toContain(reason);
      });

      it('should start the task and apply the verdict the agent opens its answer with', async () => {
        seed({ id: 'T-1', status: 'ready' });
        stubAgentPort.mockResponses = [develop, 'Done.'];
        delegateStubPort.mockResponses = ['**DONE**\nBuilt on feat/t-1.'];

        await useCase.execute(turnRequest());

        expect(delegateStubPort.promptCalls[0]).toContain('- Status: in_progress');
        expect(stubAgentPort.promptCalls[1]).toContain('<agent_result role="DEVELOPER" project="my-app" artifact="T-1" verdict="DONE" artifact_status="in_review" agent="stub"');
        expect(await artifacts.get('conv-1', 'T-1')).toMatchObject({
          status: 'in_review',
          assignee: null,
          history: [
            { kind: 'assigned' },
            { kind: 'updated', actor: { kind: 'system' }, changes: [{ field: 'status', from: 'ready', to: 'in_progress' }] },
            { kind: 'updated', actor: { kind: 'system' }, changes: [{ field: 'status', from: 'in_progress', to: 'in_review' }] },
            { kind: 'released' },
          ],
        });
      });

      it('should send the task back with the verdict of a review', async () => {
        seed({ id: 'T-1', status: 'in_review', branch: 'feat/t-1' });
        stubAgentPort.mockResponses = [review, 'Done.'];
        delegateStubPort.mockResponses = ['CHANGES_REQUESTED\nThe login has no test.'];

        await useCase.execute(turnRequest());

        expect(await statusOf()).toBe('changes_requested');
        expect(stubAgentPort.promptCalls[1]).toContain('verdict="CHANGES_REQUESTED" artifact_status="changes_requested"');
      });

      it('should keep the status the user set while the agent worked, telling the CEO the verdict', async () => {
        seed({ id: 'T-1', status: 'in_progress' });
        stubAgentPort.mockResponses = [develop, 'Done.'];
        whileDelegateWorks(() => artifacts.update('conv-1', 'T-1', { status: 'approved' }, { kind: 'user', channel: 'web' }), 'DONE');

        await useCase.execute(turnRequest());

        expect(await statusOf()).toBe('approved');
        expect(stubAgentPort.promptCalls[1]).toContain('artifact="T-1" verdict="DONE" artifact_status="approved" artifact_status_by="user"');
      });

      it('should keep a status the CEO set while the agent worked, telling the CEO the verdict', async () => {
        seed({ id: 'T-1', status: 'in_progress' });
        stubAgentPort.mockResponses = [develop, 'Done.'];
        whileDelegateWorks(() => artifacts.update('conv-1', 'T-1', { status: 'blocked' }, { kind: 'agent', role: 'CEO', roleName: 'CEO' }), 'DONE');

        await useCase.execute(turnRequest());

        expect(await statusOf()).toBe('blocked');
        expect(stubAgentPort.promptCalls[1]).toContain('artifact="T-1" verdict="DONE" artifact_status="blocked" agent="stub"');
      });

      it('should apply the verdict of the whole final answer an agent writes again once its answer was sent back', async () => {
        seed({ id: 'T-1', status: 'ready' });
        stubAgentPort.mockResponses = [develop, 'Done.'];
        delegateStubPort.mockResponses = ['DONE\n<artifact_read id="T-1"/>', 'DONE\nBuilt on feat/t-1.'];

        await useCase.execute(turnRequest());

        expect(delegateStubPort.promptCalls[1]).toContain('Go on with your work with these results, then write your whole final answer again, opened the way your instructions say.');
        expect(await statusOf()).toBe('in_review');
        expect(stubAgentPort.promptCalls[1]).toContain('verdict="DONE" artifact_status="in_review"');
      });

      it('should leave the status as the start set it when the answer opens with no verdict', async () => {
        seed({ id: 'T-1', status: 'ready' });
        stubAgentPort.mockResponses = [develop, 'Done.'];
        delegateStubPort.mockResponses = ['I need access to /opt/sdk to go on.'];

        await useCase.execute(turnRequest());

        expect(await statusOf()).toBe('in_progress');
        expect(stubAgentPort.promptCalls[1]).toContain('artifact="T-1" artifact_status="in_progress" agent="stub"');
      });

      it('should apply no verdict to a delegation that failed', async () => {
        seed({ id: 'T-1', status: 'ready' });
        stubAgentPort.mockResponses = [develop, 'Done.'];
        delegateStubPort.promptErrorToThrow = new Error('DONE');

        await useCase.execute(turnRequest());

        expect(await statusOf()).toBe('in_progress');
        expect(stubAgentPort.promptCalls[1]).toContain('artifact="T-1" artifact_status="in_progress" agent="stub" model="default" effort="default" status="failed">\nDONE\n</agent_result>');
      });

      it('should apply no verdict to a delegation the user stopped', async () => {
        seed({ id: 'T-1', status: 'in_progress' });
        const stopWork = new StopArtifactWorkUseCase(artifacts, runtime);
        stopWork.onModuleInit();
        stubAgentPort.mockResponses = [develop, 'Noted.'];
        whileDelegateWorks(async () => {
          await artifacts.update('conv-1', 'T-1', { status: 'blocked' }, { kind: 'user', channel: 'web' });
          await rs.waitFor(() => expect(delegateStubPort.cancelCalls).toBe(1));
        }, 'DONE');

        await useCase.execute(turnRequest());
        stopWork.onModuleDestroy();

        expect(await statusOf()).toBe('blocked');
        expect(stubAgentPort.promptCalls[1]).not.toContain('verdict=');
      });

      describe('the result of an agent with a verdict', () => {
        const report = `DONE\n${'Changed the login form. '.repeat(10).trim()}`;

        beforeEach(() => {
          seed({ id: 'T-1', status: 'ready' });
          maxResultChars = 30;
          stubAgentPort.mockResponses = [develop, 'Done.'];
        });

        it('should reach the CEO cut at the limit, pointing to the section the agent writes, while the channel gets it whole', async () => {
          delegateStubPort.mockResponses = [report];
          const onDelegation = rs.fn();

          await useCase.execute(turnRequest({ onDelegation }));

          expect(stubAgentPort.promptCalls[1]).toContain(`effort="default">\nDONE\nChanged the login form. C\n\n[The rest of this result, ${report.length - 30} characters, was left out. The full report is on T-1, in its Implementation notes section.]\n</agent_result>`);
          expect(onDelegation).toHaveBeenCalledWith(expect.objectContaining({ phase: 'finished', response: report }));
        });

        it('should reach the CEO whole with a verdict that keeps the task where it was, which carries what the CEO must act on', async () => {
          const incomplete = `INCOMPLETE\n${'Choose between a cookie and a header for the token. '.repeat(3).trim()}`;
          delegateStubPort.mockResponses = [incomplete];

          await useCase.execute(turnRequest());

          expect(stubAgentPort.promptCalls[1]).toContain(`verdict="INCOMPLETE" artifact_status="in_progress" agent="stub" model="default" effort="default">\n${incomplete}\n</agent_result>`);
        });

        it('should point to the task alone for a role that writes no section', async () => {
          agentRegistry.getArtifactAccess.mockReturnValue({ scope: 'task', sections: [], fields: [] });
          delegateStubPort.mockResponses = [report];

          await useCase.execute(turnRequest());

          expect(stubAgentPort.promptCalls[1]).toContain('was left out. The full report is on T-1.]');
        });

        it.each([
          ['without a verdict', () => 'Need the SSH key below registered first. '.repeat(3).trim()],
          [
            'when the limit is 0', () => {
              maxResultChars = 0;
              return report;
            },
          ],
        ])('should reach the CEO whole %s', async (_name, response) => {
          const text = response();
          delegateStubPort.mockResponses = [text];

          await useCase.execute(turnRequest());

          expect(stubAgentPort.promptCalls[1]).toContain(`effort="default">\n${text}\n</agent_result>`);
        });
      });
    });

    describe('board', () => {
      it('should show the board to the CEO with the round that opens the turn, after its team', async () => {
        seed({ id: 'F-1', type: 'feature', title: 'Checkout', status: 'in_progress' }, { id: 'T-1', title: 'Login', parentId: 'F-1', status: 'in_progress' });
        stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Building" artifact="T-1">Implement T-1.</delegate>', 'T-1 is built.'];
        delegateStubPort.mockResponses = ['Built.'];

        await useCase.execute(turnRequest({ prompt: 'Build the login' }));

        expect(stubAgentPort.promptCalls[0]).toContain(`${idleTeam}[BOARD]\n- F-1 [feature] "Checkout" · status: in_progress · projects: my-app\n- T-1 [task] "Login" · status: in_progress · feature: F-1 · project: my-app\n\nBuild the login`);
        expect(stubAgentPort.promptCalls[1]).not.toContain('[BOARD]');
      });

      it('should show the board with a message that steers the CEO', async () => {
        seed({ id: 'T-1', title: 'Login', status: 'in_review' });
        let releaseFirst!: () => void;
        const firstRoundHeld = new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        stubAgentPort.supportsSteering = true;
        const original = stubAgentPort.prompt.bind(stubAgentPort);
        stubAgentPort.prompt = async function* (text: string) {
          await firstRoundHeld;
          yield* original(text);
        };
        stubAgentPort.mockResponses = ['Ok.'];

        const first = useCase.execute(turnRequest({ prompt: 'one' }));
        await rs.waitFor(() => expect(runtime.getCeoPort('conv-1')?.currentSessionId).toBeDefined());
        await rs.waitFor(async () => expect((await useCase.execute(turnRequest({ prompt: 'two' }))).status).toBe('steered'));
        releaseFirst();
        await first;

        expect(stubAgentPort.steeringPrompts[0]).toMatch(/^\[TEAM_PROFILES\][\s\S]*\n\n\[BOARD\]\n- T-1 \[task\] "Login" · status: in_review · project: my-app\n\n\n\[USER_MESSAGE\]/);
      });

      describe('check before the answer', () => {
        const developed = () => {
          seed({ id: 'T-1', title: 'Login', status: 'ready' });
          agentRegistry.getDelegationContract.mockImplementation((role: string) => (role === 'DEVELOPER'
            ? { ...contracts.DEVELOPER, statusFlow: { from: ['ready'], verdicts: { DONE: 'in_review' } } }
            : contracts[role] ?? {}));
          delegateStubPort.mockResponses = ['DONE'];
        };
        const develop = '<delegate role="DEVELOPER" summary="Building" artifact="T-1">Implement T-1.</delegate>';

        it('should send the CEO back once to the tasks it was leaving mid-flow, discarding its draft', async () => {
          developed();
          stubAgentPort.mockResponses = [develop, 'All done.', 'Nothing else to do.'];
          const onDraft = rs.fn();
          const log = rs.spyOn(Logger.prototype, 'log');

          const result = await useCase.execute(turnRequest({ onDraft }));
          const messages = log.mock.calls.map(([message]) => message);
          log.mockRestore();

          expect(result).toMatchObject({ status: 'completed', response: 'Nothing else to do.' });
          expect(stubAgentPort.promptCalls[2]).toBe(toCeo(buildBoardCheckPrompt([{ id: 'T-1', title: 'Login', status: 'in_review' }])));
          expect(stubAgentPort.promptCalls).toHaveLength(3);
          expect(onDraft).toHaveBeenLastCalledWith('');
          expect(messages).toContain('[Board Check] Conversation=conv-1, Tasks=T-1');
        });

        it('should ask for a complete answer, attachments included, and deliver the one that ends the turn', async () => {
          developed();
          fileSystem.readableFiles.add('/mock/workspace/my-app/report.pdf');
          const attachment = '<attachment path="/mock/workspace/my-app/report.pdf">Report</attachment>';
          stubAgentPort.mockResponses = [develop, `All done.\n${attachment}`, `T-1 waits for your review.\n${attachment}`];

          const result = await useCase.execute(turnRequest());

          expect(stubAgentPort.promptCalls[2]).toContain('Your answer was not delivered');
          expect(stubAgentPort.promptCalls[2]).toContain('write it complete, with every <attachment> you were sending.');
          expect(result).toMatchObject({ status: 'completed', response: 'T-1 waits for your review.', attachments: ['/mock/workspace/my-app/report.pdf'] });
        });

        it('should hand the CEO the results of the board writes of the answer along with the check', async () => {
          developed();
          stubAgentPort.mockResponses = [develop, 'All done. <artifact_comment id="T-1">Built.</artifact_comment>', 'Nothing else to do.'];

          await useCase.execute(turnRequest());

          expect(stubAgentPort.promptCalls[2]).toMatch(/^<request_results>[\s\S]*<\/request_results>\n\n\[BOARD_CHECK\]/);
        });

        it('should run what the CEO delegates in answer to the check, and check no more in the turn', async () => {
          developed();
          seed({ id: 'T-1', title: 'Login', status: 'ready', branch: 'feat/t-1' });
          stubAgentPort.mockResponses = [develop, 'All done.', '<delegate role="CODE_REVIEWER" summary="Reviewing" artifact="T-1">Review T-1.</delegate>', 'Reviewed.'];
          delegateStubPort.mockResponses = ['DONE', 'APPROVED'];

          const result = await useCase.execute(turnRequest());

          expect(result).toMatchObject({ status: 'completed', response: 'Reviewed.' });
          expect(stubAgentPort.promptCalls).toHaveLength(4);
          expect(stubAgentPort.promptCalls[3]).toContain('<agent_result role="CODE_REVIEWER"');
        });

        it.each([
          ['an answer that names each task in the middle of the flow', () => undefined],
          ['an answer that leaves out a task an agent holds', () => seed({ id: 'T-2', status: 'in_testing', assignee: { role: 'QA', roleName: 'QA', delegationId: 'd', since: '2026-01-01T00:00:00.000Z' } })],
          ['an answer that leaves out a task waiting outside the flow', () => seed({ id: 'T-2', status: 'blocked' })],
          ['an answer that leaves out a task parked mid-flow in an earlier turn', () => seed({ id: 'T-2', status: 'approved' })],
        ])('should deliver %s', async (_name, arrange) => {
          developed();
          arrange();
          stubAgentPort.mockResponses = [develop, 'T-1 waits for your review.'];

          const result = await useCase.execute(turnRequest());

          expect(result.status).toBe('completed');
          expect(stubAgentPort.promptCalls).toHaveLength(2);
        });

        it('should not check a turn in which no agent ran', async () => {
          seed({ id: 'T-1', status: 'in_review' });
          stubAgentPort.mockResponses = ['Hello!'];

          const result = await useCase.execute(turnRequest());

          expect(result).toMatchObject({ status: 'completed', response: 'Hello!' });
          expect(stubAgentPort.promptCalls).toHaveLength(1);
        });
      });
    });

    it('should not take a response with only the language tag besides its board writes as the answer', async () => {
      preferencesStore.preferences = {};
      seed({ id: 'T-1' });
      stubAgentPort.mockResponses = ['<user_language>Portuguese</user_language>\n<artifact_comment id="T-1">Noted.</artifact_comment>', 'Anotado.'];

      const result = await useCase.execute(turnRequest());

      expect(result).toMatchObject({ status: 'completed', response: 'Anotado.' });
      expect(stubAgentPort.promptCalls[1]).toContain('Your last response had only requests');
    });
  });
});
