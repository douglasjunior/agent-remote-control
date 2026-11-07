import { Injectable, Logger } from '@nestjs/common';

import { PromptCancelledError } from '../../agent/ports/agent.port.js';
import type { OpenWorkQuestions } from '../models/open-work.model.js';
import type { QuestionListener } from '../models/question-event.model.js';
import type {
  AnsweredQuestion,
  QuestionAnswerInput,
  QuestionAsker,
  QuestionDeadline,
  QuestionPrompt,
  QuestionSubmission,
  UserQuestion,
} from '../models/user-question.model.js';

import { QuestionTimeoutConfigService } from './question-timeout-config.service.js';


type QuestionRequest = {
  readonly asker: QuestionAsker;
  readonly message: string;
  readonly questions: readonly UserQuestion[];
  readonly answers: AnsweredQuestion[];
  readonly listener: QuestionListener;
  /** Present on a request restored after a restart, which has no turn waiting for its answers. */
  readonly restoredWorkId?: string;
  readonly resolve: (answers: readonly AnsweredQuestion[]) => void;
  readonly reject: (error: Error) => void;
  deadline?: QuestionDeadline;
  timer?: NodeJS.Timeout;
};

/**
 * Questions agents ask the user, one at a time and in the order the agents asked them. While a conversation has
 * questions waiting, every message the user sends there is an answer.
 */
@Injectable()
export class UserQuestionQueueService {
  private readonly logger = new Logger(UserQuestionQueueService.name);
  private readonly queues = new Map<string, QuestionRequest[]>();

  constructor(private readonly timeoutConfig: QuestionTimeoutConfigService) {}

  /**
   * Resolves once the user has answered every question of this request. `listener.asked` shows the first question
   * when the request reaches the head of the queue on its own; one reached by answering the previous request is
   * shown with that answer instead. A question the user leaves unanswered for `QUESTION_TIMEOUT_MS` is answered on
   * their behalf and reported to `listener.timedOut`.
   */
  ask(
    conversationKey: string,
    asker: QuestionAsker,
    message: string,
    questions: readonly UserQuestion[],
    listener: QuestionListener,
  ): Promise<readonly AnsweredQuestion[]> {
    return new Promise((resolve, reject) => {
      const queue = this.queues.get(conversationKey) ?? [];
      queue.push({ asker, message, questions, answers: [], listener, resolve, reject });
      this.queues.set(conversationKey, queue);
      this.logger.log(
        `[Questions Queued] Conversation=${conversationKey}, Role=${asker.role}, Questions=${questions.length}, Position=${queue.length}`,
      );
      if (queue.length === 1) {
        this.startTimer(conversationKey);
        this.notifyHead(conversationKey);
      }
    });
  }

  /** Queues a request a restart left unanswered. Nothing waits on it: the answered submission carries the answers. */
  restore(
    conversationKey: string,
    workId: string,
    asker: QuestionAsker,
    { message, questions, answers }: OpenWorkQuestions,
    answersChanged: (answers: readonly AnsweredQuestion[]) => void,
  ): void {
    const queue = this.queues.get(conversationKey) ?? [];
    queue.push({ asker, message, questions, answers: [...answers], listener: { asked: () => undefined, timedOut: () => undefined, answersChanged }, restoredWorkId: workId, resolve: () => undefined, reject: () => undefined });
    this.queues.set(conversationKey, queue);
    this.logger.log(`[Questions Restored] Conversation=${conversationKey}, Role=${asker.role}, Questions=${questions.length}, Answered=${answers.length}`);
  }

  current(conversationKey: string): QuestionPrompt | undefined {
    const queue = this.queues.get(conversationKey);
    return queue?.[0] && this.buildPrompt(queue[0], queue.length - 1);
  }

  hasPending(conversationKey: string): boolean {
    return (this.queues.get(conversationKey)?.length ?? 0) > 0;
  }

  isWaiting(conversationKey: string, role: string, projectName: string | null): boolean {
    return (this.queues.get(conversationKey) ?? []).some(request => this.isAsker(request, role, projectName));
  }

  /**
   * An option index picks an option of a question that has them; text is the user's own answer. Attached files go
   * with the answer either way, and are an answer on their own.
   */
  submit(conversationKey: string, input: QuestionAnswerInput): QuestionSubmission | undefined {
    const queue = this.queues.get(conversationKey);
    const request = queue?.[0];
    if (!queue || !request) {
      return undefined;
    }

    const question = request.questions[request.answers.length]!;
    const answer = this.readAnswer(question, input);
    if (!answer) {
      return { kind: 'invalid', prompt: this.buildPrompt(request, queue.length - 1) };
    }
    return this.advance(conversationKey, queue, request, answer);
  }

  /** Rejects every waiting agent with a cancellation, so the turns waiting on them end as cancelled. */
  cancel(conversationKey: string): boolean {
    const queue = this.queues.get(conversationKey);
    if (!queue) {
      return false;
    }
    this.queues.delete(conversationKey);
    for (const request of queue) {
      this.stopTimer(request);
      request.reject(new PromptCancelledError());
    }
    this.logger.log(`[Questions Cancelled] Conversation=${conversationKey}, Requests=${queue.length}`);
    return true;
  }

