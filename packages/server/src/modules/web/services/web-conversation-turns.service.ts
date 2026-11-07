import type { ConversationState } from '@agent-remote-control/protocol/conversation';
import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { QuestionTimedOut } from '../../orchestrator/models/question-event.model.js';
import type { TurnRequest } from '../../orchestrator/models/turn-request.model.js';
import type { TurnResult } from '../../orchestrator/models/turn-result.model.js';
import { IAgentTurnPort } from '../../orchestrator/ports/agent-turn.port.js';
import { IUserQuestionPort } from '../../orchestrator/ports/user-question.port.js';
import { IConversationStorePort } from '../ports/conversation-store.port.js';

import { ConversationEntryService } from './conversation-entry.service.js';
import { WebConversationEventsService } from './web-conversation-events.service.js';


type TurnState = Exclude<ConversationState, 'idle'>;

export type TurnCallbacks = Pick<
  TurnRequest,
  'onActivity' | 'onDraft' | 'onDelegation' | 'onInterimMessage' | 'onQuestion' | 'onTranscription' | 'onQueued'
>;

/**
 * The turns active in each conversation. The published state is derived from all of them, so a turn that
 * ends never reports idle while another one is still alive.
 */
@Injectable()
export class WebConversationTurnsService {
  private readonly logger = new Logger(WebConversationTurnsService.name);
  private readonly turns = new Map<string, Map<string, TurnState>>();

  constructor(
    private readonly events: WebConversationEventsService,
    @Inject(IConversationStorePort) private readonly store: IConversationStorePort,
    @Inject(IUserQuestionPort) private readonly userQuestions: IUserQuestionPort,
    @Inject(IAgentTurnPort) private readonly agentTurn: IAgentTurnPort,
    private readonly entries: ConversationEntryService,
  ) {}

  /** Turns what the agents report into entries, ending with the result of the turn. */
  async run(conversationId: string, turnId: string, execute: (callbacks: TurnCallbacks) => Promise<TurnResult>): Promise<void> {
    const markRunning = (): void => this.markRunning(conversationId, turnId);
    const publish = (entry: ConversationEntry): void => {
      markRunning();
      void this.events.publishEntry(conversationId, entry);
    };

    const result = await execute({
      onActivity: (activity, role) => {
        const entry = this.entries.activity(activity, role, turnId);
        if (entry) {
          publish(entry);
        }
      },
      onDraft: (text) => {
        markRunning();
        this.events.publishDraft(conversationId, text);
      },
      onDelegation: (event) => {
        publish(this.entries.delegation(event));
        this.publishInterrupted(conversationId);
      },
      onInterimMessage: message => publish(this.entries.interim(message)),
      onQuestion: (event) => {
        if (event.kind === 'asked') {
          publish(this.entries.question(event.prompt));
        } else {
          void this.publishQuestionTimedOut(conversationId, turnId, event);
        }
      },
      onTranscription: ({ transcripts, warnings }) => {
        warnings.forEach(warning => publish(this.entries.notice('warning', warning)));
        transcripts.forEach(({ name, text }) => publish(this.entries.notice('info', `🎙️ ${name}: ${text}`)));
      },
      onQueued: () => this.markQueued(conversationId, turnId),
    });

    await this.events.publishEntry(conversationId, this.entries.agentResponse(result));
    this.end(conversationId, turnId);
    this.publishInterrupted(conversationId);
  }

  publishInterrupted(conversationId: string): void {
    this.events.publishInterrupted(conversationId, this.agentTurn.listInterruptedWork(conversationId));
  }

  begin(conversationId: string): string {
    const turnId = randomUUID();
    this.turnsOf(conversationId).set(turnId, 'running');
    this.reconcile(conversationId);
    return turnId;
  }

  markRunning(conversationId: string, turnId: string): void {
    this.mark(conversationId, turnId, 'running');
  }

  markQueued(conversationId: string, turnId: string): void {
    this.mark(conversationId, turnId, 'queued');
  }

  /** Safe to call more than once for the same turn. */
  end(conversationId: string, turnId: string): void {
    this.turnsOf(conversationId).delete(turnId);
    this.reconcile(conversationId);
  }

  private async publishQuestionTimedOut(conversationId: string, turnId: string, timedOut: QuestionTimedOut): Promise<void> {
    this.markRunning(conversationId, turnId);
    await this.events.closeOpenQuestions(conversationId);
    for (const entry of this.timedOutEntries(timedOut)) {
      await this.events.publishEntry(conversationId, entry);
    }
  }

  /** What was assumed on the user's behalf, then the question that follows. */
  private timedOutEntries({ asker, answered, timeoutMs, next }: QuestionTimedOut): ConversationEntry[] {
    const project = asker.projectName ? ` (${asker.projectName})` : '';
    const minutes = Math.max(1, Math.round(timeoutMs / 60_000));
    const outcome = answered.optionNumber
      ? `assumed the recommended answer: ${answered.answer}`
      : 'no answer assumed, the agent decides how to proceed';
    return [
      this.entries.notice('warning', `No reply in ${minutes} min, ${asker.roleName}${project}: ${outcome}.`),
      ...(next ? [this.entries.question(next)] : []),
    ];
  }

  private mark(conversationId: string, turnId: string, state: TurnState): void {
    const turns = this.turnsOf(conversationId);
    if (turns.has(turnId)) {
      turns.set(turnId, state);
      this.reconcile(conversationId);
    }
  }

  private turnsOf(conversationId: string): Map<string, TurnState> {
    let turns = this.turns.get(conversationId);
    if (!turns) {
      turns = new Map();
      this.turns.set(conversationId, turns);
    }
    return turns;
  }

  private derive(conversationId: string): ConversationState {
    const states = [...this.turnsOf(conversationId).values()];
    if (states.length === 0) {
      return 'idle';
    }
    return states.every(state => state === 'queued') ? 'queued' : 'running';
  }

  /**
   * Publishes only a change. A conversation that becomes idle first closes the questions nothing can answer
   * any more, then persists its history. A question restored after a restart can still be answered with no turn
   * running.
   */
  private reconcile(conversationId: string): void {
    const state = this.derive(conversationId);
    if (state === this.events.stateOf(conversationId)) {
      return;
    }
    this.logger.log(`[Conversation State] ${state}`);
    if (state !== 'idle') {
      this.events.publishState(conversationId, state);
      return;
    }
    const closing = this.userQuestions.hasPendingQuestions(conversationId)
      ? Promise.resolve()
      : this.events.closeOpenQuestions(conversationId);
    this.events.publishState(conversationId, 'idle');
    void closing.then(() => this.store.flush(conversationId)).catch((error: unknown) => {
      this.logger.warn(`flush_failed: ${conversationId}: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}
