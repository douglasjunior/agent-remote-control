import type { Attachment } from '@agent-remote-control/protocol/attachment';
import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { DelegationEvent } from '../../orchestrator/models/delegation-event.model.js';
import type { TurnActivity } from '../../orchestrator/models/turn-activity.model.js';
import type { TurnResult } from '../../orchestrator/models/turn-result.model.js';
import type { QuestionAsker, QuestionPrompt, QuestionSubmission } from '../../orchestrator/models/user-question.model.js';


type NoticeLevel = Extract<ConversationEntry, { type: 'notice' }>['level'];

/** Builds the entries a conversation records; it owns the clock and the random ids, so the same inputs make different entries. */
@Injectable()
export class ConversationEntryService {
  userMessage(text: string, attachments: readonly Attachment[] = []): ConversationEntry {
    return {
      id: randomUUID(),
      ...this.stamp(),
      type: 'user_message',
      text,
      ...(attachments.length > 0 && { attachments: [...attachments] }),
    };
  }

  notice(level: NoticeLevel, text: string): ConversationEntry {
    return { id: randomUUID(), ...this.stamp(), type: 'notice', level, text };
  }

  /** Keyed by the question, so concurrent history requests closing it record a single notice. */
  abandonedQuestionNotice(questionId: string): ConversationEntry {
    return {
      ...this.notice('warning', 'The agent is no longer waiting for this answer. Send a message to continue.'),
      id: `question-abandoned:${questionId}`,
    };
  }

  interim(text: string): ConversationEntry {
    return { id: randomUUID(), ...this.stamp(), type: 'interim', text };
  }

  /** Steering and cancellation markers have no entry; empty thoughts are skipped. */
  activity(activity: TurnActivity, role: string, turnId: string): ConversationEntry | null {
    if (activity.kind === 'thought') {
      if (!activity.removed && !activity.text.trim()) {
        return null;
      }
      return {
        id: `thought:${turnId}:${role}:${activity.id}`,
        ...this.stamp(),
        type: 'thought',
        text: activity.text,
        ...(activity.removed ? { removed: true } : {}),
        role,
      };
    }
    if (activity.kind === 'tool') {
      return {
        id: `tool:${turnId}:${role}:${activity.toolCallId}`,
        ...this.stamp(),
        type: 'tool',
        title: activity.title,
        status: activity.status,
        ...(activity.result !== undefined ? { result: activity.result } : {}),
        ...(activity.details !== undefined ? { details: activity.details } : {}),
        role,
      };
    }
    return null;
  }

  delegation(event: DelegationEvent): ConversationEntry {
    const base = {
      id: `delegation:${event.delegationId}:${event.phase}`,
      delegationId: event.delegationId,
      ...this.stamp(),
      type: 'delegation' as const,
      phase: event.phase,
      round: event.round,
      role: event.role,
      roleName: event.roleName,
      ...(event.projectName ? { projectName: event.projectName } : {}),
      summary: event.summary,
      prompt: event.taskSpec,
    };
    if (event.phase === 'started') {
      return base;
    }
    if (event.phase === 'failed') {
      return { ...base, errorMessage: event.errorMessage, durationMs: event.durationMs };
    }
    if (event.phase === 'cancelled') {
      return { ...base, durationMs: event.durationMs };
    }
    return {
      ...base,
      response: event.response,
      agentInfo: { ...event.agentInfo },
      durationMs: event.durationMs,
    };
  }

  question(prompt: QuestionPrompt): ConversationEntry {
    const { asker, question } = prompt;
    return {
      id: randomUUID(),
      ...this.stamp(),
      type: 'question',
      askerRole: asker.role,
      askerRoleName: asker.roleName,
      ...(asker.projectName ? { projectName: asker.projectName } : {}),
      text: question.text,
      ...(question.rationale ? { rationale: question.rationale } : {}),
      options: [...question.options],
      ...(question.recommendedIndex ? { recommendedIndex: question.recommendedIndex } : {}),
      ...(prompt.timeout ? { timeout: { ...prompt.timeout } } : {}),
      number: prompt.number,
      total: prompt.total,
      closed: false,
      ...(prompt.message ? { message: prompt.message } : {}),
    };
  }

  agentResponse(result: TurnResult): ConversationEntry {
    return {
      id: randomUUID(),
      ...this.stamp(),
      type: 'agent_response',
      status: result.status,
      response: result.response,
      ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
      ...(result.agentInfo ? { agentInfo: { ...result.agentInfo } } : {}),
    };
  }

  private answersSentNotice(asker: QuestionAsker): ConversationEntry {
    const project = asker.projectName ? ` (${asker.projectName})` : '';
    return this.notice('info', `Answers sent to ${asker.roleName}${project}.`);
  }

  /** Entries that follow an answer to a question: the next question, a retry or the confirmation. */
  submission(submission: QuestionSubmission): ConversationEntry[] {
    switch (submission.kind) {
      case 'next':
        return [this.question(submission.prompt)];
      case 'invalid':
        return [
          this.notice('warning', `Invalid option. Reply with a number from 1 to ${submission.prompt.question.options.length} or type another answer.`),
          this.question(submission.prompt),
        ];
      case 'answered':
        return [this.answersSentNotice(submission.asker), ...(submission.next ? [this.question(submission.next)] : [])];
    }
  }

  private stamp(): { at: string } {
    return { at: new Date().toISOString() };
  }
}
