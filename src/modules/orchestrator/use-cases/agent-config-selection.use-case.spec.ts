import { beforeEach, describe, expect, it } from 'vitest';

import type { AgentProviderInfo } from '../../agent/ports/agent-port-factory.port.js';
import type { AgentEffortState, AgentModelState } from '../../agent/ports/agent.port.js';
import { InMemoryAgentConfigSelectionStoreAdapter } from '../adapters/in-memory-agent-config-selection-store.adapter.js';
import type { AgentSettings } from '../models/agent-settings.model.js';
import { AgentCapabilitiesService } from '../services/agent-capabilities.service.js';
import { StubAgentPortFactory } from '../testing/stub-agent-port-factory.js';
import { StubAgentSettingsStore } from '../testing/stub-agent-settings-store.js';
import { StubAgentPort } from '../testing/stub-agent.port.js';

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

const settingsOf = (overrides: Partial<AgentSettings> = {}): AgentSettings => ({
  agentId: 'stub',
  agentName: 'Stub Agent',
  modelId: 'fast',
  modelName: 'Fast Model',
  effortId: null,
  effortName: null,
  updatedAt: '',
  ...overrides,
});

describe('agent configuration selection', () => {
  let selectionStore: InMemoryAgentConfigSelectionStoreAdapter;
  let settingsStore: StubAgentSettingsStore;
  let factory: StubAgentPortFactory;
  let start: StartAgentConfigSelectionUseCase;
  let submit: SubmitAgentConfigSelectionUseCase;
  let resolve: ResolveConversationInputUseCase;
  let cancel: CancelAgentConfigSelectionUseCase;

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
    start = new StartAgentConfigSelectionUseCase(capabilities, selectionStore, settingsStore);
    submit = new SubmitAgentConfigSelectionUseCase(capabilities, selectionStore, settingsStore);
    resolve = new ResolveConversationInputUseCase(selectionStore, settingsStore, start, submit);
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
            agentId: 'stub',
            agentName: 'Stub Agent',
            modelId: 'deep',
            modelName: 'Deep Model',
            effortId: 'high',
            effortName: 'High',
            updatedAt: expect.any(String),
          },
          pendingPrompt: undefined,
        });
        expect(settingsStore.settings?.modelId).toBe('deep');
        await expect(selectionStore.find('conv-1')).resolves.toBeNull();
      });

      it('should save the model without effort when it has no effort options', async () => {
        const outcome = await submit.execute({ conversationId: 'conv-1', input: '1' });

        expect(outcome).toMatchObject({
          kind: 'configured',
          settings: { agentId: 'stub', modelId: 'fast', effortId: null, effortName: null },
        });
      });

      it('should save the model without effort when its effort list is empty', async () => {
        build({ stub: MODELS }, { deep: { availableEfforts: [], currentEffortId: '' } });
        await start.execute({ conversationId: 'conv-1', step: 'model' });

        await expect(submit.execute({ conversationId: 'conv-1', input: '2' })).resolves.toMatchObject({
          kind: 'configured',
          settings: { modelId: 'deep', effortId: null },
        });
      });

      it('should probe efforts on the agent that owns the selection', async () => {
        settingsStore.settings = settingsOf({ agentId: 'other', agentName: 'Other Agent' });
        await start.execute({ conversationId: 'conv-2', step: 'model' });
        factory.createdAgentIds.length = 0;

        await submit.execute({ conversationId: 'conv-2', input: '1' });

        expect(factory.createdAgentIds).toEqual(['other']);
        expect(settingsStore.saved.at(-1)).toMatchObject({ agentId: 'other', modelId: 'opus' });
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
            agentId: 'stub',
            agentName: 'Stub Agent',
            modelId: 'deep',
            effortId: 'low',
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
            agentId: 'other',
            agentName: 'Other Agent',
            modelId: null,
            modelName: null,
            effortId: null,
            effortName: null,
            updatedAt: expect.any(String),
          },
          pendingPrompt: 'Go',
        });
        await expect(selectionStore.find('ch-2')).resolves.toBeNull();
        expect(settingsStore.settings?.agentId).toBe('other');
      });
    });

    it('should fail when there is no selection in progress', async () => {
      await expect(submit.execute({ conversationId: 'other', input: '1' })).rejects.toThrow(
        'No agent configuration selection in progress.',
      );
    });
  });

  describe('ResolveConversationInputUseCase', () => {
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
        configured: expect.objectContaining({ agentId: 'stub', modelId: 'deep', effortId: 'low' }),
      });
    });

    it('should return configured when the selection had no pending prompt', async () => {
      await start.execute({ conversationId: 'conv-1', step: 'model' });

      await expect(resolve.execute({ conversationId: 'conv-1', prompt: '1' })).resolves.toEqual({
        kind: 'configured',
        settings: expect.objectContaining({ modelId: 'fast' }),
      });
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
        agentId: 'other',
        agentName: 'Other Agent',
        modelId: 'opus',
        modelName: 'Opus',
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
