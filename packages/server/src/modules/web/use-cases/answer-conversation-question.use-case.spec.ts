import type { QuestionPrompt } from '../../orchestrator/models/user-question.model.js';
import { ConversationEntryService } from '../services/conversation-entry.service.js';
import { WebConversationUploadsService } from '../services/web-conversation-uploads.service.js';
import { createWebHarness } from '../testing/web-harness.js';

import { AnswerConversationQuestionUseCase } from './answer-conversation-question.use-case.js';
import { ResumeConversationWorkUseCase } from './resume-conversation-work.use-case.js';


const asker = { role: 'DEVELOPER', roleName: 'Developer', projectName: null };
const prompt: QuestionPrompt = { asker, question: { text: 'Which?', options: ['a', 'b'] }, number: 1, total: 1, waitingAskers: 0 };

function setup() {
  const harness = createWebHarness();
  harness.store.seed('web-1');
  const resumeWork = new ResumeConversationWorkUseCase(harness.agentTurn, harness.workspace, harness.events, harness.turns, new ConversationEntryService());
  const useCase = new AnswerConversationQuestionUseCase(
    harness.questions,
    harness.events,
    resumeWork,
    new WebConversationUploadsService(harness.workspace, harness.uploads),
    new ConversationEntryService(),
  );
  return { ...harness, useCase, types: () => (harness.store.histories.get('web-1') ?? []).map(entry => entry.type) };
}

describe('AnswerConversationQuestionUseCase', () => {
  it('does nothing when no question is waiting', async () => {
    const { useCase, questions, types } = setup();

    await expect(useCase.execute('web-1', { kind: 'option', optionIndex: 1 })).resolves.toBe(false);

    expect(questions.answers).toEqual([{ conversationId: 'web-1', answer: { kind: 'option', optionIndex: 1 } }]);
    expect(types()).toEqual([]);
  });

  it('echoes the chosen option as a user message before the confirmation', async () => {
    const { useCase, questions, types, store } = setup();
    questions.prompt = prompt;
    questions.submission = { kind: 'answered', asker };

    await expect(useCase.execute('web-1', { kind: 'option', optionIndex: 2 })).resolves.toBe(true);

    expect(questions.answers[0]?.answer).toEqual({ kind: 'option', optionIndex: 2 });
    expect(types()).toEqual(['user_message', 'notice']);
    expect(store.histories.get('web-1')?.[0]).toMatchObject({ text: 'b' });
  });

  it('delivers the answers of a restored question, which no turn is waiting for', async () => {
    const { useCase, questions, agentTurn } = setup();
    questions.prompt = prompt;
    const restoredWork = { workId: 'w', answers: [{ question: prompt.question, answer: 'a', optionNumber: 1 }] };
    questions.submission = { kind: 'answered', asker, restoredWork };

    await useCase.execute('web-1', { kind: 'option', optionIndex: 1 });

    await vi.waitFor(() => expect(agentTurn.deliveredAnswers).toEqual([restoredWork]));
  });

  describe('with attachments', () => {
    const file = { path: '.arc-uploads/web-1/shot.png', name: 'shot.png' };

    it('hands the uploaded files to the agent and keeps them in the echo', async () => {
      const { useCase, questions, store, uploads } = setup();
      uploads.files.set(file.path, 10);
      questions.prompt = prompt;
      questions.submission = { kind: 'answered', asker };

      await useCase.execute('web-1', { kind: 'text', text: '', attachments: [file] });

      expect(questions.answers[0]?.answer).toMatchObject({ kind: 'text', text: '', attachments: [{ name: 'shot.png', contentType: 'image/png', size: 10 }] });
      expect(store.histories.get('web-1')?.[0]).toMatchObject({ type: 'user_message', attachments: [file] });
    });

    it('reports a file that is not an upload of this conversation, without answering', async () => {
      const { useCase, questions, types } = setup();
      questions.prompt = prompt;

      await expect(useCase.execute('web-1', { kind: 'text', text: 'see', attachments: [file] })).resolves.toBe(true);

      expect(questions.answers).toEqual([]);
      expect(types()).toEqual(['notice']);
    });
  });

  it('echoes nothing for an invalid option', async () => {
    const { useCase, questions, types } = setup();
    questions.prompt = prompt;
    questions.submission = { kind: 'invalid', prompt };

    await useCase.execute('web-1', { kind: 'option', optionIndex: 9 });

    expect(types()).toEqual(['notice', 'question']);
  });

  it('confirms an option without an echo when the question is unknown', async () => {
    const { useCase, questions, types } = setup();
    questions.submission = { kind: 'answered', asker };

    await useCase.execute('web-1', { kind: 'option', optionIndex: 1 });

    expect(types()).toEqual(['notice']);
  });

  it('echoes a text answer as a user message before the confirmation', async () => {
    const { useCase, questions, types } = setup();
    questions.submission = { kind: 'next', prompt };

    await expect(useCase.execute('web-1', { kind: 'text', text: 'use Postgres' })).resolves.toBe(true);

    expect(questions.answers[0]?.answer).toEqual({ kind: 'text', text: 'use Postgres' });
    expect(types()).toEqual(['user_message', 'question']);
  });

  describe('closing the open question', () => {
    const openQuestion = async (harness: ReturnType<typeof setup>) => {
      const entry = new ConversationEntryService().question(prompt);
      await harness.events.publishEntry('web-1', entry);
      return entry;
    };

    it.each([
      ['answered', { kind: 'answered', asker } as const],
      ['next', { kind: 'next', prompt } as const],
      ['invalid', { kind: 'invalid', prompt } as const],
    ])('closes it in place on a %s submission, before what follows', async (_kind, submission) => {
      const harness = setup();
      const entry = await openQuestion(harness);
      harness.questions.prompt = prompt;
      harness.questions.submission = submission;

      await harness.useCase.execute('web-1', { kind: 'option', optionIndex: 1 });

      const history = harness.store.histories.get('web-1') ?? [];
      expect(history[0]).toEqual({ ...entry, closed: true });
      expect(history.filter(item => item.type === 'question' && item.id === entry.id)).toHaveLength(1);
      expect(history.slice(1).some(item => item.type === 'question' && !item.closed)).toBe(submission.kind !== 'answered');
    });

    it('closes it with a notice when no question is waiting', async () => {
      const harness = setup();
      const entry = await openQuestion(harness);

      await expect(harness.useCase.execute('web-1', { kind: 'option', optionIndex: 1 })).resolves.toBe(false);

      expect(harness.store.histories.get('web-1')).toEqual([
        { ...entry, closed: true },
        expect.objectContaining({ id: `question-abandoned:${entry.id}`, type: 'notice', level: 'warning' }),
      ]);
    });
  });
});
