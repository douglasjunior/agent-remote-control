import { Injectable, Logger } from '@nestjs/common';

import { PromptCancelledError } from '../../agent/ports/agent.port.js';
import type {
  AnsweredQuestion,
  QuestionAnswerInput,
  QuestionAsker,
  QuestionPrompt,
  QuestionSubmission,
  UserQuestion,
} from '../models/user-question.model.js';


type QuestionRequest = {
  readonly asker: QuestionAsker;
  readonly message: string;
  readonly questions: readonly UserQuestion[];
  readonly answers: AnsweredQuestion[];
  readonly notify?: (prompt: QuestionPrompt) => void;
  readonly resolve: (answers: readonly AnsweredQuestion[]) => void;
  readonly reject: (error: Error) => void;
};

const OPTION_NUMBER = /^\d+$/;

/**
 * Questions agents ask the user, one at a time and in the order the agents asked them. While a conversation has
 * questions waiting, every message the user sends there is an answer.
 */
@Injectable()
export class UserQuestionQueueService {
  private readonly logger = new Logger(UserQuestionQueueService.name);
  private readonly queues = new Map<string, QuestionRequest[]>();

  /**
   * Resolves once the user has answered every question of this request. `notify` shows the first question when the
   * request reaches the head of the queue on its own; one reached by answering the previous request is shown with
   * that answer instead.
   */
  ask(
    conversationKey: string,
    asker: QuestionAsker,
    message: string,
    questions: readonly UserQuestion[],
    notify?: (prompt: QuestionPrompt) => void,
  ): Promise<readonly AnsweredQuestion[]> {
    return new Promise((resolve, reject) => {
      const queue = this.queues.get(conversationKey) ?? [];
      queue.push({ asker, message, questions, answers: [], notify, resolve, reject });
      this.queues.set(conversationKey, queue);
      this.logger.log(
        `[Questions Queued] Conversation=${conversationKey}, Role=${asker.role}, Questions=${questions.length}, Position=${queue.length}`,
      );
      if (queue.length === 1) {
        this.notifyHead(conversationKey);
      }
    });
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
   * A whole number picks an option of a question that has them; any other text is the user's own answer. Attached
   * files go with the answer either way, and are an answer on their own.
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
    request.answers.push(answer);

    if (request.answers.length < request.questions.length) {
      return { kind: 'next', prompt: this.buildPrompt(request, queue.length - 1) };
    }

    queue.shift();
    this.cleanUp(conversationKey, queue);
    this.logger.log(`[Questions Answered] Conversation=${conversationKey}, Role=${request.asker.role}`);
    request.resolve(request.answers);
    const next = queue[0] && this.buildPrompt(queue[0], queue.length - 1);
    return { kind: 'answered', asker: request.asker, ...(next ? { next } : {}) };
  }

  /** Rejects every waiting agent with a cancellation, so the turns waiting on them end as cancelled. */
  cancel(conversationKey: string): boolean {
    const queue = this.queues.get(conversationKey);
    if (!queue) {
      return false;
    }
    this.queues.delete(conversationKey);
    for (const request of queue) {
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
    this.cleanUp(conversationKey, queue);
    request!.reject(new PromptCancelledError());
    this.logger.log(`[Questions Discarded] Conversation=${conversationKey}, Role=${role}`);
    if (index === 0) {
      this.notifyHead(conversationKey);
    }
  }

  private notifyHead(conversationKey: string): void {
    const queue = this.queues.get(conversationKey);
    const head = queue?.[0];
    if (head) {
      head.notify?.(this.buildPrompt(head, queue.length - 1));
    }
  }

  private readAnswer(question: UserQuestion, input: QuestionAnswerInput): AnsweredQuestion | undefined {
    const text = input.text.trim();
    const attachments = input.attachments?.length ? { attachments: input.attachments } : {};
    if (!text && !input.attachments?.length) {
      return undefined;
    }
    if (question.options.length === 0 || !OPTION_NUMBER.test(text)) {
      return { question, answer: text, ...attachments };
    }
    const optionNumber = Number(text);
    const option = question.options[optionNumber - 1];
    return option ? { question, answer: option, optionNumber, ...attachments } : undefined;
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
