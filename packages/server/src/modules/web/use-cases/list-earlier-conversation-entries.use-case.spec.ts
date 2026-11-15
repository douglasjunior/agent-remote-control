import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';

import { HISTORY_PAGE_SIZE } from '../constants/history-page.constant.js';
import { createWebHarness } from '../testing/web-harness.js';

import { ListEarlierConversationEntriesUseCase } from './list-earlier-conversation-entries.use-case.js';


const at = '2026-01-01T00:00:00.000Z';
const user = (index: number): ConversationEntry => ({ id: `u${index}`, at, type: 'user_message', text: `${index}` });
const answer = (index: number): ConversationEntry => ({ id: `r${index}`, at, type: 'agent_response', status: 'completed', response: `${index}` });

describe('ListEarlierConversationEntriesUseCase', () => {
  it('should return the whole turns before the position that fit a page, with the position of the first', async () => {
    const { store, events } = createWebHarness();
    store.seed('web-1');
    const turns = HISTORY_PAGE_SIZE;
    for (let index = 0; index < turns; index += 1) {
      await store.upsertEntry('web-1', user(index));
      await store.upsertEntry('web-1', answer(index));
    }

    const { entries, start } = await new ListEarlierConversationEntriesUseCase(store, events).execute('web-1', turns * 2);

    expect(start).toBe(turns * 2 - HISTORY_PAGE_SIZE);
    expect(entries).toHaveLength(HISTORY_PAGE_SIZE);
    expect(entries[0]).toEqual(user(turns - HISTORY_PAGE_SIZE / 2));
  });

  it('should keep a running delegation whole across the turns it spans', async () => {
    const { store, events } = createWebHarness();
    store.seed('web-1');
    await events.publishEntry('web-1', user(0));
    await events.publishEntry('web-1', {
      id: 'd', at, type: 'delegation', delegationId: 'd', phase: 'started', round: 1, role: 'DEVELOPER', roleName: 'Developer', prompt: '', summary: '',
    });
    for (let index = 1; index <= HISTORY_PAGE_SIZE; index += 1) {
      await events.publishEntry('web-1', user(index));
    }

    const { start } = await new ListEarlierConversationEntriesUseCase(store, events).execute('web-1', HISTORY_PAGE_SIZE + 2);

    expect(start).toBe(0);
  });
});
