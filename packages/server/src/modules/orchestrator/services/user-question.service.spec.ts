import { beforeEach, describe, expect, it } from 'vitest';

import { UserQuestionQueueService } from './user-question-queue.service.js';
import { UserQuestionService } from './user-question.service.js';


const ASKER = { role: 'CEO', roleName: 'CEO', projectName: null };

describe('UserQuestionService', () => {
  let queue: UserQuestionQueueService;
  let service: UserQuestionService;

  beforeEach(() => {
    queue = new UserQuestionQueueService();
    service = new UserQuestionService(queue);
  });

  it('should report whether the conversation has questions waiting for the user', () => {
    expect(service.hasPendingQuestions('conv-1')).toBe(false);

    void queue.ask('conv-1', ASKER, '', [{ text: 'Which?', options: [] }]);

    expect(service.hasPendingQuestions('conv-1')).toBe(true);
  });

  it('should expose the open question and take structured answers', async () => {
    const answers = queue.ask('conv-1', ASKER, '', [{ text: 'Which?', options: ['A', 'B'] }]);

    expect(service.currentQuestion('conv-1')?.question.text).toBe('Which?');
    expect(service.answerQuestion('conv-1', { kind: 'option', optionIndex: 2 })).toMatchObject({ kind: 'answered' });
    await expect(answers).resolves.toEqual([{ question: { text: 'Which?', options: ['A', 'B'] }, answer: 'B', optionNumber: 2 }]);
  });

  it('should have nothing to answer without a question', () => {
    expect(service.currentQuestion('conv-1')).toBeUndefined();
    expect(service.answerQuestion('conv-1', { kind: 'text', text: 'x' })).toBeUndefined();
  });
});
