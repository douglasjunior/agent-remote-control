import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';

import { FakeClientConnection } from '../testing/fake-client-connection.js';
import { FakeConversationStore } from '../testing/fake-conversation-store.js';
import { createWebHarness } from '../testing/web-harness.js';

import { WebConnectionRegistryService } from './web-connection-registry.service.js';
import { WebConversationEventsService } from './web-conversation-events.service.js';


const entry: ConversationEntry = { id: 'e1', at: '2026-01-01T00:00:00.000Z', type: 'interim', text: 'x' };

describe('WebConversationEventsService', () => {
  it('persists an entry and broadcasts it', async () => {
    const { events, store, observer } = createWebHarness();
    store.seed('web-1');

    await events.publishEntry('web-1', entry);

    expect(observer.sent).toEqual([{ type: 'conversation.entry', conversationId: 'web-1', entry }]);
    expect(await store.history('web-1')).toEqual([entry]);
  });

  it('still broadcasts when the store fails', async () => {
    const registry = new WebConnectionRegistryService();
    const observer = new FakeClientConnection('observer');
    registry.register(observer);
    const store = new FakeConversationStore();
    vi.spyOn(store, 'upsertEntry').mockRejectedValue(new Error('disk full'));
    const events = new WebConversationEventsService(store, registry);

    await expect(events.publishEntry('web-1', entry)).resolves.toBeUndefined();

    expect(observer.sent).toHaveLength(1);
  });

  it('tracks and broadcasts the state, defaulting to idle', () => {
    const { events, observer } = createWebHarness();

    expect(events.stateOf('web-1')).toBe('idle');
    events.publishState('web-1', 'running');

    expect(events.stateOf('web-1')).toBe('running');
    expect(observer.sent).toEqual([{ type: 'conversation.state', conversationId: 'web-1', state: 'running' }]);
  });

  it('broadcasts conversation updates except to the excluded connection', () => {
    const { events, registry, observer } = createWebHarness();
    const requester = new FakeClientConnection('requester');
    registry.register(requester);
    const conversation = { id: 'web-1', title: 'T', createdAt: entry.at, updatedAt: entry.at };

    events.publishConversation(conversation, 'requester');

    expect(observer.sent).toEqual([{ type: 'conversation.updated', conversation }]);
    expect(requester.sent).toEqual([]);
  });

  it('broadcasts the profiles of a conversation', () => {
    const { events, observer } = createWebHarness();

    events.publishProfiles('web-1', true, [{ role: 'CEO', roleName: 'CEO' }]);

    expect(observer.sent).toEqual([{ type: 'profiles', conversationId: 'web-1', configured: true, profiles: [{ role: 'CEO', roleName: 'CEO' }] }]);
  });
});
