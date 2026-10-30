import { beforeEach, describe, expect, it } from 'vitest';

import type { AgentProviderInfo } from '../../agent/ports/agent-port-factory.port.js';
import type { AgentEffortState, AgentModelState } from '../../agent/ports/agent.port.js';
import { AGENT_ROLES } from '../../agent-definitions/models/agent-role.type.js';
import { AgentRegistryService } from '../../agent-definitions/services/agent-registry.service.js';
import { InMemoryAgentConfigSelectionStoreAdapter } from '../adapters/in-memory-agent-config-selection-store.adapter.js';
import type { AgentConfigSelection } from '../models/agent-config-selection.model.js';
import type { AgentProfileSettings, AgentSettings } from '../models/agent-settings.model.js';
import { AgentCapabilitiesService } from '../services/agent-capabilities.service.js';
import { AgentProfileListService } from '../services/agent-profile-list.service.js';
import { LanguageChangeRequestService } from '../services/language-change-request.service.js';
import { UserQuestionQueueService } from '../services/user-question-queue.service.js';
import { StubAgentPortFactory } from '../testing/stub-agent-port-factory.js';
import { buildStubProfile, StubAgentSettingsStore } from '../testing/stub-agent-settings-store.js';
import { StubAgentPort } from '../testing/stub-agent.port.js';
import { StubPreferencesStore } from '../testing/stub-preferences-store.js';
import { profileForAllRoles } from '../utils/agent-profile.util.js';

import { CancelAgentConfigSelectionUseCase } from './cancel-agent-config-selection.use-case.js';
import { ResolveConversationInputUseCase } from './resolve-conversation-input.use-case.js';
import { StartAgentConfigSelectionUseCase } from './start-agent-config-selection.use-case.js';
import { SubmitAgentConfigSelectionUseCase } from './submit-agent-config-selection.use-case.js';


const MODELS: AgentModelState = {
  availableModels: [
    { modelId: 'fast', name: 'fast', displayName: 'Fast Model', description: 'Quick answers' },
    { modelId: 'deep', name: 'deep', displayName: 'Deep Model' },
  ],
  currentModelId: 'fast',
};

const OTHER_MODELS: AgentModelState = {
  availableModels: [{ modelId: 'opus', name: 'opus', displayName: 'Opus' }],
  currentModelId: 'opus',
};

const DEEP_EFFORTS: AgentEffortState = {
  availableEfforts: [
    { effortId: 'low', name: 'Low' },
    { effortId: 'high', name: 'High', description: 'Thorough' },
  ],
  currentEffortId: 'low',
};

const SINGLE_AGENT: AgentProviderInfo[] = [{ agentId: 'stub', displayName: 'Stub Agent' }];

const TWO_AGENTS: AgentProviderInfo[] = [
  { agentId: 'stub', displayName: 'Stub Agent' },
  { agentId: 'other', displayName: 'Other Agent' },
];

const menuOf = (outcome: { readonly kind: string }): AgentConfigSelection => {
  if (!('selection' in outcome) || !outcome.selection) {
    throw new Error(`Expected an outcome carrying a selection, got ${outcome.kind}.`);
  }
  return outcome.selection as AgentConfigSelection;
};

const ROLE_IDS = new AgentRegistryService().listRoles();

const everyRole = (profile: unknown) => Object.fromEntries(AGENT_ROLES.map(role => [role, profile]));

const settingsOf = (overrides: Partial<AgentProfileSettings> = {}): AgentSettings => ({
  profiles: profileForAllRoles(AGENT_ROLES, {
    agentId: 'stub',
    agentName: 'Stub Agent',
    modelId: 'fast',
    modelName: 'Fast Model',
    effortId: null,
    effortName: null,
    ...overrides,
  }),
  updatedAt: '',
});

