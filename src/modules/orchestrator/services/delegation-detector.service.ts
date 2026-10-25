import { Injectable } from '@nestjs/common';


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
  | { readonly kind: 'invalid'; readonly reason: string };

type Attributes = ReadonlyMap<string, string>;

type ParsedTag =
  | { readonly delegation: DelegationResult; readonly end: number }
  | { readonly attachment: string; readonly end: number };

const OPENING_TAG = /<(\/?)(delegate|attachment)\b([^>]*)>/gi;
const ATTRIBUTE = /([A-Za-z][\w-]*)=(?:"([^"]*)"|'([^']*)')/g;
const ROLE = /^[A-Za-z][\w-]*$/;
const LEGACY_MARKER = /\[(?:DELEGATE|DONE)\b[^\]\n]*\]/i;

const DELEGATE_ATTRIBUTES = ['role', 'project', 'session'];
const ATTACHMENT_ATTRIBUTES = ['path'];

@Injectable()
export class DelegationDetectorService {
  detect(response: string): CeoDecision {
    if (LEGACY_MARKER.test(response)) {
      return this.invalid('Bracket markers such as [DELEGATE:...] and [DONE] are not part of the protocol. Delegate with <delegate role="ROLE">task</delegate>, and answer the user without any tag to finish.');
    }

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
    const attributes = this.parseAttributes(
      rawTag,
      selfClosing ? rawAttributes!.trimEnd().slice(0, -1) : rawAttributes!,
      name === 'delegate' ? DELEGATE_ATTRIBUTES : ATTACHMENT_ATTRIBUTES,
    );
    if (typeof attributes === 'string') {
      return attributes;
    }

    const contentStart = tag.index + rawTag.length;
    const body = selfClosing ? { content: '', end: contentStart } : this.readBody(response, name, contentStart);
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

  private parseAttributes(rawTag: string, rawAttributes: string, allowed: readonly string[]): Attributes | string {
    const attributes = new Map<string, string>();
    for (const [, name, doubleQuoted, singleQuoted] of rawAttributes.matchAll(ATTRIBUTE)) {
      const key = name!.toLowerCase();
      if (!allowed.includes(key)) {
        const allowedList = allowed.map(attribute => `"${attribute}"`).join(', ');
        return `Unknown attribute "${name}" in ${rawTag}. Use only ${allowedList}.`;
      }
      attributes.set(key, (doubleQuoted ?? singleQuoted)!.trim());
    }
    if (rawAttributes.replace(ATTRIBUTE, '').trim()) {
      return `Malformed tag ${rawTag}. Write each attribute as name="value".`;
    }
    return attributes;
  }

  private readBody(response: string, name: string, contentStart: number): { content: string; end: number } | string {
    const closingTag = `</${name}>`;
    const close = response.toLowerCase().indexOf(closingTag, contentStart);
    const content = close < 0 ? '' : response.slice(contentStart, close);
    if (close < 0 || new RegExp(String.raw`<${name}\b`, 'i').test(content)) {
      return `Every <${name}> must be closed with ${closingTag} before the next <${name}> starts.`;
    }
    return { content, end: close + closingTag.length };
  }

  private parseDelegation(attributes: Attributes, content: string): DelegationResult | string {
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
