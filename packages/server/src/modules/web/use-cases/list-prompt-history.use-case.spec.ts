import { FakePromptHistory } from '../testing/fake-prompt-history.js';

import { ListPromptHistoryUseCase } from './list-prompt-history.use-case.js';


describe('ListPromptHistoryUseCase', () => {
  it('returns the stored prompts, most recent first', async () => {
    const history = new FakePromptHistory();
    await history.append('older');
    await history.append('latest');

    expect(await new ListPromptHistoryUseCase(history).execute()).toEqual(['latest', 'older']);
  });
});
