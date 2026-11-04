import { createWebHarness } from '../testing/web-harness.js';

import { CreateConversationUseCase } from './create-conversation.use-case.js';
import { GetConversationHistoryUseCase } from './get-conversation-history.use-case.js';
import { ListConversationsUseCase } from './list-conversations.use-case.js';


describe('conversation query use cases', () => {
  it('creates and lists conversations through the store', async () => {
    const { store } = createWebHarness();

    const created = await new CreateConversationUseCase(store).execute();

    expect(await new ListConversationsUseCase(store).execute()).toEqual([created]);
  });

  it('returns the history with the current state', async () => {
    const { store, events } = createWebHarness();
    store.seed('web-1');
    const entry = { id: 'e', at: '2026-01-01T00:00:00.000Z', type: 'interim' as const, text: 'x' };
    await store.upsertEntry('web-1', entry);
    events.publishState('web-1', 'running');
    events.publishDraft('web-1', 'Working on');

    expect(await new GetConversationHistoryUseCase(store, events).execute('web-1')).toEqual({
      entries: [entry],
      state: 'running',
      draft: 'Working on',
    });
  });
});