  /** Drops the questions of an agent that is being replaced, rejecting its wait with a cancellation. */
  discard(conversationKey: string, role: string, projectName: string | null): void {
    const queue = this.queues.get(conversationKey);
    const index = queue?.findIndex(request => this.isAsker(request, role, projectName)) ?? -1;
    if (!queue || index < 0) {
      return;
    }
    const [request] = queue.splice(index, 1);
    this.stopTimer(request!);
    this.cleanUp(conversationKey, queue);
    request!.reject(new PromptCancelledError());
    this.logger.log(`[Questions Discarded] Conversation=${conversationKey}, Role=${role}`);
    if (index === 0) {
      this.startTimer(conversationKey);
      this.notifyHead(conversationKey);
    }
  }

  /** Records the answer, then moves to the request's next question or resolves it and promotes the next request. */
  private advance(
    conversationKey: string,
    queue: QuestionRequest[],
    request: QuestionRequest,
    answer: AnsweredQuestion,
  ): Extract<QuestionSubmission, { kind: 'next' | 'answered' }> {
    this.stopTimer(request);
    request.answers.push(answer);

    if (request.answers.length < request.questions.length) {
      request.listener.answersChanged?.([...request.answers]);
      this.startTimer(conversationKey);
      return { kind: 'next', prompt: this.buildPrompt(request, queue.length - 1) };
    }

    queue.shift();
    this.cleanUp(conversationKey, queue);
    this.logger.log(`[Questions Answered] Conversation=${conversationKey}, Role=${request.asker.role}`);
    request.resolve(request.answers);
    this.startTimer(conversationKey);
    const next = queue[0] && this.buildPrompt(queue[0], queue.length - 1);
    return {
      kind: 'answered',
      asker: request.asker,
      ...(next ? { next } : {}),
      ...(request.restoredWorkId ? { restoredWork: { workId: request.restoredWorkId, answers: request.answers } } : {}),
    };
  }

  /** Starts the countdown of the question at the front, unless the timeout is disabled or nothing is waiting on it. */
  private startTimer(conversationKey: string): void {
    const request = this.queues.get(conversationKey)?.[0];
    const timeoutMs = this.timeoutConfig.getTimeoutMs();
    if (!request || request.restoredWorkId || timeoutMs <= 0) {
      return;
    }
    request.deadline = { expiresAt: Date.now() + timeoutMs, durationMs: timeoutMs };
    request.timer = setTimeout(() => this.expire(conversationKey, request, timeoutMs), timeoutMs);
    request.timer.unref();
  }

  private stopTimer(request: QuestionRequest): void {
    clearTimeout(request.timer);
    request.timer = undefined;
    request.deadline = undefined;
  }

  /** The recommended option stands in for the user's answer; a question without one is answered with nothing. */
  private expire(conversationKey: string, request: QuestionRequest, timeoutMs: number): void {
    const queue = this.queues.get(conversationKey)!;
    const question = request.questions[request.answers.length]!;
    const recommended = question.recommendedIndex;
    const answered: AnsweredQuestion = recommended
      ? { question, answer: question.options[recommended - 1]!, optionNumber: recommended, timedOut: true }
      : { question, answer: '', timedOut: true };
    this.logger.log(
      `[Questions Timed Out] Conversation=${conversationKey}, Role=${request.asker.role}, Recommended=${recommended ?? 'none'}`,
    );
    const submission = this.advance(conversationKey, queue, request, answered);
    const next = submission.kind === 'next' ? submission.prompt : submission.next;
    request.listener.timedOut({ asker: request.asker, answered, timeoutMs, ...(next && { next }) });
  }

  private notifyHead(conversationKey: string): void {
    const queue = this.queues.get(conversationKey);
    const head = queue?.[0];
    if (head) {
      head.listener.asked(this.buildPrompt(head, queue.length - 1));
    }
  }

  private readAnswer(question: UserQuestion, input: QuestionAnswerInput): AnsweredQuestion | undefined {
    const attachments = input.attachments?.length ? { attachments: input.attachments } : {};
    if (input.kind === 'option') {
      const option = question.options[input.optionIndex - 1];
      return option ? { question, answer: option, optionNumber: input.optionIndex, ...attachments } : undefined;
    }
    const text = input.text.trim();
    return text || input.attachments?.length ? { question, answer: text, ...attachments } : undefined;
  }

  private buildPrompt(request: QuestionRequest, waitingAskers: number): QuestionPrompt {
    const answered = request.answers.length;
    return {
      asker: request.asker,
      question: request.questions[answered]!,
      number: answered + 1,
      total: request.questions.length,
      ...(answered === 0 && request.message ? { message: request.message } : {}),
      waitingAskers,
      ...(request.deadline ? { timeout: request.deadline } : {}),
    };
  }

  private isAsker(request: QuestionRequest, role: string, projectName: string | null): boolean {
    return request.asker.role === role && request.asker.projectName === projectName;
  }

  private cleanUp(conversationKey: string, queue: readonly QuestionRequest[]): void {
    if (queue.length === 0) {
      this.queues.delete(conversationKey);
    }
  }
}
