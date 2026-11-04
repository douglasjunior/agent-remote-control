import type { QuestionPrompt } from '../../orchestrator/models/user-question.model.js';
import { createWebHarness } from '../testing/web-harness.js';

import { AnswerConversationQuestionUseCase } from './answer-conversation-question.use-case.js';


const asker = { role: 'DEVELOPER', roleName: 'Developer', projectName: null };
const prompt: QuestionPrompt = { asker, question: { text: 'Which?', options: ['a', 'b'] }, number: 1, total: 1, waitingAskers: 0 };

function setup() {
  const harness = createWebHarness();
  harness.store.seed('web-1');
  const useCase = new AnswerConversationQuestionUseCase(harness.questions, harness.events);
  return { ...harness, useCase, types: () => (harness.store.histories.get('web-1') ?? []).map(entry => entry.type) };
}

describe('AnswerConversationQuestionUseCase', () => {
  it('does nothing when no question is waiting', async () => {
    const { useCase, questions, types } = setup();

    await expect(useCase.execute('web-1', { kind: 'option', optionIndex: 1 })).resolves.toBe(false);

    expect(questions.answers).toEqual([{ conversationId: 'web-1', answer: { kind: 'option', optionIndex: 1 } }]);
    expect(types()).toEqual([]);
  });

  it('passes an option answer to the orchestrator and confirms it without an echo', async () => {
    const { useCase, questions, types } = setup();
    questions.submission = { kind: 'answered', asker };

    await expect(useCase.execute('web-1', { kind: 'option', optionIndex: 2 })).resolves.toBe(true);

    expect(questions.answers[0]?.answer).toEqual({ kind: 'option', optionIndex: 2 });
    expect(types()).toEqual(['notice']);
  });

  it('echoes a text answer as a user message before the confirmation', async () => {
    const { useCase, questions, types } = setup();
    questions.submission = { kind: 'next', prompt };

    await expect(useCase.execute('web-1', { kind: 'text', text: 'use Postgres' })).resolves.toBe(true);

    expect(questions.answers[0]?.answer).toEqual({ kind: 'text', text: 'use Postgres' });
    expect(types()).toEqual(['user_message', 'question']);
  });
});
