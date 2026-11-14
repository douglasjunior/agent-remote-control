import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type AgentUpdate, PromptCancelledError } from '../../agent/ports/agent.port.js';
import { StubFileSystem } from '../../agent/testing/stub-file-system.port.js';
import type { ArtifactsService } from '../../artifacts/services/artifacts.service.js';
import { buildArtifact } from '../../artifacts/testing/artifact.fixture.js';
import { createArtifactsService } from '../../artifacts/testing/artifacts-service.fixture.js';
import type { InMemoryArtifactStoreFake } from '../../artifacts/testing/in-memory-artifact-store.fake.js';
import { ConversationLogContextService } from '../../logging/services/conversation-log-context.service.js';
import { StubSpeechToText } from '../../speech-to-text/testing/stub-speech-to-text.js';
import { IWorkspacePort } from '../../workspace/ports/workspace.port.js';
import type { AgentProfileSettings, AgentSettings } from '../models/agent-settings.model.js';
import type { DelegationEvent } from '../models/delegation-event.model.js';
import type { TurnRequest } from '../models/turn-request.model.js';
import type { QuestionAnswerInput, QuestionPrompt, RestoredWorkAnswers } from '../models/user-question.model.js';
import {
  type ArtifactAccess,
  type DelegationContract,
  IAgentRegistryPort,
} from '../ports/agent-registry.port.js';
import { buildPreviousTurnPrompt } from '../prompts/previous-turn.prompt.js';
import { buildSkillCatalogPrompt } from '../prompts/skill-catalog.prompt.js';
import {
  buildAgentLanguagePrompt,
  buildCeoLanguagePrompt,
  buildLanguageDetectionPrompt,
} from '../prompts/user-language.prompt.js';
import { AgentProtocolService } from '../services/agent-protocol.service.js';
import { AgentRequestParserService } from '../services/agent-request-parser.service.js';
import { ArtifactPromptFormatterService } from '../services/artifact-prompt-formatter.service.js';
import { ConversationRuntimeService } from '../services/conversation-runtime.service.js';
import { DelegationDetectorService } from '../services/delegation-detector.service.js';
import { OpenWorkService } from '../services/open-work.service.js';
import { QuestionParserService } from '../services/question-parser.service.js';
import { UserQuestionQueueService } from '../services/user-question-queue.service.js';
import { InMemoryOpenWorkStoreFake } from '../testing/in-memory-open-work-store.fake.js';
import { InMemorySessionStoreFake } from '../testing/in-memory-session-store.fake.js';
import { questionListener } from '../testing/question-listener.fixture.js';
import { buildSessionContext } from '../testing/session-context.fixture.js';
import { StubAgentPortFactory } from '../testing/stub-agent-port-factory.js';
import { buildStubProfile, buildStubSettings, StubAgentSettingsStore } from '../testing/stub-agent-settings-store.js';
import { StubAgentSkillsPort } from '../testing/stub-agent-skills.port.js';
import { StubAgentPort } from '../testing/stub-agent.port.js';
import { StubPreferencesStore } from '../testing/stub-preferences-store.js';

import { ExecuteAgentTurnUseCase } from './execute-agent-turn.use-case.js';
import { RestoreOpenWorkUseCase } from './restore-open-work.use-case.js';
import { RunAgentRequestsUseCase } from './run-agent-requests.use-case.js';
import { TranscribeAudioAttachmentsUseCase } from './transcribe-audio-attachments.use-case.js';


class StubAgentRegistryPort implements IAgentRegistryPort {
  getDefaultModel = vi.fn().mockReturnValue('mock-model-v1');
  getSystemPrompt = vi.fn().mockReturnValue('Mock system prompt.');
  getDisplayName = vi.fn((role: string) => role);
  listRoles = vi.fn((): string[] => ['CEO', 'DEVELOPER', 'CODE_REVIEWER', 'TECH_LEAD', 'PRODUCT_OWNER']);
  hasRole = vi.fn((role: string) => ['CEO', 'DEVELOPER', 'CODE_REVIEWER', 'TECH_LEAD'].includes(role));
  getDefaultSessionMode = vi.fn((role: string) => (role === 'CODE_REVIEWER' ? 'new' : 'resume'));
  getDelegationContract = vi.fn(
    (_role: string) => ({ project: 'optional', sessionMode: 'overridable' }) as DelegationContract,
  );

  getArtifactAccess = vi.fn((_role: string): ArtifactAccess => ({ scope: 'task', sections: [], fields: [] }));
  getTurnReminder = vi.fn().mockReturnValue('');
  isSystemPromptEveryTurn = vi.fn().mockReturnValue(false);
}

