import { beforeEach, describe, expect, it } from 'vitest';

import type { AgentEffortState, AgentModelState } from '../../agent/ports/agent.port.js';
import { InMemoryAgentConfigSelectionStoreAdapter } from '../adapters/in-memory-agent-config-selection-store.adapter.js';
import { createAgentCapabilities } from '../testing/stub-agent-capabilities.js';
import { StubAgentSettingsStore } from '../testing/stub-agent-settings-store.js';

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

const DEEP_EFFORTS: AgentEffortState = {
  availableEfforts: [
    { effortId: 'low', name: 'Low' },
    { effortId: 'high', name: 'High', description: 'Thorough' },
  ],
  currentEffortId: 'low',
};

describe('agent configuration selection', () => {
  let selectionStore: InMemoryAgentConfigSelectionStoreAdapter;
  let settingsStore: StubAgentSettingsStore;
  let start: StartAgentConfigSelectionUseCase;
  let submit: SubmitAgentConfigSelectionUseCase;
  let resolve: ResolveConversationInputUseCase;
  let cancel: CancelAgentConfigSelectionUseCase;

  const build = (models: AgentModelState | null, efforts: Record<string, AgentEffortState | null> = {}) => {
    const capabilities = createAgentCapabilities(models, efforts);
    start = new StartAgentConfigSelectionUseCase(capabilities, selectionStore);
    submit = new SubmitAgentConfigSelectionUseCase(capabilities, selectionStore, settingsStore);
    resolve = new ResolveConversationInputUseCase(selectionStore, settingsStore, start, submit);
    cancel = new CancelAgentConfigSelectionUseCase(selectionStore);
  };

  beforeEach(() => {
    selectionStore = new InMemoryAgentConfigSelectionStoreAdapter();
    settingsStore = new StubAgentSettingsStore();
    build(MODELS, { deep: DEEP_EFFORTS, fast: null });
  });

  describe('StartAgentConfigSelectionUseCase', () => {
    it('should list the models as numbered options', async () => {
      const result = await start.execute({ channelId: 'ch-1', threadId: 'th-1' });

      expect(result).toEqual({
        kind: 'selection',
        selection: {
          channelId: 'ch-1',
          threadId: 'th-1',
          step: 'model',
          options: [
            { index: 1, id: 'fast', label: 'Fast Model', description: 'Quick answers' },
            { index: 2, id: 'deep', label: 'Deep Model', description: undefined },
          ],
          pendingPrompt: undefined,
        },
      });
      await expect(selectionStore.find('ch-1', 'th-1')).resolves.not.toBeNull();
    });

    it.each([
      ['no model option', null],
      ['an empty model list', { availableModels: [], currentModelId: '' }],
    ])('should be unavailable when the agent exposes %s', async (_label, models) => {
      build(models);

      await expect(start.execute({ channelId: 'ch-1' })).resolves.toEqual({ kind: 'unavailable' });
      await expect(selectionStore.find('ch-1')).resolves.toBeNull();
    });
  });

  describe('SubmitAgentConfigSelectionUseCase', () => {
    beforeEach(async () => {
      await start.execute({ channelId: 'ch-1' });
    });

    it.each(['abc', '0', '3', '1.5', ''])('should reject %j without changing the state', async (input) => {
      const before = await selectionStore.find('ch-1');

      const outcome = await submit.execute({ channelId: 'ch-1', input });

      expect(outcome).toEqual({ kind: 'invalid', selection: before });
      await expect(selectionStore.find('ch-1')).resolves.toEqual(before);
      expect(settingsStore.saved).toHaveLength(0);
    });

    it('should advance to the effort step and then save the settings', async () => {
      const effortStep = await submit.execute({ channelId: 'ch-1', input: ' 2 ' });

      expect(effortStep).toEqual({
        kind: 'selection',
        selection: expect.objectContaining({
          step: 'effort',
          selectedModel: { id: 'deep', name: 'Deep Model' },
          options: [
            { index: 1, id: 'low', label: 'Low', description: undefined },
            { index: 2, id: 'high', label: 'High', description: 'Thorough' },
          ],
        }),
      });

      const configured = await submit.execute({ channelId: 'ch-1', input: '2' });

      expect(configured).toEqual({
        kind: 'configured',
        settings: {
          modelId: 'deep',
          modelName: 'Deep Model',
          effortId: 'high',
          effortName: 'High',
          updatedAt: expect.any(String),
        },
        pendingPrompt: undefined,
      });
      expect(settingsStore.settings?.modelId).toBe('deep');
      await expect(selectionStore.find('ch-1')).resolves.toBeNull();
    });

    it('should save the model without effort when it has no effort options', async () => {
      const outcome = await submit.execute({ channelId: 'ch-1', input: '1' });

      expect(outcome).toMatchObject({
        kind: 'configured',
        settings: { modelId: 'fast', effortId: null, effortName: null },
      });
    });

    it('should save the model without effort when its effort list is empty', async () => {
      build(MODELS, { deep: { availableEfforts: [], currentEffortId: '' } });

      await expect(submit.execute({ channelId: 'ch-1', input: '2' })).resolves.toMatchObject({
        kind: 'configured',
        settings: { modelId: 'deep', effortId: null },
      });
    });

    it('should fail when there is no selection in progress', async () => {
      await expect(submit.execute({ channelId: 'other', input: '1' })).rejects.toThrow(
        'No agent configuration selection in progress.',
      );
    });
  });

  describe('ResolveConversationInputUseCase', () => {
    it('should start a selection keeping the prompt when there are no settings', async () => {
      const resolution = await resolve.execute({ channelId: 'ch-1', threadId: 'th-1', prompt: 'Build it' });

      expect(resolution).toMatchObject({ kind: 'selection', selection: { pendingPrompt: 'Build it' } });
    });

    it('should execute the pending prompt once the selection is configured', async () => {
      await resolve.execute({ channelId: 'ch-1', prompt: 'Build it' });

      await expect(resolve.execute({ channelId: 'ch-1', prompt: 'nope' })).resolves.toMatchObject({
        kind: 'invalid',
      });
      await expect(resolve.execute({ channelId: 'ch-1', prompt: '2' })).resolves.toMatchObject({
        kind: 'selection',
      });
      const resolution = await resolve.execute({ channelId: 'ch-1', prompt: '1' });

      expect(resolution).toEqual({
        kind: 'execute',
        prompt: 'Build it',
        configured: expect.objectContaining({ modelId: 'deep', effortId: 'low' }),
      });
    });

    it('should return configured when the selection had no pending prompt', async () => {
      await start.execute({ channelId: 'ch-1' });

      await expect(resolve.execute({ channelId: 'ch-1', prompt: '1' })).resolves.toEqual({
        kind: 'configured',
        settings: expect.objectContaining({ modelId: 'fast' }),
      });
    });

    it('should execute directly when settings already exist', async () => {
      settingsStore.settings = {
        modelId: 'fast',
        modelName: 'Fast Model',
        effortId: null,
        effortName: null,
        updatedAt: '',
      };

      await expect(resolve.execute({ channelId: 'ch-1', prompt: 'Hi' })).resolves.toEqual({
        kind: 'execute',
        prompt: 'Hi',
      });
    });

    it('should execute directly when the agent exposes no models', async () => {
      build(null);

      await expect(resolve.execute({ channelId: 'ch-1', prompt: 'Hi' })).resolves.toEqual({
        kind: 'execute',
        prompt: 'Hi',
      });
    });
  });

  describe('CancelAgentConfigSelectionUseCase', () => {
    it('should remove an active selection and report it', async () => {
      await start.execute({ channelId: 'ch-1' });

      await expect(cancel.execute('ch-1')).resolves.toBe(true);
      await expect(cancel.execute('ch-1')).resolves.toBe(false);
    });
  });
});
