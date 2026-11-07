import { ConversationEntryService } from '../services/conversation-entry.service.js';
import { createWebHarness } from '../testing/web-harness.js';

import { CancelConversationTurnUseCase } from './cancel-conversation-turn.use-case.js';


describe('CancelConversationTurnUseCase', () => {
  it('stays silent when a turn was cancelled', async () => {
    const { agentTurn, events, store } = createWebHarness();
    store.seed('web-1');

    await new CancelConversationTurnUseCase(agentTurn, events, new ConversationEntryService()).execute('web-1');

    expect(agentTurn.cancelledConversations).toEqual(['web-1']);
    expect(store.histories.get('web-1')).toEqual([]);
  });

  it('tells the user when there was nothing to cancel', async () => {
    const { agentTurn, events, store } = createWebHarness();
    store.seed('web-1');
    agentTurn.cancelResult = false;

    await new CancelConversationTurnUseCase(agentTurn, events, new ConversationEntryService()).execute('web-1');

    expect(store.histories.get('web-1')).toEqual([expect.objectContaining({ type: 'notice', text: 'There is no running task to cancel.' })]);
  });
});