class StubWorkspacePort implements IWorkspacePort {
  getBaseDirectory = vi.fn().mockReturnValue('/mock/workspace');
  resolveRepositoryPath = vi.fn().mockReturnValue('/mock/workspace/my-app');
  ensureDirectory = vi.fn().mockResolvedValue(undefined);
  listProjectFolders = vi.fn().mockResolvedValue(['my-app', 'project-a', 'project-b']);
  writeFile = vi.fn().mockResolvedValue(undefined);
  ensureSymlink = vi.fn().mockResolvedValue(undefined);
}

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
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const toAgent = (prompt: string) => `${prompt}\n\n${buildAgentLanguagePrompt('English')}`;

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
  const logContext = new ConversationLogContextService();
  let questionQueue: UserQuestionQueueService;
  let openWork: OpenWorkService;
  let openWorkStore: InMemoryOpenWorkStoreFake;
  let speechToText: StubSpeechToText;
  let fileSystem: StubFileSystem;
  let artifacts: ArtifactsService;
  let artifactStore: InMemoryArtifactStoreFake;
  let agentSkills: StubAgentSkillsPort;

  beforeEach(() => {
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
    runtime = new ConversationRuntimeService(factory, 60_000);
    questionQueue = new UserQuestionQueueService({ getTimeoutMs: () => questionTimeoutMs });
    openWork = new OpenWorkService(openWorkStore);
    speechToText = new StubSpeechToText();
    fileSystem = new StubFileSystem();
    ({ service: artifacts, store: artifactStore } = createArtifactsService({ conversationId: 'conv-1' }));
    const formatter = new ArtifactPromptFormatterService();
    agentSkills = new StubAgentSkillsPort();
    useCase = new ExecuteAgentTurnUseCase(
      factory,
      sessionStore,
      agentRegistry,
      workspacePort,
      settingsStore,
      preferencesStore,
      delegationDetector,
      runtime,
      new AgentProtocolService(),
      new QuestionParserService(),
      questionQueue,
      new TranscribeAudioAttachmentsUseCase(speechToText, fileSystem),
      openWork,
      fileSystem,
      logContext,
      artifacts,
      new AgentRequestParserService(),
      new RunAgentRequestsUseCase(artifacts, agentRegistry, formatter, agentSkills),
      formatter,
      agentSkills,
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
      toCeo(`CEO prompt\n\n${idleTeam}Add login`),
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

      expect(stubAgentPort.promptCalls).toEqual([`Mock system prompt.\n\n${idleTeam}Oi\n\n${buildLanguageDetectionPrompt()}`]);
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

      expect(stubAgentPort.promptCalls).toEqual([`Mock system prompt.\n\n${idleTeam}Hi\n\n${buildCeoLanguagePrompt('Spanish')}`]);
      expect(result.response).toBe('Hola.');
      expect(preferencesStore.updates).toEqual([]);
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

  it('should append turn reminder to CEO and delegate prompts', async () => {
    agentRegistry.getTurnReminder.mockImplementation(
      (role: string) => `${role} turn reminder`,
    );
    agentRegistry.getSystemPrompt.mockImplementation((role: string) => `${role} prompt`);
    stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Implement login.</delegate>', 'Done.'];
    delegateStubPort.mockResponses = ['Login implemented.'];

    const result = await useCase.execute(turnRequest({ prompt: 'Add login' }));

    expect(result.response).toBe('Done.');
    expect(stubAgentPort.promptCalls).toEqual([
      toCeo(`CEO prompt\n\n${idleTeam}Add login\n\nCEO turn reminder`),
      toCeo('<agent_result role="DEVELOPER" project="my-app" agent="stub" model="default" effort="default">\nLogin implemented.\n</agent_result>\n\nCEO turn reminder'),
    ]);
    expect(delegateStubPort.promptCalls).toEqual([toAgent('DEVELOPER prompt\n\nImplement login.\n\nDEVELOPER turn reminder')]);
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

  it('should send the skill catalog of the role with its system prompt', async () => {
    agentSkills.skills = { CEO: [{ name: 'board', description: 'Routing the board.', content: 'Route it.' }] };
    stubAgentPort.mockResponses = ['First.', 'Second.'];

    await useCase.execute(turnRequest());
    await useCase.execute(turnRequest({ prompt: 'Again' }));

    expect(stubAgentPort.promptCalls[0]).toContain(`Mock system prompt.\n\n${buildSkillCatalogPrompt([{ name: 'board', description: 'Routing the board.' }])}\n\n`);
    expect(stubAgentPort.promptCalls[1]).not.toContain('[SKILLS]');
  });

  it('should answer a skill request with the skill content in the next prompt', async () => {
    agentSkills.skills = { CEO: [{ name: 'board', description: 'Routing the board.', content: 'Route it.' }] };
    stubAgentPort.mockResponses = ['<final_response><skill_read name="board"/></final_response>', 'Done.'];

    const result = await useCase.execute(turnRequest());

    expect(result.response).toBe('Done.');
    expect(stubAgentPort.promptCalls[1]).toContain('<request_result request="skill_read" name="board" status="ok">\n# Skill: board\n\nRoute it.\n</request_result>');
  });

  it('should send the system prompt only when the CEO ACP session is created', async () => {
    stubAgentPort.mockResponses = ['First.', 'Second.'];

    await useCase.execute(turnRequest());
    await useCase.execute(turnRequest({ prompt: 'Again' }));

    expect(stubAgentPort.createSessionCalls).toHaveLength(1);
    expect(stubAgentPort.promptCalls).toEqual([toCeo(`Mock system prompt.\n\n${idleTeam}Hi`), toCeo(`${idleTeam}Again`)]);
  });

  it('should send the system prompt again when the first turn failed before the session existed', async () => {
    stubAgentPort.errorToThrowOnCreateSession = new Error('Internal error');
    const failed = await useCase.execute(turnRequest());
    stubAgentPort.errorToThrowOnCreateSession = null;
    stubAgentPort.mockResponses = ['Hello.'];

    await useCase.execute(turnRequest({ prompt: 'Hello?' }));

    expect(failed.status).toBe('failed');
    expect(stubAgentPort.promptCalls).toEqual([toCeo(`Mock system prompt.\n\n${buildPreviousTurnPrompt([`Your previous turn failed: ${failed.errorMessage}`])}\n${idleTeam}Hello?`)]);
  });

  it('should isolate agent ports between different threads', async () => {
    stubAgentPort.mockResponses = ['A.'];
    delegateStubPort.mockResponses = ['B.'];

    await useCase.execute(turnRequest({ conversationId: 'conv-th-a', prompt: 'a' }));
    await useCase.execute(turnRequest({ conversationId: 'conv-th-b', prompt: 'b' }));

    expect(stubAgentPort.promptCalls).toEqual([toCeo(`Mock system prompt.\n\n${idleTeam}a`)]);
    expect(delegateStubPort.promptCalls).toEqual([toCeo(`Mock system prompt.\n\n${idleTeam}b`)]);
  });

  it('should queue a second message of the same thread until the current turn finishes', async () => {
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
    const onQueued = vi.fn();

    const first = useCase.execute(turnRequest({ conversationId: 'conv-th-1', prompt: 'one' }));
    await firstStarted;
    const second = useCase.execute(turnRequest({ conversationId: 'conv-th-1', prompt: 'two', onQueued }));
    await vi.waitFor(() => expect(onQueued).toHaveBeenCalledTimes(1));

    expect(stubAgentPort.promptCalls).toHaveLength(1);

    releaseFirst();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.response).toBe(`reply to ${toCeo(`Mock system prompt.\n\n${idleTeam}one`)}`);
    expect(secondResult.response).toBe(`reply to ${toCeo(`${idleTeam}two`)}`);
  });

  it('should create a single session when two messages start a new conversation at once', async () => {
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

    const first = useCase.execute(turnRequest({ prompt: 'one' }));
    const second = useCase.execute(turnRequest({ prompt: 'two' }));
    await firstStarted;
    releaseFirst();
    await Promise.all([first, second]);

    expect(stubAgentPort.promptCalls).toEqual([toCeo(`Mock system prompt.\n\n${idleTeam}one`), toCeo(`${idleTeam}two`)]);
  });

  it('should return failed when the session cannot be saved', async () => {
    sessionStore.saveSession = async () => {
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

    await useCase.execute(turnRequest({ onDelegation: event => events.push(event) }));

    const finished = events.find(event => event.phase === 'finished');
    expect(finished).toMatchObject({ phase: 'finished', response: 'Done.' });
    expect(finished && 'usage' in finished ? finished.usage : undefined).toBeUndefined();
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
    const onActivity = vi.fn();

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
      const onDraft = vi.fn();

      await useCase.execute(turnRequest({ onDraft }));

      expect(onDraft.mock.calls.map(([text]) => text)).toEqual(['', 'All', 'All done.', 'All done.']);
    });

    it('should hand the channel the answer without the envelope', async () => {
      writeAnswer(stubAgentPort, ['<final_response>Done.'], '<final_response>Done.</final_response>');
      const onDraft = vi.fn();

      const result = await useCase.execute(turnRequest({ onDraft }));

      expect(onDraft).toHaveBeenCalledWith('Done.');
      expect(result.response).toBe('Done.');
    });

    it('should leave out the answers other agents write', async () => {
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Go.</delegate>', 'Ok.'];
      writeAnswer(delegateStubPort, ['The delegate answer'], 'Done.');
      const onDraft = vi.fn();

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

  describe('agent session recovery', () => {
    const persistedSession = () =>
      sessionStore.saveSession(buildSessionContext({ agentSessions: [{ role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null }] }));
    const storedAgentSessions = async () => (await sessionStore.findSession('conv-1'))?.agentSessions;

    it('should persist the agent session id created for a new conversation', async () => {
      stubAgentPort.mockResponses = ['Hi.'];

      await useCase.execute(turnRequest());

      expect(await storedAgentSessions()).toEqual([{ role: 'CEO', agentId: 'stub', sessionId: 'session-1', projectName: null }]);
    });

    it('should resume the persisted agent session without resending the system prompt', async () => {
      await persistedSession();
      stubAgentPort.mockResponses = ['Welcome back.'];

      await useCase.execute(turnRequest({ prompt: 'Continue' }));

      expect(stubAgentPort.loadSessionCalls).toEqual([{ cwd: '/mock/workspace', sessionId: 'conv-old' }]);
      expect(stubAgentPort.createSessionCalls).toHaveLength(0);
      expect(stubAgentPort.promptCalls).toEqual([toCeo(`${idleTeam}Continue`)]);
      expect(await storedAgentSessions()).toEqual([{ role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null }]);
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
        toCeo(`CEO prompt\n\n${idleTeam}Continue`),
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
      expect(stubAgentPort.promptCalls).toEqual([toCeo(`Mock system prompt.\n\n${idleTeam}Continue`)]);
      expect(await storedAgentSessions()).toEqual([{ role: 'CEO', agentId: 'stub', sessionId: 'session-1', projectName: null }]);
    });

    it('should persist the delegate session id alongside the CEO session id', async () => {
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Go.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['Done.'];

      await useCase.execute(turnRequest());

      expect(delegateStubPort.loadSessionCalls).toHaveLength(0);
      expect(await storedAgentSessions()).toEqual([
        { role: 'CEO', agentId: 'stub', sessionId: 'session-1', projectName: null },
        { role: 'DEVELOPER', agentId: 'stub', sessionId: 'session-1', projectName: 'my-app' },
      ]);
    });

    it('should resume the stored delegate session without resending the system prompt', async () => {
      await sessionStore.saveSession(buildSessionContext({
        agentSessions: [{ role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null }, { role: 'DEVELOPER', agentId: 'stub', sessionId: 'dev-old', projectName: 'my-app' }],
      }));
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Fix it.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['Fixed.'];

      await useCase.execute(turnRequest());

      expect(delegateStubPort.loadSessionCalls).toEqual([{ cwd: '/mock/workspace/my-app', sessionId: 'dev-old' }]);
      expect(delegateStubPort.createSessionCalls).toHaveLength(0);
      expect(delegateStubPort.promptCalls).toEqual([toAgent('Fix it.')]);
      expect(await storedAgentSessions()).toEqual([
        { role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null },
        { role: 'DEVELOPER', agentId: 'stub', sessionId: 'dev-old', projectName: 'my-app' },
      ]);
    });

    it('should start a fresh delegate session when sessionMode is new in delegation marker', async () => {
      await sessionStore.saveSession(buildSessionContext({
        agentSessions: [{ role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null }, { role: 'DEVELOPER', agentId: 'stub', sessionId: 'dev-old', projectName: 'my-app' }],
      }));
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app" session="new">Fix it from scratch.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['Fixed.'];

      await useCase.execute(turnRequest());

      expect(delegateStubPort.loadSessionCalls).toHaveLength(0);
      expect(delegateStubPort.createSessionCalls).toEqual(['/mock/workspace/my-app']);
      expect(delegateStubPort.promptCalls).toEqual([toAgent('Mock system prompt.\n\nFix it from scratch.')]);
      expect(await storedAgentSessions()).toEqual([
        { role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null },
        { role: 'DEVELOPER', agentId: 'stub', sessionId: 'session-1', projectName: 'my-app' },
      ]);
    });

    it('should start a fresh delegate session when persona defaults to new session mode', async () => {
      await sessionStore.saveSession(buildSessionContext({
        agentSessions: [{ role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null }, { role: 'CODE_REVIEWER', agentId: 'stub', sessionId: 'rev-old', projectName: 'my-app' }],
      }));
      stubAgentPort.mockResponses = ['<delegate role="CODE_REVIEWER" summary="Working on it" project="my-app">Review it.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['Reviewed.'];

      await useCase.execute(turnRequest());

      expect(delegateStubPort.loadSessionCalls).toHaveLength(0);
      expect(delegateStubPort.createSessionCalls).toEqual(['/mock/workspace/my-app']);
      expect(delegateStubPort.promptCalls).toEqual([toAgent('Mock system prompt.\n\nReview it.')]);
      expect(await storedAgentSessions()).toEqual([
        { role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null },
        { role: 'CODE_REVIEWER', agentId: 'stub', sessionId: 'session-1', projectName: 'my-app' },
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
      await sessionStore.saveSession(buildSessionContext({
        agentSessions: [
          { role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null },
          { role: 'DEVELOPER', agentId: 'stub', sessionId: 'dev-old', projectName: 'my-app' },
          { role: 'REVIEWER', agentId: 'stub', sessionId: 'rev-old', projectName: null },
        ],
      }));
      delegateStubPort.loadSessionResult = false;
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Go.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['Done.'];

      await useCase.execute(turnRequest());

      expect(delegateStubPort.promptCalls).toEqual([toAgent('Mock system prompt.\n\nGo.')]);
      expect(await storedAgentSessions()).toEqual([
        { role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null },
        { role: 'REVIEWER', agentId: 'stub', sessionId: 'rev-old', projectName: null },
        { role: 'DEVELOPER', agentId: 'stub', sessionId: 'session-1', projectName: 'my-app' },
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
        { role: 'CEO', agentId: 'other', sessionId: 'session-1', projectName: null },
        { role: 'DEVELOPER', agentId: 'other', sessionId: 'session-1', projectName: 'my-app' },
      ]);
    });

    it('should not resume a session stored for another agent and keep its entry', async () => {
      await sessionStore.saveSession(buildSessionContext({
        agentSessions: [{ role: 'CEO', agentId: 'agy', sessionId: 'agy-old', projectName: null }],
      }));
      stubAgentPort.mockResponses = ['Hi.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.loadSessionCalls).toHaveLength(0);
      expect(stubAgentPort.createSessionCalls).toEqual(['/mock/workspace']);
      expect(await storedAgentSessions()).toEqual([
        { role: 'CEO', agentId: 'agy', sessionId: 'agy-old', projectName: null },
        { role: 'CEO', agentId: 'stub', sessionId: 'session-1', projectName: null },
      ]);
    });

    it('should resume the session of the running agent among several stored agents', async () => {
      await sessionStore.saveSession(buildSessionContext({
        agentSessions: [
          { role: 'CEO', agentId: 'agy', sessionId: 'agy-old', projectName: null },
          { role: 'CEO', agentId: 'stub', sessionId: 'stub-old', projectName: null },
        ],
      }));
      stubAgentPort.mockResponses = ['Hi.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.loadSessionCalls).toEqual([{ cwd: '/mock/workspace', sessionId: 'stub-old' }]);
      expect(await storedAgentSessions()).toEqual([
        { role: 'CEO', agentId: 'agy', sessionId: 'agy-old', projectName: null },
        { role: 'CEO', agentId: 'stub', sessionId: 'stub-old', projectName: null },
      ]);
    });

    it('should replace only the entry of the same role and agent when a session is rebound', async () => {
      await sessionStore.saveSession(buildSessionContext({
        agentSessions: [
          { role: 'CEO', agentId: 'agy', sessionId: 'agy-old', projectName: null },
          { role: 'CEO', agentId: 'stub', sessionId: 'stub-old', projectName: null },
        ],
      }));
      stubAgentPort.loadSessionResult = false;
      stubAgentPort.mockResponses = ['Hi.'];

      await useCase.execute(turnRequest());

      expect(await storedAgentSessions()).toEqual([
        { role: 'CEO', agentId: 'agy', sessionId: 'agy-old', projectName: null },
        { role: 'CEO', agentId: 'stub', sessionId: 'session-1', projectName: null },
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
        { role: 'CEO', agentId: 'stub', sessionId: 'session-1', projectName: null },
        { role: 'CEO', agentId: 'other', sessionId: 'session-1', projectName: null },
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
        { role: 'CEO', agentId: 'stub', sessionId: 'session-1', projectName: null },
        { role: 'DEVELOPER', agentId: 'dev-a', sessionId: 'session-1', projectName: 'my-app' },
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
        { role: 'CEO', agentId: 'stub', sessionId: 'session-1', projectName: null },
        { role: 'DEVELOPER', agentId: 'dev-a', sessionId: 'session-1', projectName: 'my-app' },
        { role: 'DEVELOPER', agentId: 'dev-b', sessionId: 'session-1', projectName: 'my-app' },
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
        { role: 'CEO', agentId: 'stub', sessionId: 'session-1', projectName: null },
        { role: 'DEVELOPER', agentId: 'dev-a', sessionId: 'session-1', projectName: 'my-app' },
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
      const cancel = vi.fn();
      const steer = vi.fn().mockResolvedValue(true);
      runtime.registerDelegation('conv-1', {
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
        steer,
      });
      settingsStore.settings = buildStubSettings({ CEO: ceoProfile, DEVELOPER: developerProfile('dev-b') });
      responses.set('stub', ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Change course.</delegate>', 'Ok.']);

      const result = await useCase.execute(turnRequest());

      expect(result.status).toBe('completed');
      expect(steer).toHaveBeenCalledWith('Change course.');
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
      const onInterimMessage = vi.fn();
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
      const onTranscription = vi.fn();

      await useCase.execute(turnRequest({ attachments: [voice], onTranscription }));

      expect(onTranscription).toHaveBeenCalledExactlyOnceWith({
        transcripts: [{ name: 'voice.ogg', text: 'hello there' }],
        warnings: [],
      });
    });

    it('should keep the audio as an attachment, and warn, when nothing could be transcribed', async () => {
      stubAgentPort.mockResponses = ['Done.'];
      speechToText.failures[voice.path] = 'whisper crashed';
      const onTranscription = vi.fn();

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
      const onTranscription = vi.fn();

      await useCase.execute(turnRequest({ attachments: [photo], onTranscription }));

      expect(onTranscription).not.toHaveBeenCalled();
    });

    it('should hand the asking agent the transcript of an answer spoken as audio', async () => {
      stubAgentPort.mockResponses = ['<question>Which colour?</question>', 'Thanks.'];
      speechToText.transcripts[voice.path] = 'Blue please';
      const onTranscription = vi.fn();

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
      const onTranscription = vi.fn();

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
      const onQueued = vi.fn();

      const first = useCase.execute(turnRequest({ prompt: 'one' }));
      await gate.firstStarted;
      const second = await useCase.execute(turnRequest({ prompt: 'two', onQueued }));

      expect(second).toEqual({
        response: '',
        status: 'steered',
        agentInfo: expect.objectContaining({ roleName: 'CEO', agentName: 'stub' }),
      });
      expect(stubAgentPort.steeringPrompts).toHaveLength(1);
      expect(stubAgentPort.steeringPrompts[0]).toMatch(new RegExp(`^${escapeRegExp(idleTeam)}\\n\\[USER_MESSAGE\\]\\n[\\s\\S]*\\n\\ntwo\\n\\n\\[USER_LANGUAGE\\]`));
      expect(stubAgentPort.promptCalls).toHaveLength(1);
      expect(onQueued).not.toHaveBeenCalled();

      gate.release();
      const firstResult = await first;

      expect(firstResult).toMatchObject({
        status: 'completed',
        response: `reply to ${toCeo(`Mock system prompt.\n\n${idleTeam}one`)}`,
      });
      expect(stubAgentPort.promptCalls).toHaveLength(1);
    });

    it('should steer with the attachments inventory and the turn reminder appended', async () => {
      stubAgentPort.supportsSteering = true;
      agentRegistry.getTurnReminder.mockReturnValue('CEO turn reminder');
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
      expect(steeringText.startsWith(`${idleTeam}\n[USER_MESSAGE]`)).toBe(true);
      expect(steeringText).toContain(
        '[ATTACHMENTS]\n- Name: notes.txt\n  Size: 256 bytes\n  Type: text/plain\n  Path: /tmp/attachments/notes.txt\n'
        + 'Inspect these files using your available tools as needed.\n\ntwo',
      );
      expect(steeringText.endsWith(toCeo('two\n\nCEO turn reminder'))).toBe(true);

      gate.release();
      await first;
    });

    it('should steer the running turn when the conversation has no stored session', async () => {
      stubAgentPort.supportsSteering = true;
      let release: () => void = () => undefined;
      const conversationKey = 'conv-1';
      const running = runtime.run(conversationKey, 'stub', () => new Promise<void>((resolve) => {
        release = resolve;
      }));
      await vi.waitFor(() => expect(runtime.getCeoPort(conversationKey)).toBe(stubAgentPort));

      const result = await useCase.execute(turnRequest({ prompt: 'two' }));

      expect(result).toMatchObject({ status: 'steered' });
      expect(stubAgentPort.steeringPrompts).toHaveLength(1);
      expect(stubAgentPort.steeringPrompts[0]).toContain('two');

      release();
      await running;
    });

    it('should list the running agents in the message injected into the running CEO round', async () => {
      stubAgentPort.supportsSteering = true;
      runtime.registerDelegation('conv-1', {
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
        turn: { cancel: vi.fn() } as any,
        steer: vi.fn(),
      });
      const gate = await holdFirstPrompt();

      const first = useCase.execute(turnRequest({ prompt: 'one' }));
      await gate.firstStarted;
      const second = await useCase.execute(turnRequest({ prompt: 'two' }));

      expect(second.status).toBe('steered');
      expect(stubAgentPort.steeringPrompts[0]).toContain('- DEVELOPER: Agent: stub, Model: default, Effort: default, Status: working, Running: 0s, Project: my-app, Waiting for user: no, Summary: "Summary"');
      expect(stubAgentPort.steeringPrompts[0]).toContain('two');

      gate.release();
      await first;
    });

    it('should queue the message and run it normally when the agent does not accept the steering', async () => {
      stubAgentPort.supportsSteering = true;
      stubAgentPort.steeringResult = false;
      const gate = await holdFirstPrompt();
      const onQueued = vi.fn();

      const first = useCase.execute(turnRequest({ prompt: 'one' }));
      await gate.firstStarted;
      const second = useCase.execute(turnRequest({ prompt: 'two', onQueued }));
      await vi.waitFor(() => expect(onQueued).toHaveBeenCalledTimes(1));

      expect(stubAgentPort.steeringPrompts).toHaveLength(1);
      expect(stubAgentPort.steeringPrompts[0]).toContain('two');
      expect(stubAgentPort.promptCalls).toHaveLength(1);

      gate.release();
      const [firstResult, secondResult] = await Promise.all([first, second]);

      expect(firstResult.status).toBe('completed');
      expect(secondResult).toMatchObject({ status: 'completed', response: `reply to ${toCeo(`${idleTeam}two`)}` });
    });

    it('should queue the message when the agent does not support steering', async () => {
      const gate = await holdFirstPrompt();
      const onQueued = vi.fn();

      const first = useCase.execute(turnRequest({ prompt: 'one' }));
      await gate.firstStarted;
      const second = useCase.execute(turnRequest({ prompt: 'two', onQueued }));
      await vi.waitFor(() => expect(onQueued).toHaveBeenCalledTimes(1));

      expect(stubAgentPort.steeringPrompts).toEqual([]);

      gate.release();
      const [, secondResult] = await Promise.all([first, second]);

      expect(secondResult).toMatchObject({ status: 'completed', response: `reply to ${toCeo(`${idleTeam}two`)}` });
    });

    it('should queue the message when the configured agent differs from the running CEO agent', async () => {
      stubAgentPort.supportsSteering = true;
      const gate = await holdFirstPrompt();
      const onQueued = vi.fn();
      delegateStubPort.agentName = 'other';
      delegateStubPort.mockResponses = ['other agent reply'];

      const first = useCase.execute(turnRequest({ prompt: 'one' }));
      await gate.firstStarted;
      settingsStore.settings = buildStubSettings({ CEO: buildStubProfile('other', { agentName: 'Other' }) });
      const second = useCase.execute(turnRequest({ prompt: 'two', onQueued }));
      await vi.waitFor(() => expect(onQueued).toHaveBeenCalledTimes(1));

      expect(stubAgentPort.steeringPrompts).toEqual([]);

      gate.release();
      const [, secondResult] = await Promise.all([first, second]);

      expect(secondResult).toMatchObject({ status: 'completed', response: 'other agent reply' });
      expect(stubAgentPort.promptCalls).toHaveLength(1);
    });
  });

  describe('active delegations and transparent steering', () => {
    it('should prepend [TEAM_PROFILES] block to CEO prompt when active delegations exist', async () => {
      const activeDelegatePort = new StubAgentPort();
      const conversationKey = 'conv-1';
      runtime.registerDelegation(conversationKey, {
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
        turn: { cancel: vi.fn() } as any,
        steer: vi.fn(),
      });
      runtime.registerDelegation(conversationKey, {
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
        turn: { cancel: vi.fn() } as any,
        steer: vi.fn(),
      });

      stubAgentPort.mockResponses = ['Understood, letting developer continue.'];
      const result = await useCase.execute(turnRequest({ prompt: 'How is it going?' }));

      expect(result.status).toBe('completed');
      expect(stubAgentPort.promptCalls[0]).toContain('[TEAM_PROFILES]');
      expect(stubAgentPort.promptCalls[0]).toContain('- DEVELOPER: Agent: stub, Model: default, Effort: default, Status: working, Running: 0s, Project: project-a, Waiting for user: no, Summary: "Summary"');
      expect(stubAgentPort.promptCalls[0]).toContain('- CODE_REVIEWER: Agent: stub, Model: default, Effort: default, Status: working, Running: 0s, Project: none, Waiting for user: no, Summary: "Summary"');
      expect(stubAgentPort.promptCalls[0]).toContain('How is it going?');
    });

    it('should steer active delegation when CEO delegates to an already active role with native steering', async () => {
      delegateStubPort.supportsSteering = true;
      const steerSpy = vi.fn().mockResolvedValue(true);
      const conversationKey = 'conv-1';
      runtime.registerDelegation(conversationKey, {
        role: 'DEVELOPER',
        roleName: 'Developer',
        agentInfo: { roleName: 'Developer', agentName: 'stub' },
        projectName: 'project-a',
        artifactId: null,
        summary: 'Summary',
        taskSpec: 'Original task',
        cwd: '/mock/workspace/project-a',
        startedAt: Date.now(),
        agentPort: delegateStubPort,
        turn: { cancel: vi.fn() } as any,
        steer: steerSpy,
      });

      stubAgentPort.mockResponses = [
        '<delegate role="DEVELOPER" summary="Working on it" project="project-a">Change course.</delegate>',
        'Acknowledged.',
      ];

      const result = await useCase.execute(turnRequest());

      expect(result.status).toBe('completed');
      expect(steerSpy).toHaveBeenCalledWith('Change course.');
      expect(stubAgentPort.promptCalls[1]).toContain('<agent_result role="DEVELOPER" project="project-a" agent="stub" model="default" effort="default">\nSteering message sent to active agent.\n</agent_result>');
    });

    it('should invoke sendSteeringPrompt when active delegation steer() is called and supportsSteering is true', async () => {
      delegateStubPort.supportsSteering = true;
      let steerAccepted: boolean | undefined;
      stubAgentPort.mockResponses = [
        '<delegate role="DEVELOPER" summary="Working on it" project="project-a">Start building.</delegate>',
        'All done.',
      ];

      const conversationKey = 'conv-1';
      let capturedDelegation: any;
      const originalPrompt = delegateStubPort.prompt.bind(delegateStubPort);
      delegateStubPort.prompt = async function* (text: string) {
        capturedDelegation = runtime.findActiveDelegation(conversationKey, 'DEVELOPER');
        if (capturedDelegation) {
          steerAccepted = await capturedDelegation.steer('Steered instruction');
        }
        yield* originalPrompt(text);
      };
      delegateStubPort.mockResponses = ['Build complete.'];

      const result = await useCase.execute(turnRequest());
      expect(result.status).toBe('completed');
      expect(steerAccepted).toBe(true);
      expect(delegateStubPort.steeringPrompts).toEqual([toAgent('Steered instruction')]);
      expect(capturedDelegation.taskSpec).toBe('Steered instruction');
    });

    it('should report the steering as refused when the delegate agent does not accept it', async () => {
      delegateStubPort.supportsSteering = true;
      delegateStubPort.steeringResult = false;
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Go.</delegate>', 'Ok.'];
      let steerAccepted: boolean | undefined;
      delegateStubPort.prompt = async function* () {
        const active = runtime.findActiveDelegation('conv-1', 'DEVELOPER');
        steerAccepted = await active?.steer('Updated task');
        yield textChunk('Done.');
      };

      await useCase.execute(turnRequest());

      expect(steerAccepted).toBe(false);
      expect(delegateStubPort.steeringPrompts).toEqual([toAgent('Updated task')]);
    });

    it('should restart the delegate when its agent supports steering but does not accept the message', async () => {
      const activeDelegatePort = new StubAgentPort();
      activeDelegatePort.supportsSteering = true;
      const cancelSpy = vi.fn().mockResolvedValue(undefined);
      const steerSpy = vi.fn().mockResolvedValue(false);
      runtime.registerDelegation('conv-1', {
        role: 'DEVELOPER',
        roleName: 'Developer',
        agentInfo: { roleName: 'Developer', agentName: 'stub' },
        projectName: 'my-app',
        artifactId: null,
        summary: 'Summary',
        taskSpec: 'Original task',
        cwd: '/mock/workspace/my-app',
        startedAt: Date.now(),
        agentPort: activeDelegatePort,
        turn: { cancel: cancelSpy } as any,
        steer: steerSpy,
      });
      delegateStubPort.mockResponses = ['Restarted task done.'];
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Change course.</delegate>', 'Finished.'];

      const result = await useCase.execute(turnRequest());

      expect(result).toMatchObject({ status: 'completed', response: 'Finished.' });
      expect(steerSpy).toHaveBeenCalledWith('Change course.');
      expect(cancelSpy).toHaveBeenCalledTimes(1);
      expect(activeDelegatePort.closeSessionCalls).toBe(1);
      expect(activeDelegatePort.connected).toBe(false);
      expect(delegateStubPort.promptCalls).toEqual([expect.stringContaining('Change course.')]);
      expect(stubAgentPort.promptCalls[1]).toBe(toCeo(`${idleTeam}<agent_result role="DEVELOPER" project="my-app" agent="stub" model="default" effort="default">\nRestarted task done.\n</agent_result>`));
    });

    it('should cancel, close, unregister and recreate the delegate in the same project when supportsSteering is false', async () => {
      const firstDelegatePort = new StubAgentPort();
      firstDelegatePort.supportsSteering = false;
      const firstCancelSpy = vi.fn().mockResolvedValue(undefined);
      const firstCloseSessionSpy = vi.spyOn(firstDelegatePort, 'closeSession').mockRejectedValueOnce(new Error('close failed'));
      const firstDisconnectSpy = vi.spyOn(firstDelegatePort, 'disconnect');

      workspacePort.resolveRepositoryPath.mockImplementation((proj: string) => `/mock/workspace/${proj}`);

      const conversationKey = 'conv-1';
      runtime.registerDelegation(conversationKey, {
        role: 'DEVELOPER',
        roleName: 'Developer',
        agentInfo: { roleName: 'Developer', agentName: 'stub' },
        projectName: 'project-a',
        artifactId: null,
        summary: 'Summary',
        taskSpec: 'Old task in project-a',
        cwd: '/mock/workspace/project-a',
        startedAt: Date.now() - 5000,
        agentPort: firstDelegatePort,
        turn: { cancel: firstCancelSpy } as any,
        steer: vi.fn(),
      });

      delegateStubPort.supportsSteering = false;
      delegateStubPort.mockResponses = ['Completed the new task in project-a.'];

      stubAgentPort.mockResponses = [
        '<delegate role="DEVELOPER" summary="Working on it" project="project-a">New task in project-a.</delegate>',
        'All finished.',
      ];

      const result = await useCase.execute(turnRequest());

      expect(result.status).toBe('completed');
      expect(result.response).toBe('All finished.');
      expect(firstCancelSpy).toHaveBeenCalled();
      expect(firstCloseSessionSpy).toHaveBeenCalled();
      expect(firstDisconnectSpy).toHaveBeenCalled();
      expect(delegateStubPort.createSessionCalls).toEqual(['/mock/workspace/project-a']);
      expect(delegateStubPort.promptCalls[0]).toContain('New task in project-a.');
      expect(stubAgentPort.promptCalls[1]).toContain('<agent_result role="DEVELOPER" project="project-a" agent="stub" model="default" effort="default">\nCompleted the new task in project-a.\n</agent_result>');
      expect(stubAgentPort.promptCalls[1]).not.toContain('Steering message sent to active agent.');
    });

    it('should not remove a newer active delegation when a previous delegation completes its finally block', async () => {
      const conversationKey = 'conv-1';
      const newerDelegatePort = new StubAgentPort();
      const newerDelegation = {
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
        turn: { cancel: vi.fn() } as any,
        steer: vi.fn(),
      };

      const unregisterSpy = vi.spyOn(runtime, 'unregisterDelegation');

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

    const activeDelegation = (role: string, projectName: string) => ({
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
      turn: { cancel: vi.fn() } as any,
      steer: vi.fn().mockResolvedValue(false),
    });

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
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Implement.</delegate>', 'Ok.'];

      const result = await useCase.execute(turnRequest());

      expect(result.status).toBe('completed');
      expect(running.turn.cancel).toHaveBeenCalledTimes(1);
      expect(running.steer).not.toHaveBeenCalled();
      expect(runtime.getActiveDelegations('conv-1').map(delegation => delegation.role)).toEqual(['TECH_LEAD']);
    });

    it('should keep the sessions of one role apart per project', async () => {
      await sessionStore.saveSession(buildSessionContext({
        agentSessions: [
          { role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null },
          { role: 'DEVELOPER', agentId: 'stub', sessionId: 'dev-a', projectName: 'project-a' },
        ],
      }));
      delegatePorts = [delegatePort('Done in b.')];
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="project-b">Work on b.</delegate>', 'Ok.'];

      await useCase.execute(turnRequest());

      expect((await sessionStore.findSession('conv-1'))?.agentSessions).toEqual([
        { role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null },
        { role: 'DEVELOPER', agentId: 'stub', sessionId: 'dev-a', projectName: 'project-a' },
        { role: 'DEVELOPER', agentId: 'stub', sessionId: 'session-1', projectName: 'project-b' },
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
      const save = sessionStore.saveSession.bind(sessionStore);
      sessionStore.saveSession = async (session) => {
        if (session.agentSessions.at(-1)?.projectName === 'project-a') {
          throw new Error('EACCES: permission denied');
        }
        await save(session);
      };
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
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        yield* ceoPrompt(text);
      };

      const result = await useCase.execute(turnRequest());

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

      expect(stubAgentPort.promptCalls[0]).toContain('- DEVELOPER: Agent: stub, Model: default, Effort: default, Status: working, Running: 2m, Project: project-a, Waiting for user: yes, Summary: "Summary"');
      expect(stubAgentPort.promptCalls[0]).toContain('- TECH_LEAD: Agent: stub, Model: default, Effort: default, Status: working, Running: 4s, Project: project-b, Waiting for user: no, Summary: "Summary"');
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
          await vi.waitFor(() => expect(questionQueue.hasPending('conv-1')).toBe(true));
          yield* original(text);
        };
        const reviewer = delegatePort('<question>Which one?</question>');
        delegatePorts = [developer, reviewer];
        stubAgentPort.mockResponses = [
          '<delegate role="DEVELOPER" summary="Working on it" project="project-a">Build.</delegate>\n<delegate role="CODE_REVIEWER" summary="Working on it" project="project-b">Review.</delegate>',
          '<delegate role="NOBODY" summary="Working on it">Go.</delegate>',
          '<delegate role="NOBODY" summary="Working on it">Go.</delegate>',
        ];

        const result = await useCase.execute(turnRequest({ onQuestion: vi.fn() }));

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
          '<delegate role="DEVELOPER" summary="Working on it" project="project-b">Rebuild.</delegate>',
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
          '<delegate role="DEVELOPER" summary="Working on it" project="project-b">Rebuild.</delegate>',
          'Done.',
        ];

        /** A developer whose prompt only ends when `releaseOn` is called, failing with `error`. */
        const stuckDeveloper = (releaseOn: 'cancel' | 'closeSession', error: Error) => {
          const developer = delegatePort('never');
          let fail!: (error: Error) => void;
          const stuck = new Promise<void>((_, reject) => {
            fail = reject;
          });
          developer.prompt = async function* () {
            await stuck;
            yield textChunk('never');
          };
          if (releaseOn === 'cancel') {
            developer.cancel = async () => {
              fail(error);
            };
          } else {
            const close = developer.closeSession.bind(developer);
            developer.closeSession = async () => {
              await close();
              fail(error);
            };
          }
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
          const { result, rebuilt } = await replaceInTheSameTurn(stuckDeveloper('cancel', new PromptCancelledError()));

          expectOnlyTheReplacementReachedTheCeo(result, rebuilt);
        });

        it.each([
          ['its cancel fails it with a closed session', 'cancel', 'Resumed session disposed'],
          ['closing its session fails it as disposed', 'closeSession', 'Resumed session disposed'],
          ['closing its session leaves it not connected', 'closeSession', 'Not connected. Call connect() first.'],
        ] as const)('should not hand the CEO a failed result when %s', async (_name, releaseOn, message) => {
          const { result, rebuilt } = await replaceInTheSameTurn(stuckDeveloper(releaseOn, new Error(message)));

          expectOnlyTheReplacementReachedTheCeo(result, rebuilt);
        });

        it('should report the replaced delegation as cancelled and the new one as finished', async () => {
          const events: DelegationEvent[] = [];

          await replaceInTheSameTurn(
            stuckDeveloper('closeSession', new Error('Resumed session disposed')),
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
          const onQuestion = vi.fn();
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
            await vi.waitFor(() => expect(onQuestion).toHaveBeenCalled());
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

        it('should leave the replacement alone when the replaced agent\'s turn ends while that agent is still closing', async () => {
          let releaseOld!: (error: Error) => void;
          const oldClosing = new Promise<void>((_, reject) => {
            releaseOld = reject;
          });
          const old = delegatePort('never');
          old.prompt = async function* () {
            await oldClosing;
            yield textChunk('never');
          };
          let releaseLead!: () => void;
          const leadGate = new Promise<void>((resolve) => {
            releaseLead = resolve;
          });
          const lead = delegatePort('never');
          lead.prompt = async function* () {
            await leadGate;
            yield textChunk('Plan ready.');
          };
          let releaseReplacement!: () => void;
          const replacementGate = new Promise<void>((resolve) => {
            releaseReplacement = resolve;
          });
          let replacementStarted = false;
          const replacement = delegatePort('never');
          replacement.prompt = async function* () {
            replacementStarted = true;
            await replacementGate;
            yield textChunk('Rebuilt.');
          };
          delegatePorts = [old, lead, replacement];
          stubAgentPort.mockResponses = [
            '<delegate role="DEVELOPER" summary="Working on it" project="project-a">Build.</delegate>\n<delegate role="TECH_LEAD" summary="Working on it" project="project-b">Plan.</delegate>',
            '<delegate role="DEVELOPER" summary="Working on it" project="project-a">Rebuild.</delegate>',
            '<delegate role="NOBODY" summary="Working on it">Go.</delegate>',
            '<delegate role="NOBODY" summary="Working on it">Go.</delegate>',
            'Done.',
          ];

          const first = useCase.execute(turnRequest({ prompt: 'First' }));
          await vi.waitFor(() => expect(runtime.findActiveDelegation('conv-1', 'TECH_LEAD')).toBeDefined());
          const second = useCase.execute(turnRequest({ prompt: 'Second' }));
          await vi.waitFor(() => expect(replacementStarted).toBe(true));
          releaseLead();
          await vi.waitFor(() => expect(stubAgentPort.promptCalls).toHaveLength(4));
          await vi.waitFor(() => expect(lead.closeSessionCalls).toBe(1));
          const replacementCancels = replacement.cancelCalls;
          releaseOld(new Error('Resumed session disposed'));
          releaseReplacement();

          await expect(first).resolves.toMatchObject({ status: 'failed' });
          await expect(second).resolves.toMatchObject({ status: 'completed', response: 'Done.' });
          expect(replacementCancels).toBe(0);
          expect(replacement.cancelCalls).toBe(0);
        });

        it('should end as steered, without a response, the turn whose agent another turn replaced', async () => {
          const rebuilt = delegatePort('Rebuilt.');
          delegatePorts = [stuckDeveloper('closeSession', new Error('Resumed session disposed')), rebuilt];
          stubAgentPort.mockResponses = [
            '<delegate role="DEVELOPER" summary="Working on it" project="project-b">Build.</delegate>',
            '<delegate role="DEVELOPER" summary="Working on it" project="project-b">Rebuild.</delegate>',
            'Done.',
          ];

          const first = useCase.execute(turnRequest({ prompt: 'First' }));
          await vi.waitFor(() => expect(runtime.findActiveDelegation('conv-1', 'DEVELOPER')).toBeDefined());
          const second = await useCase.execute(turnRequest({ prompt: 'Second' }));

          await expect(first).resolves.toMatchObject({ status: 'steered', response: '' });
          expect(second).toMatchObject({ status: 'completed', response: 'Done.' });
          expect(stubAgentPort.promptCalls[2]).toContain(rebuiltResult);
          expect(stubAgentPort.promptCalls.filter(prompt => prompt.includes('status="failed"'))).toEqual([]);
          expect(runtime.pendingCeoNotices('conv-1')).toEqual([]);
        });

        it('should end as steered the resumed delegation another turn replaced', async () => {
          const delegation = '<delegate role="DEVELOPER" project="my-app" summary="Build it">Build.</delegate>';
          stubAgentPort.mockResponses = [delegation];
          const beforeRestart = delegatePort('never');
          beforeRestart.prompt = async function* () {
            await new Promise(() => undefined);
            yield* [];
          };
          delegatePorts = [beforeRestart];
          void useCase.execute(turnRequest({ resumable: true }));
          await vi.waitFor(() => expect(openWorkStore.saved['conv-1']?.some(work => work.role === 'DEVELOPER')).toBe(true));
          openWork.onModuleDestroy();

          const ceo = new StubAgentPort();
          const resumedDeveloper = stuckDeveloper('closeSession', new Error('Resumed session disposed'));
          const rebuilt = delegatePort('Rebuilt.');
          const developers = [resumedDeveloper, rebuilt];
          wire(new StubAgentPortFactory(agentId => (agentId === 'developer' ? developers.shift()! : ceo)));
          settingsStore.settings = buildStubSettings({ CEO: buildStubProfile('ceo'), DEVELOPER: buildStubProfile('developer') });
          await new RestoreOpenWorkUseCase(openWork, questionQueue).onModuleInit();
          ceo.mockResponses = [delegation, 'Done.'];
          const [work] = openWork.continuable('conv-1');

          const resumed = useCase.resume(work!.id, turnRequest());
          await vi.waitFor(() => expect(runtime.findActiveDelegation('conv-1', 'DEVELOPER')).toBeDefined());
          const second = await useCase.execute(turnRequest({ resumable: true }));

          await expect(resumed).resolves.toMatchObject({ status: 'steered', response: '' });
          expect(second).toMatchObject({ status: 'completed', response: 'Done.' });
          expect(rebuilt.promptCalls).toHaveLength(1);
          expect(ceo.promptCalls.filter(prompt => prompt.includes('status="failed"'))).toEqual([]);
        });

        it('should still end as cancelled, and tell the CEO, a turn the user cancels while an agent works', async () => {
          const developer = stuckDeveloper('cancel', new PromptCancelledError());
          delegatePorts = [developer];
          stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="project-a">Build.</delegate>'];

          const turn = useCase.execute(turnRequest());
          await vi.waitFor(() => expect(runtime.findActiveDelegation('conv-1', 'DEVELOPER')).toBeDefined());
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
      expect(saved?.agentSessions).toEqual([{ role: 'CEO', agentId: 'stub', sessionId: 'session-1', projectName: null }]);
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

    it('should ignore failures while disposing a delegate that cannot be steered', async () => {
      const staleDelegatePort = new StubAgentPort();
      staleDelegatePort.closeSession = async () => {
        throw new Error('close failed');
      };
      staleDelegatePort.disconnect = async () => {
        throw new Error('disconnect failed');
      };
      runtime.registerDelegation('conv-1', {
        role: 'DEVELOPER',
        roleName: 'Developer',
        agentInfo: { roleName: 'Developer', agentName: 'stub' },
        projectName: null,
        artifactId: null,
        summary: 'Summary',
        taskSpec: 'Old task',
        cwd: '/mock/workspace',
        startedAt: Date.now(),
        agentPort: staleDelegatePort,
        turn: { cancel: vi.fn().mockResolvedValue(undefined) } as any,
        steer: vi.fn(),
      });
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it">Go.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['Done.'];

      const result = await useCase.execute(turnRequest());

      expect(result).toMatchObject({ status: 'completed', response: 'Ok.' });
      expect(delegateStubPort.promptCalls).toHaveLength(1);
    });

    it('should record the new task without steering a delegate whose agent lacks steering', async () => {
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">Go.</delegate>', 'Ok.'];
      let captured: { taskSpec: string } | undefined;
      let steerAccepted: boolean | undefined;
      delegateStubPort.prompt = async function* () {
        const active = runtime.findActiveDelegation('conv-1', 'DEVELOPER');
        steerAccepted = await active?.steer('Updated task');
        captured = active;
        yield textChunk('Done.');
      };

      await useCase.execute(turnRequest());

      expect(captured?.taskSpec).toBe('Updated task');
      expect(steerAccepted).toBe(false);
      expect(delegateStubPort.steeringPrompts).toHaveLength(0);
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
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      });

      afterEach(() => {
        questionTimeoutMs = 0;
        vi.useRealTimers();
      });

      it('should tell the agent the recommended answer was assumed because the user was absent', async () => {
        stubAgentPort.mockResponses = [
          '<question>Which database?<option>Postgres</option><option recommended>SQLite</option></question>',
          'Using SQLite.',
        ];
        const onQuestion = vi.fn();

        const turn = useCase.execute(turnRequest({ onQuestion }));
        await vi.waitFor(() => expect(onQuestion).toHaveBeenCalledWith(expect.objectContaining({ kind: 'asked' })));
        vi.advanceTimersByTime(60_000);
        const result = await turn;

        expect(result).toMatchObject({ status: 'completed', response: 'Using SQLite.' });
        expect(onQuestion).toHaveBeenCalledWith(expect.objectContaining({ kind: 'timedOut', timeoutMs: 60_000 }));
        const answers = stubAgentPort.promptCalls[1]!;
        expect(answers).toContain('<answer question="Which database?" option="2" status="timed_out">SQLite</answer>');
        expect(answers).toContain('<note>The user was absent and did not reply in time.');
      });

      it('should tell the agent nothing was assumed when the question had no recommended option', async () => {
        stubAgentPort.mockResponses = ['<question>What is the limit?</question>', 'I will pick one.'];
        const onQuestion = vi.fn();

        const turn = useCase.execute(turnRequest({ onQuestion }));
        await vi.waitFor(() => expect(onQuestion).toHaveBeenCalled());
        vi.advanceTimersByTime(60_000);
        await turn;

        const answers = stubAgentPort.promptCalls[1]!;
        expect(answers).toContain('<answer question="What is the limit?" status="timed_out"></answer>');
        expect(answers).toContain('an answer with no option had no recommendation');
      });
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
      agentRegistry.getDelegationContract.mockReturnValue({ project: 'optional', sessionMode: 'overridable', readOnly: true });
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
            setTimeout(answers, 0);
          }
        },
      }));

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

    it('should end the turn as cancelled when the questions are cancelled while the delegate waits', async () => {
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it">Go.</delegate>'];
      delegateStubPort.mockResponses = ['<question>Q?</question>'];

      const result = await useCase.execute(turnRequest({
        onQuestion: () => queueMicrotask(() => questionQueue.cancel('conv-1')),
      }));

      expect(result.status).toBe('cancelled');
      expect(questionQueue.hasPending('conv-1')).toBe(false);
    });

    it('should replace a delegate waiting for answers instead of steering it', async () => {
      const waitingPort = new StubAgentPort();
      waitingPort.supportsSteering = true;
      const steer = vi.fn().mockResolvedValue(true);
      const cancel = vi.fn().mockResolvedValue(undefined);
      runtime.registerDelegation('conv-1', {
        role: 'DEVELOPER',
        roleName: 'Developer',
        agentInfo: { roleName: 'Developer', agentName: 'stub' },
        projectName: 'my-app',
        artifactId: null,
        summary: 'Summary',
        taskSpec: 'Old task',
        cwd: '/mock/workspace/my-app',
        startedAt: Date.now(),
        agentPort: waitingPort,
        turn: { cancel } as any,
        steer,
      });
      const waiting = questionQueue.ask('conv-1', { role: 'DEVELOPER', roleName: 'Developer', projectName: 'my-app' }, '', [{ text: 'Q?', options: [] }], questionListener());
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Working on it" project="my-app">New task.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['Done.'];

      const result = await useCase.execute(turnRequest());

      expect(result.response).toBe('Ok.');
      expect(steer).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalled();
      await expect(waiting).rejects.toBeInstanceOf(PromptCancelledError);
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

    it('keeps nothing for a turn that is not resumable', async () => {
      stubAgentPort.mockResponses = [delegation, 'Done.'];
      delegateStubPort.mockResponses = ['Built.'];

      await useCase.execute(turnRequest());

      expect(openWorkStore.saved).toEqual({});
    });

    it('forgets the work of a turn that ends', async () => {
      stubAgentPort.mockResponses = [delegation, 'Done.'];
      delegateStubPort.mockResponses = ['Built.'];

      await useCase.execute(turnRequest({ resumable: true }));

      expect(records()).toEqual([]);
    });

    it('keeps the answers on disk as they arrive and forgets the questions once answered', async () => {
      stubAgentPort.mockResponses = [delegation, 'Done.'];
      delegateStubPort.mockResponses = ['<question>First?</question><question>Second?</question>', 'Built.'];
      const onQuestion = vi.fn();
      const turn = useCase.execute(turnRequest({ resumable: true, onQuestion }));
      await vi.waitFor(() => expect(onQuestion).toHaveBeenCalled());

      questionQueue.submit('conv-1', { kind: 'text', text: 'one' });
      await vi.waitFor(() => expect(records().find(work => work.role === 'DEVELOPER')?.questions?.answers.map(answer => answer.answer)).toEqual(['one']));
      questionQueue.submit('conv-1', { kind: 'text', text: 'two' });

      await expect(turn).resolves.toMatchObject({ status: 'completed' });
      expect(records()).toEqual([]);
    });

    it('delivers the answers given after the restart like any answer and hands the delegate result to the CEO', async () => {
      stubAgentPort.mockResponses = [delegation];
      delegateStubPort.mockResponses = ['<question>Which colour?<option>Red</option><option>Blue</option></question>'];
      const onQuestion = vi.fn();
      void useCase.execute(turnRequest({ resumable: true, onQuestion }));
      await vi.waitFor(() => expect(onQuestion).toHaveBeenCalled());
      await vi.waitFor(() => expect(records().find(work => work.role === 'DEVELOPER')?.questions).toBeDefined());

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

    it('resumes a delegate that stopped working, without answers', async () => {
      stubAgentPort.mockResponses = [delegation];
      delegateStubPort.prompt = async function* () {
        await new Promise(() => undefined);
        yield* [];
      };
      const onDelegation = vi.fn();
      void useCase.execute(turnRequest({ resumable: true, onDelegation }));
      await vi.waitFor(() => expect(records().some(work => work.role === 'DEVELOPER')).toBe(true));

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

    it('resumes a CEO that asked, with the answers', async () => {
      stubAgentPort.mockResponses = ['<question>Go on?</question>'];
      const onQuestion = vi.fn();
      void useCase.execute(turnRequest({ resumable: true, prompt: 'Plan it', onQuestion }));
      await vi.waitFor(() => expect(onQuestion).toHaveBeenCalled());
      await vi.waitFor(() => expect(records()[0]?.questions).toBeDefined());

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
      const onQuestion = vi.fn();
      void useCase.execute(turnRequest({ resumable: true, onQuestion }));
      await vi.waitFor(() => expect(onQuestion).toHaveBeenCalled());
      await vi.waitFor(() => expect(records().find(work => work.role === 'DEVELOPER')?.questions).toBeDefined());
      const { ceo, developer } = await restart();
      ceo.mockResponses = ['All done.'];
      developer.mockResponses = ['Built.'];
      const { restoredWork } = questionQueue.submit('conv-1', { kind: 'text', text: 'this' }) as { restoredWork: RestoredWorkAnswers };
      return { ceo, developer, restoredWork };
    };

    it('gives the task along with the answers to a delegate whose session is lost', async () => {
      const { developer, restoredWork } = await answeredAfterRestart();
      developer.loadSessionResult = false;

      await useCase.deliverAnswers(restoredWork, turnRequest());

      expect(developer.promptCalls[0]).toContain('[LOST_SESSION]');
      expect(developer.promptCalls[0]).toContain('Build.');
      expect(developer.promptCalls[0]).toContain('kind="other">this</answer>');
    });

    it('asks again when a restart comes before the answers reach the delegate, and treats it as working after', async () => {
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
      await vi.waitFor(() => expect(records().find(work => work.role === 'DEVELOPER')?.questions).toBeDefined());
      expect(questionsWhenSent).toBe('not sent');
      connected();
      await turn;

      expect(questionsWhenSent).toBeUndefined();
    });

    it('gives the task along with the answers to a CEO whose session is lost', async () => {
      stubAgentPort.mockResponses = ['<question>Go on?</question>'];
      const onQuestion = vi.fn();
      void useCase.execute(turnRequest({ resumable: true, prompt: 'Plan it', onQuestion }));
      await vi.waitFor(() => expect(onQuestion).toHaveBeenCalled());
      await vi.waitFor(() => expect(records()[0]?.questions).toBeDefined());
      const { ceo } = await restart();
      ceo.loadSessionResult = false;
      ceo.mockResponses = ['Planned.'];
      const { restoredWork } = questionQueue.submit('conv-1', { kind: 'text', text: 'yes' }) as { restoredWork: RestoredWorkAnswers };

      await useCase.deliverAnswers(restoredWork, turnRequest());

      expect(ceo.promptCalls[0]).toContain('[LOST_SESSION]');
      expect(ceo.promptCalls[0]).toContain('Plan it');
    });

    it('fails on work that is not interrupted', async () => {
      await expect(useCase.resume('unknown', turnRequest())).resolves.toMatchObject({ status: 'failed', errorMessage: 'No interrupted work: unknown' });
      await expect(useCase.deliverAnswers({ workId: 'unknown', answers: [] }, turnRequest())).resolves.toMatchObject({ status: 'failed' });
    });

    it('replaces what a restart left stopped when the role is delegated again', async () => {
      stubAgentPort.mockResponses = [delegation];
      delegateStubPort.mockResponses = ['<question>Which?</question>'];
      const onQuestion = vi.fn();
      void useCase.execute(turnRequest({ resumable: true, onQuestion }));
      await vi.waitFor(() => expect(onQuestion).toHaveBeenCalled());
      await vi.waitFor(() => expect(records().find(work => work.role === 'DEVELOPER')?.questions).toBeDefined());

      const { ceo, developer } = await restart();
      ceo.mockResponses = [delegation, 'Done.'];
      developer.mockResponses = ['Built.'];

      await useCase.execute(turnRequest({ resumable: true }));

      expect(questionQueue.hasPending('conv-1')).toBe(false);
      expect(records()).toEqual([]);
    });

    it('records a steered task', async () => {
      stubAgentPort.mockResponses = [delegation, delegation.replace('Build.', 'Build more.')];
      delegateStubPort.supportsSteering = true;
      delegateStubPort.prompt = async function* () {
        await new Promise(() => undefined);
        yield* [];
      };
      void useCase.execute(turnRequest({ resumable: true }));
      await vi.waitFor(() => expect(records().some(work => work.role === 'DEVELOPER')).toBe(true));

      const delegationNow = runtime.findActiveDelegation('conv-1', 'DEVELOPER')!;
      await delegationNow.steer('Build more.');

      await vi.waitFor(() => expect(records().find(work => work.role === 'DEVELOPER')?.taskSpec).toBe('Build more.'));
    });
  });

  describe('artifacts', () => {
    const contracts: Record<string, DelegationContract> = {
      DEVELOPER: { project: 'required', sessionMode: 'overridable', artifact: 'required' },
      CODE_REVIEWER: { project: 'required', readOnly: true, artifact: 'required', needsReviewableWork: true },
      TECH_LEAD: { project: 'optional', readOnly: true, artifact: 'optional' },
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

    it('answers the artifact requests of the CEO in the same turn, discarding the draft, before it decides', async () => {
      stubAgentPort.mockResponses = ['Creating it. <artifact_create type="task" title="Login" project="my-app"/>', 'Created T-1.'];
      const onDraft = vi.fn();

      const result = await useCase.execute(turnRequest({ onDraft }));

      expect(result).toMatchObject({ status: 'completed', response: 'Created T-1.' });
      expect(stubAgentPort.promptCalls[1]).toContain('<request_result request="create" id="T-1" status="ok">');
      expect(onDraft).toHaveBeenCalledWith('');
      expect(await artifacts.get('conv-1', 'T-1')).toMatchObject({ title: 'Login', history: [{ actor: { kind: 'agent', role: 'CEO' } }] });
    });

    it('runs the requests that go with a delegation and hands their results over with the agent results', async () => {
      seed({ id: 'T-1', title: 'Login', status: 'ready' });
      stubAgentPort.mockResponses = ['<artifact_update id="T-1" status="in_progress"/>\n<delegate role="DEVELOPER" summary="Building" artifact="T-1">Implement T-1.</delegate>', 'Done.'];
      delegateStubPort.mockResponses = ['Built.'];

      const result = await useCase.execute(turnRequest());

      expect(result).toMatchObject({ status: 'completed', response: 'Done.' });
      expect(delegateStubPort.promptCalls[0]).toContain('- Status: in_progress');
      expect(stubAgentPort.promptCalls[1]).toMatch(/^<request_results>\n<request_result request="update" id="T-1" status="ok">[\s\S]*<\/request_results>\n\n<agent_result role="DEVELOPER"/);
      expect(stubAgentPort.promptCalls[1]).not.toContain('was not taken as your final answer');
    });

    it('hands the results of requests that go with questions over with the answers', async () => {
      stubAgentPort.mockResponses = ['<artifact_list/>\n<question>Which project?<option>demo</option></question>', 'Ok.'];
      const onQuestion = vi.fn();

      const turn = useCase.execute(turnRequest({ onQuestion }));
      await vi.waitFor(() => expect(onQuestion).toHaveBeenCalled());
      questionQueue.submit('conv-1', { kind: 'option', optionIndex: 1 });

      expect(await turn).toMatchObject({ status: 'completed', response: 'Ok.' });
      expect(stubAgentPort.promptCalls[1]).toMatch(/^<request_results>[\s\S]*No artifact matches\.[\s\S]*<\/request_results>\n\n<user_answers>/);
    });

    it('hands a delegate the results of requests that go with its questions over with the answers', async () => {
      seed({ id: 'T-1' });
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Building" artifact="T-1">Implement T-1.</delegate>', 'Done.'];
      delegateStubPort.mockResponses = ['<artifact_comment id="T-1">Starting.</artifact_comment><question>Which name?</question>', 'Built.'];
      const onQuestion = vi.fn();

      const turn = useCase.execute(turnRequest({ onQuestion }));
      await vi.waitFor(() => expect(onQuestion).toHaveBeenCalled());
      questionQueue.submit('conv-1', { kind: 'text', text: 'multiply' });

      expect((await turn).status).toBe('completed');
      expect(delegateStubPort.promptCalls[1]).toMatch(/^<request_results>[\s\S]*Commented on T-1[\s\S]*<\/request_results>\n\n<user_answers>/);
    });

    it('asks again when protocol tags were written outside the final response envelope', async () => {
      stubAgentPort.mockResponses = [
        '<artifact_list status="all"/>\n<final_response>Vou conferir o quadro.</final_response>',
        '<final_response><artifact_list status="all"/></final_response>',
        'Nothing on the board yet.',
      ];
      const onDraft = vi.fn();

      const result = await useCase.execute(turnRequest({ onDraft }));

      expect(stubAgentPort.promptCalls[1]).toBe('[PROTOCOL_ERROR]\nYour previous response wrote <artifact_list> outside the <final_response> block, where text is only progress narration, so nothing was done with it.\nAnswer again with every protocol tag, and the text that goes with it, inside a single <final_response>...</final_response> block.');
      expect(stubAgentPort.promptCalls[2]).toContain('No artifact matches.');
      expect(result).toMatchObject({ status: 'completed', response: 'Nothing on the board yet.' });
      expect(onDraft).toHaveBeenCalledWith('');
    });

    it('repairs a delegate the same way, without touching the draft of the CEO', async () => {
      seed({ id: 'T-1' });
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Building" artifact="T-1">Implement T-1.</delegate>', 'Done.'];
      delegateStubPort.mockResponses = ['<artifact_comment id="T-1">x</artifact_comment><final_response>Built.</final_response>', 'Built.'];
      const onDraft = vi.fn();

      await useCase.execute(turnRequest({ onDraft }));

      expect(delegateStubPort.promptCalls[1]).toContain('[PROTOCOL_ERROR]');
      expect(onDraft).not.toHaveBeenCalledWith('');
    });

    it('takes the last response as it is when the requests never stop', async () => {
      stubAgentPort.mockResponses = Array.from({ length: 31 }, () => '<artifact_list/>');

      const result = await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls).toHaveLength(31);
      expect(result.status).toBe('completed');
    });

    it('runs the delegate in the artifact project with its content, holding it until it finishes', async () => {
      seed({ id: 'T-1', title: 'Login', sections: { technical_solution: 'Use JWT.' } });
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Building the login" artifact="t-1">Implement T-1.</delegate>', 'Done.'];
      delegateStubPort.mockResponses = ['<artifact_update id="T-1" branch="feat/t-1"/>', 'Built on feat/t-1.'];
      const onDelegation = vi.fn();

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

    it('reports a delegation whose artifact another delegation of the role took meanwhile as failed', async () => {
      seed({ id: 'T-1', assignee: { role: 'DEVELOPER', roleName: 'DEVELOPER', delegationId: 'elsewhere', since: '2026-01-01T00:00:00.000Z' } });
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Building" artifact="T-1">Implement T-1.</delegate>', 'Ok.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls[1]).toContain('<agent_result role="DEVELOPER" project="my-app" artifact="T-1" artifact_status="ready" status="failed">\nT-1 is with DEVELOPER (DEVELOPER) right now');
      expect(delegateStubPort.connectCalls).toBe(0);
    });

    it('tells the CEO the status of the artifact a failed delegation held', async () => {
      seed({ id: 'T-1', status: 'in_progress' });
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Building" artifact="T-1">Implement T-1.</delegate>', 'Ok.'];
      delegateStubPort.promptErrorToThrow = new Error('agent crashed');

      await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls[1]).toContain('<agent_result role="DEVELOPER" project="my-app" artifact="T-1" artifact_status="in_progress" agent="stub" model="default" effort="default" status="failed">\nagent crashed\n</agent_result>');
      expect(await artifacts.get('conv-1', 'T-1')).toMatchObject({ assignee: null, history: [expect.anything(), { kind: 'released', summary: 'DEVELOPER released it: failed' }] });
    });

    it('logs a release that fails without failing the delegation', async () => {
      seed({ id: 'T-1' });
      artifacts.release = () => Promise.reject(new Error('disk full'));
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" summary="Building" artifact="T-1">Implement T-1.</delegate>', 'Done.'];
      delegateStubPort.mockResponses = ['Built.'];

      expect((await useCase.execute(turnRequest())).status).toBe('completed');
    });

    it('lets an agent that may take an artifact work without one, in the folder it was given', async () => {
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
      ['the same artifact twice', [{ id: 'T-1' }], '<delegate role="DEVELOPER" summary="x" artifact="T-1">Go.</delegate><delegate role="TECH_LEAD" summary="y" artifact="T-1">Plan.</delegate>', 'T-1 appears in more than one delegation.'],
    ] as const)('rejects %s', async (_name, artifactsToSeed, delegation, reason) => {
      seed(...artifactsToSeed);
      stubAgentPort.mockResponses = [delegation, delegation];

      const result = await useCase.execute(turnRequest());

      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain(reason);
    });
  });
});
