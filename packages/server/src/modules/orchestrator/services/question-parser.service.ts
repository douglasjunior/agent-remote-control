import { Injectable } from '@nestjs/common';

import type { UserQuestion } from '../models/user-question.model.js';
import { type CodeSpan, findCodeSpans, isInCode, parseTagAttributes, readTagBody } from '../utils/protocol-tag.util.js';


/** `message` is the agent's text outside the question tags, addressed to the user. */
export type ParsedQuestions =
  | { readonly kind: 'none' }
  | { readonly kind: 'questions'; readonly message: string; readonly questions: readonly UserQuestion[] }
  | { readonly kind: 'invalid'; readonly reason: string };

const QUESTION_TAG = /<(\/?)(question|option)\b([^>]*)>/gi;
const OPTION_TAG = /<(\/?)option\b([^>]*)>/gi;

@Injectable()
export class QuestionParserService {
  parse(response: string): ParsedQuestions {
    const questions: UserQuestion[] = [];
    const messageParts: string[] = [];
    const tags = new RegExp(QUESTION_TAG.source, QUESTION_TAG.flags);
    const codeSpans = findCodeSpans(response);
    let cursor = 0;

    for (let tag = this.nextTag(tags, response, codeSpans); tag; tag = this.nextTag(tags, response, codeSpans)) {
      const [rawTag, closing, rawName, rawAttributes] = tag;
      const name = rawName!.toLowerCase();
      if (name === 'option') {
        return this.invalid(`Found ${rawTag} outside a <question>. Every <option> goes inside the <question> it answers.`);
      }
      if (closing) {
        return this.invalid(`Found ${rawTag} without its opening <question> tag.`);
      }

      const attributes = parseTagAttributes(rawTag, rawAttributes!, ['rationale']);
      if (typeof attributes === 'string') {
        return this.invalid(attributes);
      }
      const body = readTagBody(response, 'question', tag.index + rawTag.length);
      if (typeof body === 'string') {
        return this.invalid(body);
      }

      const question = this.parseQuestion(body.content, attributes.get('rationale'));
      if (typeof question === 'string') {
        return this.invalid(question);
      }
      questions.push(question);
      messageParts.push(response.slice(cursor, tag.index));
      tags.lastIndex = body.end;
      cursor = body.end;
    }

    if (questions.length === 0) {
      return { kind: 'none' };
    }
    messageParts.push(response.slice(cursor));
    const message = messageParts.join('').replace(/\n{3,}/g, '\n\n').trim();
    return { kind: 'questions', message, questions };
  }

  private parseQuestion(content: string, rationale: string | undefined): UserQuestion | string {
    const options: string[] = [];
    const textParts: string[] = [];
    const tags = new RegExp(OPTION_TAG.source, OPTION_TAG.flags);
    let cursor = 0;

    for (let tag = tags.exec(content); tag; tag = tags.exec(content)) {
      const [rawTag, closing, rawAttributes] = tag;
      if (closing) {
        return `Found ${rawTag} without its opening <option> tag.`;
      }
      const attributes = parseTagAttributes(rawTag, rawAttributes!, []);
      if (typeof attributes === 'string') {
        return attributes;
      }
      const body = readTagBody(content, 'option', tag.index + rawTag.length);
      if (typeof body === 'string') {
        return body;
      }
      const option = body.content.trim();
      if (!option) {
        return 'An <option> is empty. Write the choice between <option> and </option>, or remove it.';
      }
      options.push(option);
      textParts.push(content.slice(cursor, tag.index));
      tags.lastIndex = body.end;
      cursor = body.end;
    }
    textParts.push(content.slice(cursor));

    const text = textParts.join('').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) {
      return 'A <question> has no text. Write the question itself inside the tag, before its options.';
    }
    return { text, ...(rationale ? { rationale } : {}), options };
  }

  /** Tags inside Markdown code are quoted markup, such as an HTML `<option>`, not questions. */
  private nextTag(tags: RegExp, response: string, codeSpans: readonly CodeSpan[]): RegExpExecArray | null {
    let tag = tags.exec(response);
    while (tag && isInCode(tag.index, codeSpans)) {
      tag = tags.exec(response);
    }
    return tag;
  }

  private invalid(reason: string): ParsedQuestions {
    return { kind: 'invalid', reason };
  }
}