describe('agent configuration selection', () => {
  let selectionStore: InMemoryAgentConfigSelectionStoreAdapter;
  let settingsStore: StubAgentSettingsStore;
  let factory: StubAgentPortFactory;
  let start: StartAgentConfigSelectionUseCase;
  let submit: SubmitAgentConfigSelectionUseCase;
  let resolve: ResolveConversationInputUseCase;
  let cancel: CancelAgentConfigSelectionUseCase;
  let questionQueue: UserQuestionQueueService;
  let languageChangeRequests: LanguageChangeRequestService;
  let preferencesStore: StubPreferencesStore;

  const build = (
    modelsByAgent: Record<string, AgentModelState | null>,
    efforts: Record<string, AgentEffortState | null> = {},
    agents: AgentProviderInfo[] = SINGLE_AGENT,
  ) => {
    factory = new StubAgentPortFactory((agentId) => {
      const port = new StubAgentPort();
      port.agentName = agentId;
      port.modelsToReturn = modelsByAgent[agentId] ?? null;
      port.effortsByModel = efforts;
      return port;
    });
    factory.agents = agents;
    const capabilities = new AgentCapabilitiesService(factory);
    const registry = new AgentRegistryService();
    const profileList = new AgentProfileListService(capabilities, selectionStore, settingsStore, registry);
    start = new StartAgentConfigSelectionUseCase(capabilities, selectionStore, settingsStore, profileList);
    submit = new SubmitAgentConfigSelectionUseCase(
      capabilities,
      selectionStore,
      settingsStore,
      registry,
      profileList,
    );
    questionQueue = new UserQuestionQueueService();
    languageChangeRequests = new LanguageChangeRequestService();
    preferencesStore = new StubPreferencesStore();
    resolve = new ResolveConversationInputUseCase(
      selectionStore,
      settingsStore,
      start,
      submit,
      questionQueue,
      languageChangeRequests,
      preferencesStore,
    );
    cancel = new CancelAgentConfigSelectionUseCase(selectionStore);
  };

  beforeEach(() => {
    selectionStore = new InMemoryAgentConfigSelectionStoreAdapter();
    settingsStore = new StubAgentSettingsStore();
    build({ stub: MODELS, other: OTHER_MODELS }, { deep: DEEP_EFFORTS, fast: null });
  });

  describe('StartAgentConfigSelectionUseCase', () => {
    describe('model step', () => {
      it('should list the models of the factory default agent when there are no settings', async () => {
        const result = await start.execute({ conversationId: 'conv-th-1', step: 'model' });

        expect(result).toEqual({
          kind: 'selection',
          selection: {
            conversationId: 'conv-th-1',
            step: 'model',
            options: [
              { index: 1, id: 'fast', label: 'Fast Model', description: 'Quick answers' },
              { index: 2, id: 'deep', label: 'Deep Model', description: undefined },
            ],
            selectedAgent: { id: 'stub', name: 'Stub Agent' },
            pendingPrompt: undefined,
          },
        });
        await expect(selectionStore.find('conv-th-1')).resolves.not.toBeNull();
        expect(factory.createdAgentIds).toEqual(['stub']);
      });

      it('should list the models of the agent persisted in the settings', async () => {
        settingsStore.byConversation.set('conv-1', settingsOf({ agentId: 'other', agentName: 'Other Agent' }));

        const result = await start.execute({ conversationId: 'conv-1', step: 'model' });

        expect(result).toMatchObject({
          kind: 'selection',
          selection: {
            step: 'model',
            selectedAgent: { id: 'other', name: 'Other Agent' },
            options: [{ index: 1, id: 'opus', label: 'Opus' }],
          },
        });
        expect(factory.createdAgentIds).toEqual(['other']);
      });

      it('should fall back to the most recent settings when current conversation has none in model step', async () => {
        settingsStore.byConversation.set('prev-conv', settingsOf({ agentId: 'other', agentName: 'Other Agent' }));

        const result = await start.execute({ conversationId: 'new-conv', step: 'model' });

        expect(result).toMatchObject({
          kind: 'selection',
          selection: {
            step: 'model',
            selectedAgent: { id: 'other', name: 'Other Agent' },
            options: [{ index: 1, id: 'opus', label: 'Opus' }],
          },
        });
        expect(factory.createdAgentIds).toEqual(['other']);
      });

      it.each([
        ['no model option', null],
        ['an empty model list', { availableModels: [], currentModelId: '' }],
      ])('should be unavailable when the agent exposes %s', async (_label, models) => {
        build({ stub: models });

        await expect(start.execute({ conversationId: 'conv-1', step: 'model' })).resolves.toEqual({
          kind: 'unavailable',
        });
        await expect(selectionStore.find('conv-1')).resolves.toBeNull();
      });
    });

    describe('agent step', () => {
      it('should list the agents as numbered options when there is more than one', async () => {
        build({ stub: MODELS, other: OTHER_MODELS }, {}, TWO_AGENTS);

        const result = await start.execute({
          conversationId: 'conv-th-1',
          step: 'agent',
          pendingPrompt: 'Build it',
        });

        expect(result).toEqual({
          kind: 'selection',
          selection: {
            conversationId: 'conv-th-1',
            step: 'agent',
            options: [
              { index: 1, id: 'stub', label: 'Stub Agent' },
              { index: 2, id: 'other', label: 'Other Agent' },
            ],
            pendingPrompt: 'Build it',
          },
        });
        await expect(selectionStore.find('conv-th-1')).resolves.toMatchObject({ step: 'agent' });
        expect(factory.createdAgentIds).toEqual([]);
      });

      it('should be unavailable when no agent is listed', async () => {
        build({}, {}, []);

        await expect(start.execute({ conversationId: 'conv-1', step: 'agent' })).resolves.toEqual({
          kind: 'unavailable',
        });
        await expect(selectionStore.find('conv-1')).resolves.toBeNull();
      });

      it('should go straight to the model step when there is exactly one agent', async () => {
        const result = await start.execute({ conversationId: 'conv-1', step: 'agent', pendingPrompt: 'Hi' });

        expect(result).toMatchObject({
          kind: 'selection',
          selection: {
            step: 'model',
            selectedAgent: { id: 'stub', name: 'Stub Agent' },
            pendingPrompt: 'Hi',
            options: [{ id: 'fast' }, { id: 'deep' }],
          },
        });
        await expect(selectionStore.find('conv-1')).resolves.toMatchObject({ step: 'model' });
      });

      it('should be unavailable when the only agent exposes no models', async () => {
        build({ stub: null });

        await expect(start.execute({ conversationId: 'conv-1', step: 'agent' })).resolves.toEqual({
          kind: 'unavailable',
        });
        await expect(selectionStore.find('conv-1')).resolves.toBeNull();
      });
    });

    describe('profile step', () => {
      const ROLE_LABELS = ROLE_IDS.map(role => new AgentRegistryService().getDisplayName(role));

      it('should list every role with the agent, model and effort of its profile', async () => {
        settingsStore.byConversation.set('conv-1', {
          profiles: {
            ...settingsOf({ modelId: 'fast', modelName: 'Fast Model' }).profiles,
            DEVELOPER: {
              agentId: 'other',
              agentName: 'Other Agent',
              modelId: 'opus',
              modelName: 'Opus',
              effortId: 'high',
              effortName: 'High',
            },
          },
          updatedAt: '',
        });

        const result = await start.execute({ conversationId: 'conv-1', step: 'profile' });

        expect(result.kind).toBe('profiles_menu');
        const selection = menuOf(result);
        expect(selection).toMatchObject({ conversationId: 'conv-1', step: 'profile' });
        expect(selection.targetRoles).toBeUndefined();
        expect(selection.options.map(option => option.id)).toEqual(ROLE_IDS);
        expect(selection.options.map(option => option.label)).toEqual(ROLE_LABELS);
        expect(selection.options.map(option => option.index)).toEqual([1, 2, 3, 4, 5, 6]);
        expect(selection.options.find(option => option.id === 'DEVELOPER')?.description)
          .toBe('Other Agent - Opus - High');
        expect(selection.options.find(option => option.id === 'CEO')?.description)
          .toBe('Stub Agent - Fast Model - default');
        await expect(selectionStore.find('conv-1')).resolves.toEqual(selection);
      });

      it('should show default for a null model and effort and use the CEO profile for roles without one', async () => {
        settingsStore.byConversation.set('conv-1', {
          profiles: { CEO: buildStubProfile('other', { agentName: 'Other Agent' }) },
          updatedAt: '',
        });

        const result = await start.execute({ conversationId: 'conv-1', step: 'profile' });

        const descriptions = menuOf(result).options.map(option => option.description);
        expect(descriptions).toEqual(AGENT_ROLES.map(() => 'Other Agent - default - default'));
      });

      it('should fall back to the most recent settings of another conversation', async () => {
        settingsStore.byConversation.set('older', settingsOf({ modelName: 'Old Model' }));
        settingsStore.byConversation.set('recent', {
          ...settingsOf({ modelName: 'Recent Model' }),
          updatedAt: '2030-01-01T00:00:00Z',
        });

        const result = await start.execute({ conversationId: 'brand-new', step: 'profile' });

        expect(menuOf(result).options[0]?.description)
          .toBe('Stub Agent - Recent Model - default');
      });

      it('should describe every role with the factory default agent when nothing is configured', async () => {
        const result = await start.execute({ conversationId: 'conv-1', step: 'profile' });

        const descriptions = menuOf(result).options.map(option => option.description);
        expect(descriptions).toEqual(AGENT_ROLES.map(() => 'Stub Agent - default - default'));
      });

      it('should be unavailable when no agent is listed', async () => {
        build({}, {}, []);

        await expect(start.execute({ conversationId: 'conv-1', step: 'profile' })).resolves.toEqual({
          kind: 'unavailable',
        });
        await expect(selectionStore.find('conv-1')).resolves.toBeNull();
      });
    });
  });

  describe('SubmitAgentConfigSelectionUseCase', () => {
    describe('model and effort steps', () => {
      beforeEach(async () => {
        await start.execute({ conversationId: 'conv-1', step: 'model' });
      });

      it.each(['abc', '0', '3', '1.5', ''])('should reject %j without changing the state', async (input) => {
        const before = await selectionStore.find('conv-1');

        const outcome = await submit.execute({ conversationId: 'conv-1', input });

        expect(outcome).toEqual({ kind: 'invalid', selection: before });
        await expect(selectionStore.find('conv-1')).resolves.toEqual(before);
        expect(settingsStore.saved).toHaveLength(0);
      });

      it('should advance to the effort step and then save the settings with the agent', async () => {
        const effortStep = await submit.execute({ conversationId: 'conv-1', input: ' 2 ' });

        expect(effortStep).toEqual({
          kind: 'selection',
          selection: expect.objectContaining({
            step: 'effort',
            selectedAgent: { id: 'stub', name: 'Stub Agent' },
            selectedModel: { id: 'deep', name: 'Deep Model' },
            options: [
              { index: 1, id: 'low', label: 'Low', description: undefined },
              { index: 2, id: 'high', label: 'High', description: 'Thorough' },
            ],
          }),
        });

        const configured = await submit.execute({ conversationId: 'conv-1', input: '2' });

        expect(configured).toEqual({
          kind: 'configured',
          settings: {
            profiles: everyRole({
              agentId: 'stub',
              agentName: 'Stub Agent',
              modelId: 'deep',
              modelName: 'Deep Model',
              effortId: 'high',
              effortName: 'High',
            }),
            updatedAt: expect.any(String),
          },
          pendingPrompt: undefined,
        });
        expect(settingsStore.settings?.profiles.CEO?.modelId).toBe('deep');
        await expect(selectionStore.find('conv-1')).resolves.toBeNull();
      });

      it('should save the model without effort when it has no effort options', async () => {
        const outcome = await submit.execute({ conversationId: 'conv-1', input: '1' });

        expect(outcome).toMatchObject({
          kind: 'configured',
          settings: { profiles: everyRole(expect.objectContaining({ agentId: 'stub', modelId: 'fast', effortId: null, effortName: null })) },
        });
      });

      it('should save the model without effort when its effort list is empty', async () => {
        build({ stub: MODELS }, { deep: { availableEfforts: [], currentEffortId: '' } });
        await start.execute({ conversationId: 'conv-1', step: 'model' });

        await expect(submit.execute({ conversationId: 'conv-1', input: '2' })).resolves.toMatchObject({
          kind: 'configured',
          settings: { profiles: everyRole(expect.objectContaining({ modelId: 'deep', effortId: null })) },
        });
      });

      it('should probe efforts on the agent that owns the selection', async () => {
        settingsStore.settings = settingsOf({ agentId: 'other', agentName: 'Other Agent' });
        await start.execute({ conversationId: 'conv-2', step: 'model' });
        factory.createdAgentIds.length = 0;

        await submit.execute({ conversationId: 'conv-2', input: '1' });

        expect(factory.createdAgentIds).toEqual(['other']);
        expect(settingsStore.saved.at(-1)).toMatchObject({
          profiles: everyRole(expect.objectContaining({ agentId: 'other', modelId: 'opus' })),
        });
      });

      it.each(['model', 'effort'] as const)('should fail when the %s step has no agent', async (step) => {
        await selectionStore.save({
          conversationId: 'conv-broken',
          step,
          options: [{ index: 1, id: 'fast', label: 'Fast Model' }],
        });

        await expect(submit.execute({ conversationId: 'conv-broken', input: '1' })).rejects.toThrow(
          `Agent configuration selection at step "${step}" has no agent.`,
        );
        expect(settingsStore.saved).toHaveLength(0);
      });
    });

    describe('agent step', () => {
      beforeEach(async () => {
        build({ stub: MODELS, other: OTHER_MODELS }, { deep: DEEP_EFFORTS }, TWO_AGENTS);
        await start.execute({ conversationId: 'conv-1', step: 'agent', pendingPrompt: 'Build it' });
      });

      it('should reject an unknown agent number', async () => {
        await expect(submit.execute({ conversationId: 'conv-1', input: '3' })).resolves.toMatchObject({
          kind: 'invalid',
          selection: { step: 'agent' },
        });
      });

      it('should advance to the model step listing the models of the chosen agent', async () => {
        const outcome = await submit.execute({ conversationId: 'conv-1', input: '2' });

        expect(outcome).toEqual({
          kind: 'selection',
          selection: {
            conversationId: 'conv-1',
            threadId: undefined,
            step: 'model',
            selectedAgent: { id: 'other', name: 'Other Agent' },
            options: [{ index: 1, id: 'opus', label: 'Opus', description: undefined }],
            pendingPrompt: 'Build it',
          },
        });
        await expect(selectionStore.find('conv-1')).resolves.toMatchObject({ step: 'model' });
        expect(factory.createdAgentIds).toEqual(['other']);
      });

      it('should complete the whole agent, model and effort flow', async () => {
        await submit.execute({ conversationId: 'conv-1', input: '1' });
        await submit.execute({ conversationId: 'conv-1', input: '2' });

        const outcome = await submit.execute({ conversationId: 'conv-1', input: '1' });

        expect(outcome).toMatchObject({
          kind: 'configured',
          settings: {
            profiles: everyRole(expect.objectContaining({
              agentId: 'stub',
              agentName: 'Stub Agent',
              modelId: 'deep',
              effortId: 'low',
            })),
          },
          pendingPrompt: 'Build it',
        });
      });

      it('should save only the agent when it exposes no models', async () => {
        build({ stub: MODELS, other: null }, {}, TWO_AGENTS);
        await start.execute({ conversationId: 'conv-2', step: 'agent', pendingPrompt: 'Go' });

        const outcome = await submit.execute({ conversationId: 'conv-2', input: '2' });

        expect(outcome).toEqual({
          kind: 'configured',
          settings: {
            profiles: everyRole({
              agentId: 'other',
              agentName: 'Other Agent',
              modelId: null,
              modelName: null,
              effortId: null,
              effortName: null,
            }),
            updatedAt: expect.any(String),
          },
          pendingPrompt: 'Go',
        });
        await expect(selectionStore.find('ch-2')).resolves.toBeNull();
        expect(settingsStore.settings?.profiles.CEO?.agentId).toBe('other');
      });
    });

    describe('profile step', () => {
      const openProfiles = async (agents: AgentProviderInfo[] = TWO_AGENTS) => {
        build({ stub: MODELS, other: OTHER_MODELS }, { deep: DEEP_EFFORTS }, agents);
        settingsStore.byConversation.set('conv-1', settingsOf());
        await start.execute({ conversationId: 'conv-1', step: 'profile' });
      };

      it('should close the list and remove the selection when the input is 0', async () => {
        await openProfiles();

        await expect(submit.execute({ conversationId: 'conv-1', input: ' 0 ' })).resolves.toEqual({
          kind: 'profiles_closed',
        });
        await expect(selectionStore.find('conv-1')).resolves.toBeNull();
        expect(settingsStore.saved).toHaveLength(0);
      });

      it.each(['abc', '7', '1,7', '1 x', '0,1', '', ' , ', '1.5'])(
        'should reject %j keeping the same list',
        async (input) => {
          await openProfiles();
          const before = await selectionStore.find('conv-1');

          await expect(submit.execute({ conversationId: 'conv-1', input })).resolves.toEqual({
            kind: 'invalid',
            selection: before,
          });
          await expect(selectionStore.find('conv-1')).resolves.toEqual(before);
        },
      );

      it.each(['1, 4', '1,4', '1 4', '4 1,4, 1', ' 1 ,  4 '])(
        'should store the unique chosen roles and ask for the agent with %j',
        async (input) => {
          await openProfiles();

          const outcome = await submit.execute({ conversationId: 'conv-1', input });

          expect(outcome).toMatchObject({
            kind: 'selection',
            selection: {
              step: 'agent',
              targetRoles: expect.arrayContaining(['CEO', 'TECH_LEAD']),
              options: [
                { index: 1, id: 'stub', label: 'Stub Agent' },
                { index: 2, id: 'other', label: 'Other Agent' },
              ],
            },
          });
          const stored = await selectionStore.find('conv-1');
          expect(stored?.targetRoles).toHaveLength(2);
        },
      );

      it('should skip to the model step when there is a single agent', async () => {
        await openProfiles(SINGLE_AGENT);

        const outcome = await submit.execute({ conversationId: 'conv-1', input: '2' });

        expect(outcome).toMatchObject({
          kind: 'selection',
          selection: {
            step: 'model',
            targetRoles: ['GIT_OPS'],
            selectedAgent: { id: 'stub', name: 'Stub Agent' },
            options: [{ id: 'fast' }, { id: 'deep' }],
          },
        });
      });

      it('should save the agent alone and return to the list when the single agent exposes no models', async () => {
        build({ stub: null }, {}, SINGLE_AGENT);
        settingsStore.byConversation.set('conv-1', settingsOf());
        await start.execute({ conversationId: 'conv-1', step: 'profile' });

        const outcome = await submit.execute({ conversationId: 'conv-1', input: '5' });

        expect(outcome).toMatchObject({
          kind: 'profiles_updated',
          profile: { agentId: 'stub', modelId: null, effortId: null },
          updatedRoles: [{ id: 'DEVELOPER', name: 'Developer Agent' }],
        });
      });

      it('should change only the selected roles and return to the refreshed list', async () => {
        await openProfiles();
        await submit.execute({ conversationId: 'conv-1', input: '1,5' });
        await submit.execute({ conversationId: 'conv-1', input: '2' });

        const outcome = await submit.execute({ conversationId: 'conv-1', input: '1' });

        const opus = {
          agentId: 'other',
          agentName: 'Other Agent',
          modelId: 'opus',
          modelName: 'Opus',
          effortId: null,
          effortName: null,
        };
        expect(outcome).toEqual({
          kind: 'profiles_updated',
          selection: {
            conversationId: 'conv-1',
            step: 'profile',
            options: expect.any(Array),
          },
          updatedRoles: [
            { id: 'CEO', name: 'CEO' },
            { id: 'DEVELOPER', name: 'Developer Agent' },
          ],
          profile: opus,
        });
        const saved = settingsStore.saved.at(-1)!;
        expect(saved.profiles.CEO).toEqual(opus);
        expect(saved.profiles.DEVELOPER).toEqual(opus);
        expect(saved.profiles.GIT_OPS).toEqual(settingsOf().profiles.GIT_OPS);
        expect(saved.profiles.TECH_LEAD).toEqual(settingsOf().profiles.TECH_LEAD);
        const list = menuOf(outcome).options;
        expect(list.find(option => option.id === 'DEVELOPER')?.description).toBe('Other Agent - Opus - default');
        expect(list.find(option => option.id === 'GIT_OPS')?.description).toBe('Stub Agent - Fast Model - default');
        const stored = await selectionStore.find('conv-1');
        expect(stored).toEqual(outcome.kind === 'profiles_updated' ? outcome.selection : null);
        expect(stored?.targetRoles).toBeUndefined();
      });

      it('should build the profiles from empty settings when none exist yet', async () => {
        build({ stub: MODELS }, {}, SINGLE_AGENT);
        await start.execute({ conversationId: 'conv-1', step: 'profile' });
        await submit.execute({ conversationId: 'conv-1', input: '3' });

        await submit.execute({ conversationId: 'conv-1', input: '2' });

        expect(Object.keys(settingsStore.saved.at(-1)!.profiles)).toEqual(['PRODUCT_OWNER']);
      });

      it('should go back to the list from the agent, model and effort steps with 0 without saving', async () => {
        await openProfiles();
        await submit.execute({ conversationId: 'conv-1', input: '1' });

        const fromAgent = await submit.execute({ conversationId: 'conv-1', input: '0' });
        expect(fromAgent).toMatchObject({ kind: 'profiles_menu', selection: { step: 'profile' } });
        expect((await selectionStore.find('conv-1'))?.targetRoles).toBeUndefined();

        await submit.execute({ conversationId: 'conv-1', input: '1' });
        await submit.execute({ conversationId: 'conv-1', input: '1' });
        const fromModel = await submit.execute({ conversationId: 'conv-1', input: '0' });
        expect(fromModel).toMatchObject({ kind: 'profiles_menu', selection: { step: 'profile' } });

        await submit.execute({ conversationId: 'conv-1', input: '1' });
        await submit.execute({ conversationId: 'conv-1', input: '1' });
        await submit.execute({ conversationId: 'conv-1', input: '2' });
        const fromEffort = await submit.execute({ conversationId: 'conv-1', input: '0' });
        expect(fromEffort).toMatchObject({ kind: 'profiles_menu', selection: { step: 'profile' } });
        expect(settingsStore.saved).toHaveLength(0);
      });
    });

    describe('every role overwrite', () => {
      it('should overwrite every profile and keep the pending prompt when targetRoles is undefined', async () => {
        settingsStore.byConversation.set('conv-1', {
          profiles: {
            CEO: buildStubProfile('stub'),
            DEVELOPER: buildStubProfile('other', { agentName: 'Other Agent' }),
          },
          updatedAt: '',
        });
        await start.execute({ conversationId: 'conv-1', step: 'model' });

        const outcome = await submit.execute({ conversationId: 'conv-1', input: '1' });

        expect(outcome).toMatchObject({ kind: 'configured' });
        const { profiles } = settingsStore.saved.at(-1)!;
        expect(Object.keys(profiles).sort()).toEqual([...ROLE_IDS].sort());
        expect(new Set(Object.values(profiles).map(profile => profile.modelId))).toEqual(new Set(['fast']));
      });
    });

    it('should fail when there is no selection in progress', async () => {
      await expect(submit.execute({ conversationId: 'other', input: '1' })).rejects.toThrow(
        'No agent configuration selection in progress.',
      );
    });
  });

  describe('ResolveConversationInputUseCase', () => {
    const asker = { role: 'PRODUCT_OWNER', roleName: 'Product Owner', projectName: null };
    const questions = [
      { text: 'Who approves the refund?', rationale: 'Defines the flow.', options: ['Manager', 'Finance'] },
      { text: 'What is the limit?', options: [] },
    ];

    it('should take the message as the answer to the waiting question before anything else', async () => {
      await resolve.execute({ conversationId: 'conv-1', prompt: 'Build it' });
      const answers = questionQueue.ask('conv-1', asker, 'Before planning:', questions);

      await expect(resolve.execute({ conversationId: 'conv-1', prompt: '7' })).resolves.toMatchObject({
        kind: 'invalid_answer',
        prompt: { number: 1, question: { text: 'Who approves the refund?' } },
      });
      await expect(resolve.execute({ conversationId: 'conv-1', prompt: '2' })).resolves.toMatchObject({
        kind: 'question',
        prompt: { number: 2, total: 2, question: { text: 'What is the limit?' } },
      });
      await expect(resolve.execute({ conversationId: 'conv-1', prompt: 'R$ 500' })).resolves.toEqual({
        kind: 'answered',
        asker,
      });

      await expect(answers).resolves.toEqual([
        { question: questions[0], answer: 'Finance', optionNumber: 2 },
        { question: questions[1], answer: 'R$ 500' },
      ]);
      await expect(selectionStore.find('conv-1')).resolves.toMatchObject({ pendingPrompt: 'Build it' });
    });

    it('should take attached files as the answer to the waiting question', async () => {
      const file = { name: 'flow.png', path: '/tmp/flow.png', contentType: 'image/png', size: 10 };
      const answers = questionQueue.ask('conv-1', asker, '', [questions[1]!]);

      await expect(resolve.execute({ conversationId: 'conv-1', prompt: '', attachments: [file] })).resolves.toEqual({ kind: 'answered', asker });

      await expect(answers).resolves.toEqual([{ question: questions[1], answer: '', attachments: [file] }]);
    });

    it('should store the next message as the language while a language change is pending', async () => {
      languageChangeRequests.request('conv-1');

      await expect(resolve.execute({ conversationId: 'conv-1', prompt: '  Spanish ' })).resolves.toEqual({ kind: 'language_set', language: 'Spanish' });

      expect(preferencesStore.preferences.language).toBe('Spanish');
      expect(languageChangeRequests.isPending('conv-1')).toBe(false);
    });

    it('should keep the language change pending when the message is not a language', async () => {
      languageChangeRequests.request('conv-1');

      await expect(resolve.execute({ conversationId: 'conv-1', prompt: '<b>Spanish</b>' })).resolves.toEqual({ kind: 'invalid_language' });

      expect(preferencesStore.updates).toEqual([]);
      expect(languageChangeRequests.isPending('conv-1')).toBe(true);
    });

    it('should take a message as an answer before a pending language change', async () => {
      languageChangeRequests.request('conv-1');
      const answers = questionQueue.ask('conv-1', asker, '', [questions[1]!]);

      await expect(resolve.execute({ conversationId: 'conv-1', prompt: '200' })).resolves.toEqual({ kind: 'answered', asker });

      await expect(answers).resolves.toEqual([{ question: questions[1], answer: '200' }]);
      expect(languageChangeRequests.isPending('conv-1')).toBe(true);
    });

    it('should give a message with only attachments a prompt that asks to analyze them', async () => {
      await settingsStore.save('conv-1', settingsOf({ agentName: 'Stub', modelId: null }));
      const file = { name: 'flow.png', path: '/tmp/flow.png', contentType: 'image/png', size: 10 };

      await expect(resolve.execute({ conversationId: 'conv-1', prompt: '', attachments: [file] })).resolves.toEqual({
        kind: 'execute',
        prompt: 'The user sent attachments. Analyze the attached files.',
      });
    });

    it('should start the model step of the only agent keeping the prompt when there are no settings', async () => {
      const resolution = await resolve.execute({ conversationId: 'conv-th-1', prompt: 'Build it' });

      expect(resolution).toMatchObject({
        kind: 'selection',
        selection: { step: 'model', selectedAgent: { id: 'stub' }, pendingPrompt: 'Build it' },
      });
    });

    it('should start the agent step keeping the prompt when several agents are available', async () => {
      build({ stub: MODELS, other: OTHER_MODELS }, {}, TWO_AGENTS);

      const resolution = await resolve.execute({ conversationId: 'conv-1', prompt: 'Build it' });

      expect(resolution).toMatchObject({
        kind: 'selection',
        selection: { step: 'agent', pendingPrompt: 'Build it' },
      });
    });

    it('should execute the pending prompt once the selection is configured', async () => {
      await resolve.execute({ conversationId: 'conv-1', prompt: 'Build it' });

      await expect(resolve.execute({ conversationId: 'conv-1', prompt: 'nope' })).resolves.toMatchObject({
        kind: 'invalid',
      });
      await expect(resolve.execute({ conversationId: 'conv-1', prompt: '2' })).resolves.toMatchObject({
        kind: 'selection',
      });
      const resolution = await resolve.execute({ conversationId: 'conv-1', prompt: '1' });

      expect(resolution).toEqual({
        kind: 'execute',
        prompt: 'Build it',
        configured: expect.objectContaining({
          profiles: everyRole(expect.objectContaining({ agentId: 'stub', modelId: 'deep', effortId: 'low' })),
        }),
      });
    });

    it('should return configured when the selection had no pending prompt', async () => {
      await start.execute({ conversationId: 'conv-1', step: 'model' });

      await expect(resolve.execute({ conversationId: 'conv-1', prompt: '1' })).resolves.toEqual({
        kind: 'configured',
        settings: expect.objectContaining({ profiles: everyRole(expect.objectContaining({ modelId: 'fast' })) }),
      });
    });

    it('should route a profile list answer through the selection and return the outcome', async () => {
      settingsStore.settings = settingsOf();
      await start.execute({ conversationId: 'conv-1', step: 'profile' });

      await expect(resolve.execute({ conversationId: 'conv-1', prompt: '0' })).resolves.toEqual({
        kind: 'profiles_closed',
      });
      await expect(selectionStore.find('conv-1')).resolves.toBeNull();
    });

    it('should execute directly when settings already exist', async () => {
      settingsStore.byConversation.set('conv-1', settingsOf());

      await expect(resolve.execute({ conversationId: 'conv-1', prompt: 'Hi' })).resolves.toEqual({
        kind: 'execute',
        prompt: 'Hi',
      });
    });

    it('should inherit and persist the most recent settings when starting a new conversation', async () => {
      const existingSettings = settingsOf({
        agentId: 'other',
        agentName: 'Other Agent',
        modelId: 'opus',
        modelName: 'Opus',
        effortId: null,
        effortName: null,
      });
      settingsStore.byConversation.set('prev-conv', existingSettings);

      const resolution = await resolve.execute({ conversationId: 'new-conv', prompt: 'Do work' });

      expect(resolution).toEqual({
        kind: 'execute',
        prompt: 'Do work',
      });
      const inherited = await settingsStore.load('new-conv');
      expect(inherited).toMatchObject({
        profiles: everyRole(expect.objectContaining({
          agentId: 'other',
          agentName: 'Other Agent',
          modelId: 'opus',
          modelName: 'Opus',
        })),
      });
    });

    it('should execute directly when no agent is available', async () => {
      build({}, {}, []);

      await expect(resolve.execute({ conversationId: 'conv-1', prompt: 'Hi' })).resolves.toEqual({
        kind: 'execute',
        prompt: 'Hi',
      });
    });

    it('should execute directly when the agent exposes no models', async () => {
      build({ stub: null });

      await expect(resolve.execute({ conversationId: 'conv-1', prompt: 'Hi' })).resolves.toEqual({
        kind: 'execute',
        prompt: 'Hi',
      });
    });
  });

  describe('CancelAgentConfigSelectionUseCase', () => {
    it('should remove an active selection and report it', async () => {
      await start.execute({ conversationId: 'conv-1', step: 'model' });

      await expect(cancel.execute('conv-1')).resolves.toBe(true);
      await expect(cancel.execute('conv-1')).resolves.toBe(false);
    });
  });
});
