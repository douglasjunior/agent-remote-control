import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PromptCancelledError } from '../../agent/ports/agent.port.js';
import type { QuestionAsker, UserQuestion } from '../models/user-question.model.js';
import { questionListener } from '../testing/question-listener.fixture.js';

import { UserQuestionQueueService } from './user-question-queue.service.js';


const OWNER: QuestionAsker = { role: 'PRODUCT_OWNER', roleName: 'Product Owner', projectName: null };
const LEAD: QuestionAsker = { role: 'TECH_LEAD', roleName: 'Tech Lead', projectName: 'my-app' };
const CHOICE: UserQuestion = { text: 'Who approves?', rationale: 'Defines the flow.', options: ['Manager', 'Finance'] };
const OPEN: UserQuestion = { text: 'What is the limit?', options: [] };

describe('UserQuestionQueueService', () => {
  let queue: UserQuestionQueueService;
  let timeoutMs: number;

  beforeEach(() => {
    timeoutMs = 0;
    queue = new UserQuestionQueueService({ getTimeoutMs: () => timeoutMs });
  });

  it('should show the first question with the agent message when the request reaches an empty queue', () => {
    const notify = vi.fn();

    void queue.ask('conv-1', OWNER, 'I understood X.', [CHOICE, OPEN], questionListener({ asked: notify }));

    const prompt = { asker: OWNER, question: CHOICE, number: 1, total: 2, message: 'I understood X.', waitingAskers: 0 };
    expect(notify).toHaveBeenCalledWith(prompt);
    expect(queue.current('conv-1')).toEqual(prompt);
    expect(queue.hasPending('conv-1')).toBe(true);
    expect(queue.isWaiting('conv-1', 'PRODUCT_OWNER', null)).toBe(true);
    expect(queue.isWaiting('conv-1', 'PRODUCT_OWNER', 'my-app')).toBe(false);
  });

  it('should leave the message out of the first question when the agent wrote none', () => {
    void queue.ask('conv-1', OWNER, '', [OPEN], questionListener());

    expect(queue.current('conv-1')).toEqual({ asker: OWNER, question: OPEN, number: 1, total: 1, waitingAskers: 0 });
  });

  it('should answer one question at a time, picking options by index and keeping text as the answer', async () => {
    const answers = queue.ask('conv-1', OWNER, 'Message', [CHOICE, OPEN, CHOICE], questionListener());

    expect(queue.submit('conv-1', { kind: 'option', optionIndex: 2 })).toEqual({
      kind: 'next',
      prompt: { asker: OWNER, question: OPEN, number: 2, total: 3, waitingAskers: 0 },
    });
    expect(queue.submit('conv-1', { kind: 'text', text: '42' })).toMatchObject({ kind: 'next', prompt: { number: 3 } });
    expect(queue.submit('conv-1', { kind: 'text', text: 'Only the director' })).toEqual({ kind: 'answered', asker: OWNER });

    await expect(answers).resolves.toEqual([
      { question: CHOICE, answer: 'Finance', optionNumber: 2 },
      { question: OPEN, answer: '42' },
      { question: CHOICE, answer: 'Only the director' },
    ]);
    expect(queue.hasPending('conv-1')).toBe(false);
    expect(queue.current('conv-1')).toBeUndefined();
  });

  it('should repeat the question when the option is out of range or the answer is empty', () => {
    void queue.ask('conv-1', OWNER, '', [CHOICE], questionListener());

    expect(queue.submit('conv-1', { kind: 'option', optionIndex: 3 })).toEqual({
      kind: 'invalid',
      prompt: { asker: OWNER, question: CHOICE, number: 1, total: 1, waitingAskers: 0 },
    });
    expect(queue.submit('conv-1', { kind: 'option', optionIndex: 0 })).toMatchObject({ kind: 'invalid' });
    expect(queue.submit('conv-1', { kind: 'text', text: '   ' })).toMatchObject({ kind: 'invalid' });
  });

  it('should keep attached files with the answer, and take files alone as an answer', async () => {
    const file = { name: 'flow.png', path: '/tmp/flow.png', contentType: 'image/png', size: 10 };
    const answers = queue.ask('conv-1', OWNER, '', [CHOICE, OPEN], questionListener());

    queue.submit('conv-1', { kind: 'option', optionIndex: 1, attachments: [file] });
    queue.submit('conv-1', { kind: 'text', text: ' ', attachments: [file] });

    await expect(answers).resolves.toEqual([
      { question: CHOICE, answer: 'Manager', optionNumber: 1, attachments: [file] },
      { question: OPEN, answer: '', attachments: [file] },
    ]);
  });

  it('should return nothing when the conversation has no question waiting', () => {
    expect(queue.submit('conv-1', { kind: 'option', optionIndex: 1 })).toBeUndefined();
  });

  it('should queue agents in the order they asked and hand over the next one with the last answer', async () => {
    const ownerNotify = vi.fn();
    const leadNotify = vi.fn();
    const ownerAnswers = queue.ask('conv-1', OWNER, '', [OPEN], questionListener({ asked: ownerNotify }));
    const leadAnswers = queue.ask('conv-1', LEAD, 'Lead message', [CHOICE], questionListener({ asked: leadNotify }));

    expect(queue.current('conv-1')).toMatchObject({ asker: OWNER, waitingAskers: 1 });
    expect(queue.submit('conv-1', { kind: 'text', text: 'R$ 500' })).toEqual({
      kind: 'answered',
      asker: OWNER,
      next: { asker: LEAD, question: CHOICE, number: 1, total: 1, message: 'Lead message', waitingAskers: 0 },
    });
    await expect(ownerAnswers).resolves.toEqual([{ question: OPEN, answer: 'R$ 500' }]);

    queue.submit('conv-1', { kind: 'option', optionIndex: 1 });
    await expect(leadAnswers).resolves.toEqual([{ question: CHOICE, answer: 'Manager', optionNumber: 1 }]);
    expect(ownerNotify).toHaveBeenCalledTimes(1);
    expect(leadNotify).not.toHaveBeenCalled();
  });

  it('should keep the queues of different conversations apart', () => {
    void queue.ask('conv-1', OWNER, '', [OPEN], questionListener());

    expect(queue.hasPending('conv-2')).toBe(false);
    expect(queue.current('conv-2')).toBeUndefined();
  });

  it('should reject every waiting agent and empty the queue when cancelled', async () => {
    const first = queue.ask('conv-1', OWNER, '', [OPEN], questionListener());
    const second = queue.ask('conv-1', LEAD, '', [CHOICE], questionListener());

    expect(queue.cancel('conv-1')).toBe(true);

    await expect(first).rejects.toBeInstanceOf(PromptCancelledError);
    await expect(second).rejects.toBeInstanceOf(PromptCancelledError);
    expect(queue.hasPending('conv-1')).toBe(false);
    expect(queue.cancel('conv-1')).toBe(false);
  });

  it('should discard the request of a replaced agent and show the next one when it was on screen', async () => {
    const leadNotify = vi.fn();
    const owner = queue.ask('conv-1', OWNER, '', [OPEN], questionListener());
    void queue.ask('conv-1', LEAD, '', [CHOICE], questionListener({ asked: leadNotify }));

    queue.discard('conv-1', 'PRODUCT_OWNER', null);

    await expect(owner).rejects.toBeInstanceOf(PromptCancelledError);
    expect(leadNotify).toHaveBeenCalledWith({ asker: LEAD, question: CHOICE, number: 1, total: 1, waitingAskers: 0 });
  });

  it('should discard a request waiting behind another without showing anything', async () => {
    const ownerNotify = vi.fn();
    void queue.ask('conv-1', OWNER, '', [OPEN], questionListener({ asked: ownerNotify }));
    const lead = queue.ask('conv-1', LEAD, '', [CHOICE], questionListener());

    queue.discard('conv-1', 'TECH_LEAD', 'my-app');

    await expect(lead).rejects.toBeInstanceOf(PromptCancelledError);
    expect(ownerNotify).toHaveBeenCalledTimes(1);
    expect(queue.current('conv-1')).toMatchObject({ asker: OWNER, waitingAskers: 0 });
  });

  it('should end the queue when the last request is discarded and ignore agents that are not waiting', () => {
    void queue.ask('conv-1', OWNER, '', [OPEN], questionListener()).catch(() => undefined);

    queue.discard('conv-1', 'TECH_LEAD', 'my-app');
    queue.discard('conv-2', 'PRODUCT_OWNER', null);
    expect(queue.hasPending('conv-1')).toBe(true);

    queue.discard('conv-1', 'PRODUCT_OWNER', null);
    expect(queue.hasPending('conv-1')).toBe(false);
  });

  describe('timeout', () => {
    const RECOMMENDED: UserQuestion = { text: 'Which database?', options: ['SQLite', 'Postgres'], recommendedIndex: 2 };

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
      timeoutMs = 60_000;
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should expose when the question at the front times out', () => {
      void queue.ask('conv-1', OWNER, '', [RECOMMENDED], questionListener());

      expect(queue.current('conv-1')).toMatchObject({ timeout: { expiresAt: 1_060_000, durationMs: 60_000 } });
    });

    it('should answer with the recommended option once the timeout passes and report it', async () => {
      const timedOut = vi.fn();
      const answers = queue.ask('conv-1', OWNER, '', [RECOMMENDED], questionListener({ timedOut }));

      vi.advanceTimersByTime(60_000);

      const answered = { question: RECOMMENDED, answer: 'Postgres', optionNumber: 2, timedOut: true };
      await expect(answers).resolves.toEqual([answered]);
      expect(timedOut).toHaveBeenCalledWith({ asker: OWNER, answered, timeoutMs: 60_000 });
      expect(queue.hasPending('conv-1')).toBe(false);
    });

    it('should answer with nothing when the question has no recommended option', async () => {
      const answers = queue.ask('conv-1', OWNER, '', [OPEN, CHOICE], questionListener());

      vi.advanceTimersByTime(60_000);
      vi.advanceTimersByTime(60_000);

      await expect(answers).resolves.toEqual([
        { question: OPEN, answer: '', timedOut: true },
        { question: CHOICE, answer: '', timedOut: true },
      ]);
    });

    it('should restart the countdown for each question of a request and report the next one', () => {
      const timedOut = vi.fn();
      void queue.ask('conv-1', OWNER, '', [RECOMMENDED, OPEN], questionListener({ timedOut }));

      vi.advanceTimersByTime(60_000);

      expect(timedOut).toHaveBeenCalledWith(expect.objectContaining({
        next: { asker: OWNER, question: OPEN, number: 2, total: 2, waitingAskers: 0, timeout: { expiresAt: 1_120_000, durationMs: 60_000 } },
      }));
    });

    it('should hand the countdown to the next request when the first one times out', () => {
      const leadTimedOut = vi.fn();
      void queue.ask('conv-1', OWNER, '', [RECOMMENDED], questionListener());
      void queue.ask('conv-1', LEAD, '', [RECOMMENDED], questionListener({ timedOut: leadTimedOut }));
      const timedOut = vi.fn();
      void queue.ask('conv-1', OWNER, '', [OPEN], questionListener({ timedOut }));

      vi.advanceTimersByTime(60_000);
      expect(queue.current('conv-1')).toMatchObject({ asker: LEAD, timeout: { expiresAt: 1_120_000, durationMs: 60_000 } });

      vi.advanceTimersByTime(60_000);
      expect(leadTimedOut).toHaveBeenCalledWith(expect.objectContaining({ next: expect.objectContaining({ asker: OWNER }) }));
    });

    it('should stop the countdown when the user answers', async () => {
      const timedOut = vi.fn();
      const answers = queue.ask('conv-1', OWNER, '', [RECOMMENDED], questionListener({ timedOut }));

      queue.submit('conv-1', { kind: 'option', optionIndex: 1 });
      vi.advanceTimersByTime(120_000);

      await expect(answers).resolves.toEqual([{ question: RECOMMENDED, answer: 'SQLite', optionNumber: 1 }]);
      expect(timedOut).not.toHaveBeenCalled();
    });

    it('should restart the countdown when the user answers the first of several questions', () => {
      void queue.ask('conv-1', OWNER, '', [RECOMMENDED, OPEN], questionListener());
      vi.advanceTimersByTime(30_000);

      queue.submit('conv-1', { kind: 'option', optionIndex: 1 });

      expect(queue.current('conv-1')).toMatchObject({ number: 2, timeout: { expiresAt: 1_090_000, durationMs: 60_000 } });
    });

    it('should keep the countdown after an invalid answer', () => {
      void queue.ask('conv-1', OWNER, '', [RECOMMENDED], questionListener());

      queue.submit('conv-1', { kind: 'option', optionIndex: 9 });

      expect(queue.current('conv-1')).toMatchObject({ timeout: { expiresAt: 1_060_000, durationMs: 60_000 } });
    });

    it('should stop the countdown of a cancelled or discarded request', async () => {
      const timedOut = vi.fn();
      const cancelled = queue.ask('conv-1', OWNER, '', [RECOMMENDED], questionListener({ timedOut }));
      const discarded = queue.ask('conv-2', LEAD, '', [RECOMMENDED], questionListener({ timedOut }));

      queue.cancel('conv-1');
      queue.discard('conv-2', 'TECH_LEAD', 'my-app');
      vi.advanceTimersByTime(120_000);

      await expect(cancelled).rejects.toBeInstanceOf(PromptCancelledError);
      await expect(discarded).rejects.toBeInstanceOf(PromptCancelledError);
      expect(timedOut).not.toHaveBeenCalled();
    });

    it('should not count down for a request restored after a restart', () => {
      queue.restore('conv-1', 'work-1', OWNER, { message: '', questions: [RECOMMENDED], answers: [] }, vi.fn());

      vi.advanceTimersByTime(120_000);

      expect(queue.current('conv-1')).toEqual(expect.not.objectContaining({ timeout: expect.anything() }));
      expect(queue.hasPending('conv-1')).toBe(true);
    });

    it('should never time out when the timeout is disabled', () => {
      timeoutMs = 0;
      void queue.ask('conv-1', OWNER, '', [RECOMMENDED], questionListener());

      vi.advanceTimersByTime(3_600_000);

      expect(queue.hasPending('conv-1')).toBe(true);
      expect(queue.current('conv-1')).toEqual(expect.not.objectContaining({ timeout: expect.anything() }));
    });
  });
});
