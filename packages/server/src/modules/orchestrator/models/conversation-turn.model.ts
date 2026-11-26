import { PromptCancelledError } from '../../agent/ports/agent.port.js';

import type { ActiveTurn } from './active-turn.model.js';
import type { AgentReceipt } from './agent-receipt.model.js';
import type { TurnRequest } from './turn-request.model.js';


/**
 * How a user message that reached a running turn got to the CEO: `queued` while it waits for the CEO's next prompt,
 * `steered` into the prompt running, `delivered` with a later prompt, or `cancelled` by a stop before the CEO read it.
 */
export type UserMessageDelivery = 'queued' | 'steered' | 'delivered' | 'cancelled';

/** The outcome of a message that arrived while a turn ran: it joined that turn, was cancelled, or drives the turn after it. */
export type JoinOutcome =
  | { readonly kind: 'joined' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'drive'; readonly turn: ConversationTurn };

/** A user message that arrived while a turn ran, waiting for the CEO to read it. */
export class PendingMessage {
  private queued = false;

  constructor(
    /** What the CEO reads: the text with the inventory of its attachments. */
    readonly text: string,
    readonly request: TurnRequest,
    private readonly settle: (outcome: JoinOutcome) => void,
  ) {}

  /** Tells the channel once that the message waits. */
  markQueued(): void {
    if (!this.queued) {
      this.queued = true;
      this.request.onDelivery?.('queued');
    }
  }

  reached(delivery: 'steered' | 'delivered'): void {
    this.request.onDelivery?.(delivery);
    this.settle({ kind: 'joined' });
  }

  cancel(): void {
    this.request.onDelivery?.('cancelled');
    this.settle({ kind: 'cancelled' });
  }

  /** The message starts the next turn, which the CEO reads it in as the user's prompt. */
  drive(turn: ConversationTurn): void {
    this.settle({ kind: 'drive', turn });
  }
}

/**
 * The one turn a conversation runs at a time, with its inbox: the user messages that arrived while it ran and wait for
 * the CEO's next prompt. The CEO reads them with that prompt, or with the prompt running when its agent takes steering.
 */
export class ConversationTurn {
  /** The CEO's work of the moment, set while the turn talks to the CEO and cancelled with the turn. */
  ceo: ActiveTurn | null = null;
  /** Whether a prompt of the turn is on its way to the CEO, which a steered message can join. */
  prompting = false;
  /** Whether a steering of the inbox is under way, which the messages behind it wait for. */
  steering = false;
  /** Whether the CEO is idle, waiting for the results of its delegates, which a message wakes it from. */
  waiting = false;
  private work: { readonly id: string; readonly earlier: readonly string[] } | undefined;
  private cancelledTurn = false;
  private readonly inbox: PendingMessage[] = [];
  private readonly steeredNow: string[] = [];
  private readonly steeredReceiptsNow: AgentReceipt[] = [];
  private readonly joinedTexts: string[];
  private readonly readTexts: string[] = [];
  private wake: (() => void) | undefined;
  private steeringDone: Promise<void> = Promise.resolve();

  constructor(inbox: readonly PendingMessage[] = []) {
    this.inbox.push(...inbox);
    this.joinedTexts = inbox.map(message => message.text);
  }

  get isCancelled(): boolean {
    return this.cancelledTurn;
  }

  get hasInbox(): boolean {
    return this.inbox.length > 0;
  }

  /** Every message that joined the turn after its prompt, in order, read or not: what its open work keeps. */
  get joined(): readonly string[] {
    return this.joinedTexts;
  }

  /** The open work of the turn's CEO, while the turn keeps it on disk, with the updates it keeps: those it resumed with, then every message that joined. */
  get openWork(): { readonly id: string; readonly updates: readonly string[] } | undefined {
    return this.work && { id: this.work.id, updates: [...this.work.earlier, ...this.joinedTexts] };
  }

  keepWork(id: string, earlier: readonly string[] = []): void {
    this.work = { id, earlier };
  }

  /** The messages the CEO read during the turn, steered or delivered. */
  get read(): readonly string[] {
    return this.readTexts;
  }

  enqueue(message: PendingMessage): void {
    this.inbox.push(message);
    this.joinedTexts.push(message.text);
    this.wake?.();
  }

  /** Empties the inbox for the prompt that carries its messages. */
  take(): readonly PendingMessage[] {
    return this.inbox.splice(0);
  }

  /** Follows a steering of the inbox, so the turn does not end before it returns the messages the agent did not take. */
  trackSteering(steering: Promise<unknown>): void {
    this.steeringDone = steering.then(() => undefined, () => undefined);
  }

  /** Resolves once the steering under way has returned, with its undelivered messages back in the inbox. */
  steeringSettled(): Promise<void> {
    return this.steeringDone;
  }

  /** Puts messages a steering did not deliver back at the front of the inbox, in their order. */
  putBack(messages: readonly PendingMessage[]): void {
    this.inbox.unshift(...messages);
  }

  /** The messages wait for the next prompt; each tells its channel once. */
  markQueued(): void {
    this.inbox.forEach(message => message.markQueued());
  }

  /** Records messages the CEO read, steered into the prompt running when `steered`, which the turn takes after that prompt. */
  markRead(texts: readonly string[], steered: boolean): void {
    this.readTexts.push(...texts);
    if (steered) {
      this.steeredNow.push(...texts);
    }
  }

  /** The messages steered into the prompt that just ended, which a retry of that prompt carries again. */
  takeSteered(): readonly string[] {
    return this.steeredNow.splice(0);
  }

  /** Records agent receipts steered into the prompt running, which the turn takes after that prompt. */
  markSteeredReceipts(receipts: readonly AgentReceipt[]): void {
    this.steeredReceiptsNow.push(...receipts);
  }

  /** The agent receipts steered into the prompt that just ended, which a retry of that prompt carries again. */
  takeSteeredReceipts(): readonly AgentReceipt[] {
    return this.steeredReceiptsNow.splice(0);
  }

  /** Resolves once a message waits in the inbox or the turn is cancelled. */
  arrival(): Promise<void> {
    if (this.hasInbox || this.cancelledTurn) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.wake = () => {
        this.wake = undefined;
        resolve();
      };
    });
  }

  /** Marks the turn cancelled and returns the messages its inbox held, which the caller cancels. */
  cancel(): readonly PendingMessage[] {
    this.cancelledTurn = true;
    const drained = this.take();
    this.wake?.();
    return drained;
  }

  throwIfCancelled(): void {
    if (this.cancelledTurn) {
      throw new PromptCancelledError();
    }
  }
}
