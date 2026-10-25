import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PromptCancelledError } from '../../agent/ports/agent.port.js';
import type { QuestionAsker, UserQuestion } from '../models/user-question.model.js';

import { UserQuestionQueueService } from './user-question-queue.service.js';


const OWNER: QuestionAsker = { role: 'PRODUCT_OWNER', roleName: 'Product Owner', projectName: null };
const LEAD: QuestionAsker = { role: 'TECH_LEAD', roleName: 'Tech Lead', projectName: 'my-app' };
const CHOICE: UserQuestion = { text: 'Who approves?', rationale: 'Defines the flow.', options: ['Manager', 'Finance'] };
const OPEN: UserQuestion = { text: 'What is the limit?', options: [] };

describe('UserQuestionQueueService', () => {
  let queue: UserQuestionQueueService;

  beforeEach(() => {
    queue = new UserQuestionQueueService();
  });

  it('should show the first question with the agent message when the request reaches an empty queue', () => {
    const notify = vi.fn();

    void queue.ask('conv-1', OWNER, 'I understood X.', [CHOICE, OPEN], notify);

    const prompt = { asker: OWNER, question: CHOICE, number: 1, total: 2, message: 'I understood X.', waitingAskers: 0 };
    expect(notify).toHaveBeenCalledWith(prompt);
    expect(queue.current('conv-1')).toEqual(prompt);
    expect(queue.hasPending('conv-1')).toBe(true);
    expect(queue.isWaiting('conv-1', 'PRODUCT_OWNER', null)).toBe(true);
    expect(queue.isWaiting('conv-1', 'PRODUCT_OWNER', 'my-app')).toBe(false);
  });

  it('should leave the message out of the first question when the agent wrote none', () => {
    void queue.ask('conv-1', OWNER, '', [OPEN]);

    expect(queue.current('conv-1')).toEqual({ asker: OWNER, question: OPEN, number: 1, total: 1, waitingAskers: 0 });
  });

  it('should answer one question at a time, picking options by number and keeping any other text as the answer', async () => {
    const answers = queue.ask('conv-1', OWNER, 'Message', [CHOICE, OPEN, CHOICE]);

    expect(queue.submit('conv-1', { text: ' 2 ' })).toEqual({
      kind: 'next',
      prompt: { asker: OWNER, question: OPEN, number: 2, total: 3, waitingAskers: 0 },
    });
    expect(queue.submit('conv-1', { text: '42' })).toMatchObject({ kind: 'next', prompt: { number: 3 } });
    expect(queue.submit('conv-1', { text: 'Only the director' })).toEqual({ kind: 'answered', asker: OWNER });

    await expect(answers).resolves.toEqual([
      { question: CHOICE, answer: 'Finance', optionNumber: 2 },
      { question: OPEN, answer: '42' },
      { question: CHOICE, answer: 'Only the director' },
    ]);
    expect(queue.hasPending('conv-1')).toBe(false);
    expect(queue.current('conv-1')).toBeUndefined();
  });

  it('should repeat the question when the number is out of range or the answer is empty', () => {
    void queue.ask('conv-1', OWNER, '', [CHOICE]);

    expect(queue.submit('conv-1', { text: '3' })).toEqual({
      kind: 'invalid',
      prompt: { asker: OWNER, question: CHOICE, number: 1, total: 1, waitingAskers: 0 },
    });
    expect(queue.submit('conv-1', { text: '0' })).toMatchObject({ kind: 'invalid' });
    expect(queue.submit('conv-1', { text: '   ' })).toMatchObject({ kind: 'invalid' });
  });

  it('should keep attached files with the answer, and take files alone as an answer', async () => {
    const file = { name: 'flow.png', path: '/tmp/flow.png', contentType: 'image/png', size: 10 };
    const answers = queue.ask('conv-1', OWNER, '', [CHOICE, OPEN]);

    queue.submit('conv-1', { text: '1', attachments: [file] });
    queue.submit('conv-1', { text: ' ', attachments: [file] });

    await expect(answers).resolves.toEqual([
      { question: CHOICE, answer: 'Manager', optionNumber: 1, attachments: [file] },
      { question: OPEN, answer: '', attachments: [file] },
    ]);
  });

  it('should return nothing when the conversation has no question waiting', () => {
    expect(queue.submit('conv-1', { text: '1' })).toBeUndefined();
  });

  it('should queue agents in the order they asked and hand over the next one with the last answer', async () => {
    const ownerNotify = vi.fn();
    const leadNotify = vi.fn();
    const ownerAnswers = queue.ask('conv-1', OWNER, '', [OPEN], ownerNotify);
    const leadAnswers = queue.ask('conv-1', LEAD, 'Lead message', [CHOICE], leadNotify);

    expect(queue.current('conv-1')).toMatchObject({ asker: OWNER, waitingAskers: 1 });
    expect(queue.submit('conv-1', { text: 'R$ 500' })).toEqual({
      kind: 'answered',
      asker: OWNER,
      next: { asker: LEAD, question: CHOICE, number: 1, total: 1, message: 'Lead message', waitingAskers: 0 },
    });
    await expect(ownerAnswers).resolves.toEqual([{ question: OPEN, answer: 'R$ 500' }]);

    queue.submit('conv-1', { text: '1' });
    await expect(leadAnswers).resolves.toEqual([{ question: CHOICE, answer: 'Manager', optionNumber: 1 }]);
    expect(ownerNotify).toHaveBeenCalledTimes(1);
    expect(leadNotify).not.toHaveBeenCalled();
  });

  it('should keep the queues of different conversations apart', () => {
    void queue.ask('conv-1', OWNER, '', [OPEN]);

    expect(queue.hasPending('conv-2')).toBe(false);
    expect(queue.current('conv-2')).toBeUndefined();
  });

  it('should reject every waiting agent and empty the queue when cancelled', async () => {
    const first = queue.ask('conv-1', OWNER, '', [OPEN]);
    const second = queue.ask('conv-1', LEAD, '', [CHOICE]);

    expect(queue.cancel('conv-1')).toBe(true);

    await expect(first).rejects.toBeInstanceOf(PromptCancelledError);
    await expect(second).rejects.toBeInstanceOf(PromptCancelledError);
    expect(queue.hasPending('conv-1')).toBe(false);
    expect(queue.cancel('conv-1')).toBe(false);
  });

  it('should discard the request of a replaced agent and show the next one when it was on screen', async () => {
    const leadNotify = vi.fn();
    const owner = queue.ask('conv-1', OWNER, '', [OPEN]);
    void queue.ask('conv-1', LEAD, '', [CHOICE], leadNotify);

    queue.discard('conv-1', 'PRODUCT_OWNER', null);

    await expect(owner).rejects.toBeInstanceOf(PromptCancelledError);
    expect(leadNotify).toHaveBeenCalledWith({ asker: LEAD, question: CHOICE, number: 1, total: 1, waitingAskers: 0 });
  });

  it('should discard a request waiting behind another without showing anything', async () => {
    const ownerNotify = vi.fn();
    void queue.ask('conv-1', OWNER, '', [OPEN], ownerNotify);
    const lead = queue.ask('conv-1', LEAD, '', [CHOICE]);

    queue.discard('conv-1', 'TECH_LEAD', 'my-app');

    await expect(lead).rejects.toBeInstanceOf(PromptCancelledError);
    expect(ownerNotify).toHaveBeenCalledTimes(1);
    expect(queue.current('conv-1')).toMatchObject({ asker: OWNER, waitingAskers: 0 });
  });

  it('should end the queue when the last request is discarded and ignore agents that are not waiting', () => {
    void queue.ask('conv-1', OWNER, '', [OPEN]).catch(() => undefined);

    queue.discard('conv-1', 'TECH_LEAD', 'my-app');
    queue.discard('conv-2', 'PRODUCT_OWNER', null);
    expect(queue.hasPending('conv-1')).toBe(true);

    queue.discard('conv-1', 'PRODUCT_OWNER', null);
    expect(queue.hasPending('conv-1')).toBe(false);
  });
});
