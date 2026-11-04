import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { randomUUID } from 'node:crypto';


import type { AgentActivity } from '../../agent/ports/agent.port.js';
import type { DelegationEvent } from '../../orchestrator/models/delegation-event.model.js';
import type { TurnResult } from '../../orchestrator/models/turn-result.model.js';
import type { QuestionAsker, QuestionPrompt, QuestionSubmission } from '../../orchestrator/models/user-question.model.js';


type NoticeLevel = Extract<ConversationEntry, { type: 'notice' }>['level'];

function stamp(): { at: string } {
  return { at: new Date().toISOString() };
}

export function userMessageEntry(text: string): ConversationEntry {
  return { id: randomUUID(), ...stamp(), type: 'user_message', text };
}

export function noticeEntry(level: NoticeLevel, text: string): ConversationEntry {
  return { id: randomUUID(), ...stamp(), type: 'notice', level, text };
}

export function interimEntry(text: string): ConversationEntry {
  return { id: randomUUID(), ...stamp(), type: 'interim', text };
}

/** Steering and cancellation markers have no entry; empty thoughts are skipped. */
export function activityEntry(activity: AgentActivity): ConversationEntry | null {
  if (activity.kind === 'thought') {
    if (!activity.removed && !activity.text.trim()) {
      return null;
    }
    return {
      id: `thought:${activity.id}`,
      ...stamp(),
      type: 'thought',
      text: activity.text,
      ...(activity.removed ? { removed: true } : {}),
    };
  }
  if (activity.kind === 'tool') {
    return {
      id: `tool:${activity.toolCallId}`,
      ...stamp(),
      type: 'tool',
      title: activity.title,
      status: activity.status,
      ...(activity.result !== undefined ? { result: activity.result } : {}),
      ...(activity.details !== undefined ? { details: activity.details } : {}),
    };
  }
  return null;
}

export function delegationEntry(event: DelegationEvent): ConversationEntry {
  const base = {
    id: `delegation:${event.round}:${event.role}:${event.phase}`,
    ...stamp(),
    type: 'delegation' as const,
    phase: event.phase,
    round: event.round,
    role: event.role,
    roleName: event.roleName,
    ...(event.projectName ? { projectName: event.projectName } : {}),
  };
  if (event.phase === 'started') {
    return base;
  }
  return {
    ...base,
    response: event.response,
    agentInfo: { ...event.agentInfo },
    durationMs: event.durationMs,
  };
}

export function questionEntry(prompt: QuestionPrompt): ConversationEntry {
  const { asker, question } = prompt;
  return {
    id: randomUUID(),
    ...stamp(),
    type: 'question',
    askerRoleName: asker.roleName,
    ...(asker.projectName ? { projectName: asker.projectName } : {}),
    text: question.text,
    ...(question.rationale ? { rationale: question.rationale } : {}),
    options: [...question.options],
    number: prompt.number,
    total: prompt.total,
    ...(prompt.message ? { message: prompt.message } : {}),
  };
}

export function agentResponseEntry(result: TurnResult): ConversationEntry {
  return {
    id: randomUUID(),
    ...stamp(),
    type: 'agent_response',
    status: result.status,
    response: result.response,
    ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
    ...(result.agentInfo ? { agentInfo: { ...result.agentInfo } } : {}),
  };
}

function answersSentNotice(asker: QuestionAsker): ConversationEntry {
  const project = asker.projectName ? ` (${asker.projectName})` : '';
  return noticeEntry('info', `Answers sent to ${asker.roleName}${project}.`);
}

/** Entries that follow an answer to a question: the next question, a retry or the confirmation. */
export function submissionEntries(submission: QuestionSubmission): ConversationEntry[] {
  switch (submission.kind) {
    case 'next':
      return [questionEntry(submission.prompt)];
    case 'invalid':
      return [
        noticeEntry('warning', `Invalid option. Reply with a number from 1 to ${submission.prompt.question.options.length} or type another answer.`),
        questionEntry(submission.prompt),
      ];
    case 'answered':
      return [answersSentNotice(submission.asker), ...(submission.next ? [questionEntry(submission.next)] : [])];
  }
}
