import { Injectable } from '@nestjs/common';

import type { UserQuestion } from '../models/user-question.model.js';
import { parseTagAttributes, readTagBody, type TagAttributes } from '../utils/protocol-tag.util.js';

import { QuestionParserService } from './question-parser.service.js';


export type DelegationSessionMode = 'resume' | 'new';

export type DelegationResult = {
  readonly delegateToRole: string;
  readonly projectName: string | undefined;
  readonly taskSpec: string;
  readonly sessionMode?: DelegationSessionMode;
};

/** `message` is the text outside the protocol tags, addressed to the user. */
export type CeoDecision =
  | { readonly kind: 'delegate'; readonly message: string; readonly delegations: readonly DelegationResult[] }
  | { readonly kind: 'reply'; readonly message: string; readonly attachments: readonly string[] }
  | { readonly kind: 'ask'; readonly message: string; readonly questions: readonly UserQuestion[] }
  | { readonly kind: 'invalid'; readonly reason: string };

type ParsedTag =
  | { readonly delegation: DelegationResult; readonly end: number }
  | { readonly attachment: string; readonly end: number };

const OPENING_TAG = /<(\/?)(delegate|attachment)\b([^>]*)>/gi;
const ROLE = /^[A-Za-z][\w-]*$/;

const DELEGATE_ATTRIBUTES = ['role', 'project', 'session'];
const ATTACHMENT_ATTRIBUTES = ['path'];

@Injectable()
export class DelegationDetectorService {
  constructor(private readonly questionParser: QuestionParserService) {}

  detect(response: string): CeoDecision {
    const delegations: DelegationResult[] = [];
    const attachments: string[] = [];
    const messageParts: string[] = [];
    const tags = new RegExp(OPENING_TAG.source, OPENING_TAG.flags);
    let cursor = 0;

    for (let tag = tags.exec(response); tag; tag = tags.exec(response)) {
      messageParts.push(response.slice(cursor, tag.index));
      const parsed = this.readTag(response, tag);
      if (typeof parsed === 'string') {
        return this.invalid(parsed);
      }
      tags.lastIndex = parsed.end;
      cursor = parsed.end;
      if ('delegation' in parsed) {
        delegations.push(parsed.delegation);
      } else {
        attachments.push(parsed.attachment);
      }
    }
    messageParts.push(response.slice(cursor));

    const message = messageParts.join('').replace(/\n{3,}/g, '\n\n').trim();
    const questions = this.questionParser.parse(message);
    if (questions.kind === 'invalid') {
      return this.invalid(questions.reason);
    }
    if (questions.kind === 'questions') {
      if (delegations.length > 0) {
        return this.invalid('A response either asks the user questions or delegates, never both. Ask first and delegate once the user has answered, or delegate and let the agent ask what it needs.');
      }
      if (attachments.length > 0) {
        return this.invalid('Attachments go in the answer to the user, not in a response that asks questions. Send them once the user has answered.');
      }
      return { kind: 'ask', message: questions.message, questions: questions.questions };
    }
    if (delegations.length === 0) {
      return { kind: 'reply', message, attachments };
    }
    if (attachments.length > 0) {
      return this.invalid('Attachments go in the answer to the user, not in a response that delegates. Send them once the agents have finished.');
    }
    return { kind: 'delegate', message, delegations };
  }

  private readTag(response: string, tag: RegExpExecArray): ParsedTag | string {
    const [rawTag, closing, rawName, rawAttributes] = tag;
    const name = rawName!.toLowerCase();
    if (closing) {
      return `Found ${rawTag} without its opening <${name}> tag.`;
    }

    const selfClosing = rawAttributes!.trimEnd().endsWith('/');
    const attributes = parseTagAttributes(
      rawTag,
      selfClosing ? rawAttributes!.trimEnd().slice(0, -1) : rawAttributes!,
      name === 'delegate' ? DELEGATE_ATTRIBUTES : ATTACHMENT_ATTRIBUTES,
    );
    if (typeof attributes === 'string') {
      return attributes;
    }

    const contentStart = tag.index + rawTag.length;
    const body = selfClosing ? { content: '', end: contentStart } : readTagBody(response, name, contentStart);
    if (typeof body === 'string') {
      return body;
    }

    if (name === 'attachment') {
      const path = attributes.get('path');
      return path ? { attachment: path, end: body.end } : 'Every <attachment> needs a path attribute with the absolute path of the file.';
    }
    const delegation = this.parseDelegation(attributes, body.content);
    return typeof delegation === 'string' ? delegation : { delegation, end: body.end };
  }

  private parseDelegation(attributes: TagAttributes, content: string): DelegationResult | string {
    const role = attributes.get('role');
    if (!role || !ROLE.test(role)) {
      return 'Every <delegate> needs a role attribute with the role name, as in <delegate role="DEVELOPER">.';
    }

    const projectName = attributes.get('project');
    if (projectName === '') {
      return `The project attribute of <delegate role="${role}"> is empty. Name the project folder, or leave the attribute out.`;
    }

    const session = attributes.get('session')?.toLowerCase();
    if (session !== undefined && session !== 'new' && session !== 'resume') {
      return `The session attribute of <delegate role="${role}"> must be "new" or "resume".`;
    }

    const taskSpec = content.trim();
    if (!taskSpec) {
      return `<delegate role="${role}"> has no task specification. Write the task between <delegate ...> and </delegate>.`;
    }

    return {
      delegateToRole: role.toUpperCase(),
      projectName,
      taskSpec,
      ...(session ? { sessionMode: session } : {}),
    };
  }

  private invalid(reason: string): CeoDecision {
    return { kind: 'invalid', reason };
  }
}
