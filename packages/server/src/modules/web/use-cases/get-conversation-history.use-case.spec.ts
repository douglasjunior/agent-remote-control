import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';

import { HISTORY_PAGE_SIZE } from '../constants/history-page.constant.js';
import { ConversationEntryService } from '../services/conversation-entry.service.js';
import { createWebHarness } from '../testing/web-harness.js';

import { GetConversationHistoryUseCase } from './get-conversation-history.use-case.js';


const question: ConversationEntry = {
  id: 'q',
  at: '2026-01-01T00:00:00.000Z',
  type: 'question',
  askerRole: 'PRODUCT_OWNER',
  askerRoleName: 'Product Owner',
  text: 'Which?',
  options: ['a'],
  number: 1,
  total: 1,
  closed: false,
};

const prompt = {
  asker: { role: 'PRODUCT_OWNER', roleName: 'Product Owner', projectName: null },
  question: { text: 'Which?', options: ['a'] },
  number: 1,
  total: 1,
  waitingAskers: 0,
};
const work = { id: 'w', role: 'DEVELOPER', roleName: 'Developer', projectName: null, summary: 'Build' };

describe('GetConversationHistoryUseCase', () => {
  it('should return a question left open by an earlier process already closed, with its notice', async () => {
    const { store, events, questions, agentTurn } = createWebHarness();
    store.seed('web-1');
    await store.upsertEntry('web-1', question);

    const { entries, state } = await new GetConversationHistoryUseCase(store, events, questions, agentTurn, new ConversationEntryService()).execute('web-1');

    expect(entries).toEqual([
      { ...question, closed: true },
      expect.objectContaining({ id: 'question-abandoned:q', type: 'notice' }),
    ]);
    expect(state).toBe('idle');
  });

  it('should keep open the card of the question the queue restored', async () => {
    const { store, events, questions, agentTurn } = createWebHarness();
    store.seed('web-1');
    await store.upsertEntry('web-1', question);
    questions.prompt = prompt;
    agentTurn.interruptedWork = [work];

    const result = await new GetConversationHistoryUseCase(store, events, questions, agentTurn, new ConversationEntryService()).execute('web-1');

    expect(result.entries).toEqual([question]);
    expect(result.interrupted).toEqual([work]);
  });

  it('should show a restored question that has no card open', async () => {
    const { store, events, questions, agentTurn } = createWebHarness();
    store.seed('web-1');
    await store.upsertEntry('web-1', { ...question, closed: true });
    questions.prompt = { ...prompt, question: { text: 'Next?', options: [] }, number: 2, total: 2 };

    const { entries } = await new GetConversationHistoryUseCase(store, events, questions, agentTurn, new ConversationEntryService()).execute('web-1');

    expect(entries).toEqual([{ ...question, closed: true }, expect.objectContaining({ type: 'question', text: 'Next?', closed: false })]);
  });

  it('should return the latest page of a long history, from its position', async () => {
    const { store, events, questions, agentTurn } = createWebHarness();
    store.seed('web-1');
    for (let index = 0; index < HISTORY_PAGE_SIZE + 2; index += 1) {
      await store.upsertEntry('web-1', { id: `u${index}`, at: question.at, type: 'user_message', text: `${index}` });
    }

    const { entries, start } = await new GetConversationHistoryUseCase(store, events, questions, agentTurn, new ConversationEntryService()).execute('web-1');

    expect(start).toBe(2);
    expect(entries).toHaveLength(HISTORY_PAGE_SIZE);
    expect(entries[0]).toMatchObject({ id: 'u2' });
  });
});
