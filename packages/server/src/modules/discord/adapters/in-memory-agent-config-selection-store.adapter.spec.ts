import { beforeEach, describe, expect, it } from 'vitest';

import type { AgentConfigSelection } from '../models/agent-config-selection.model.js';

import { InMemoryAgentConfigSelectionStoreAdapter } from './in-memory-agent-config-selection-store.adapter.js';


const selection = (overrides: Partial<AgentConfigSelection> = {}): AgentConfigSelection => ({
  conversationId: 'conv-1',
  step: 'model',
  options: [{ index: 1, id: 'm1', label: 'Model 1' }],
  ...overrides,
});

describe('InMemoryAgentConfigSelectionStoreAdapter', () => {
  let store: InMemoryAgentConfigSelectionStoreAdapter;

  beforeEach(() => {
    store = new InMemoryAgentConfigSelectionStoreAdapter();
  });

  it('should return null when there is no selection', async () => {
    await expect(store.find('conv-1')).resolves.toBeNull();
  });

  it('should keep channel and thread selections apart', async () => {
    await store.save(selection());
    await store.save(selection({ conversationId: 'conv-th-1', step: 'effort' }));

    expect((await store.find('conv-1'))?.step).toBe('model');
    expect((await store.find('conv-th-1'))?.step).toBe('effort');
  });

  it('should report whether a selection was removed', async () => {
    await store.save(selection({ conversationId: 'conv-th-1' }));

    await expect(store.remove('conv-th-1')).resolves.toBe(true);
    await expect(store.remove('conv-th-1')).resolves.toBe(false);
    await expect(store.find('conv-th-1')).resolves.toBeNull();
  });
});
