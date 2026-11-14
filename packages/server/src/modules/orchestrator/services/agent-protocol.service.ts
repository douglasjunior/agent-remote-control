import { Injectable } from '@nestjs/common';

import type { AgentActivity } from '../../agent/ports/agent.port.js';
import { FINAL_RESPONSE_CLOSE, FINAL_RESPONSE_OPEN } from '../constants/final-response.constant.js';
import type { TurnActivity } from '../models/turn-activity.model.js';
import { findCodeSpans, isInCode } from '../utils/protocol-tag.util.js';


const PROTOCOL_TAGS = [
  'delegate',
  'question',
  'attachment',
  'user_language',
  'artifact_list',
  'artifact_read',
  'artifact_create',
  'artifact_update',
  'artifact_comment',
  'skill_read',
  'skill_list',
  'skill_write',
] as const;
const OPENING_TAG = new RegExp(String.raw`<(${PROTOCOL_TAGS.join('|')})\b[^>]*>`, 'gi');

type ThoughtActivity = AgentActivity & { kind: 'thought' };

type EnvelopeParts = {
  readonly prose: string;
  readonly answers: readonly string[];
};

type StreamState = {
  readonly blocks: Map<string, { text: string; reasoning: boolean }>;
  readonly settled: Set<string>;
  lastAnswer: string;
};

export type AgentProtocolStreamHandlers = {
  readonly onActivity: (activity: TurnActivity) => void;
  /** Called with the answer as it stands, whole, every time it changes. */
  readonly onAnswer?: (answer: string) => void;
};

export type AgentProtocolStream = {
  read(activity: AgentActivity): void;
};

/** The response protocol agents follow: the `<final_response>` envelope around the answer the user reads. */
@Injectable()
export class AgentProtocolService {
  /** Reads the activities of one prompt as they arrive and tells the channel what to show. */
  stream(handlers: AgentProtocolStreamHandlers): AgentProtocolStream {
    const state: StreamState = { blocks: new Map(), settled: new Set(), lastAnswer: '' };
    return {
      read: (activity) => {
        if (activity.kind !== 'thought') {
          handlers.onActivity(activity);
          return;
        }
        const reasoning = activity.reasoning === true;
        state.blocks.set(activity.id, { text: activity.text, reasoning });
        if (!state.settled.has(activity.id)) {
          this.relayThought(activity, state, handlers);
        }
        this.relayAnswer(state, handlers);
      },
    };
  }

  /** The answer in what the agent wrote during a prompt. */
  finalResponse(written: string): string {
    return this.answerOf([written], false);
  }

  /**
   * The protocol tags an agent wrote outside the `<final_response>` envelope of a text that has one. Text outside the
   * envelope is narration, so such a tag would be dropped without a word; tags inside Markdown code are quoted markup.
   */
  strayTags(written: string): string[] {
    if (!written.includes(FINAL_RESPONSE_OPEN)) {
      return [];
    }
    const { prose } = this.splitEnvelopes(written);
    const codeSpans = findCodeSpans(prose);
    const names = new Set<string>();
    for (const tag of prose.matchAll(new RegExp(OPENING_TAG.source, OPENING_TAG.flags))) {
      if (!isInCode(tag.index, codeSpans)) {
        names.add(tag[1]!.toLowerCase());
      }
    }
    return [...names];
  }

  /**
   * The text of a CEO response that the user reads, from a response that may still be streaming: the protocol
   * tags (`<delegate>`, `<question>`, `<attachment>`, `<user_language>`, the artifact and skill requests) and their bodies are left out, and so is
   * a tag still being typed, which stays out until it is complete. Tags inside Markdown code are quoted markup
   * and stay.
   */
  visibleReply(response: string): string {
    const codeSpans = findCodeSpans(response);
    const tags = new RegExp(OPENING_TAG.source, OPENING_TAG.flags);
    let visible = '';
    let cursor = 0;

    for (let tag = tags.exec(response); tag; tag = tags.exec(response)) {
      if (isInCode(tag.index, codeSpans)) {
        continue;
      }
      visible += response.slice(cursor, tag.index);
      const opening = tag.index + tag[0].length;
      if (tag[0].endsWith('/>')) {
        cursor = opening;
        continue;
      }
      const closing = `</${tag[1]!.toLowerCase()}>`;
      const close = response.toLowerCase().indexOf(closing, opening);
      if (close < 0) {
        return this.tidy(visible);
      }
      cursor = close + closing.length;
      tags.lastIndex = cursor;
    }

    visible += response.slice(cursor);
    return this.tidy(this.withoutTagBeingTyped(visible, findCodeSpans(visible)));
  }

  /**
   * A block with an envelope carries the turn answer. Its first sighting settles the entry to the prose before
   * the envelope, or takes it back when there is none; the rest of the block is the answer and stays out of the feed.
   */
  private relayThought(activity: ThoughtActivity, state: StreamState, handlers: AgentProtocolStreamHandlers): void {
    const { id, text, final } = activity;
    const reasoning = activity.reasoning === true;
    const hasEnvelope = !reasoning && text.includes(FINAL_RESPONSE_OPEN);
    const prose = reasoning ? text : this.withoutPartialTag(this.splitEnvelopes(text).prose, FINAL_RESPONSE_OPEN).trim();

    if (hasEnvelope) {
      state.settled.add(id);
      handlers.onActivity(prose.length > 0 ? { kind: 'thought', id, text: prose, final: true } : { kind: 'thought', id, text: '', removed: true });
    } else if (prose.length > 0) {
      handlers.onActivity({ kind: 'thought', id, text: prose, ...(final ? { final } : {}) });
    }
  }

  private relayAnswer(state: StreamState, handlers: AgentProtocolStreamHandlers): void {
    if (!handlers.onAnswer) {
      return;
    }
    const written = [...state.blocks.values()].filter(block => !block.reasoning).map(block => block.text);
    const answer = this.answerOf(written, true);
    if (answer !== state.lastAnswer) {
      state.lastAnswer = answer;
      handlers.onAnswer(answer);
    }
  }

  /**
   * The answer of the texts the agent wrote: the content of their `<final_response>` envelopes or, when none has
   * one, everything they say. While `streaming`, an envelope opening still being typed is held back.
   */
  private answerOf(texts: readonly string[], streaming: boolean): string {
    const parts = texts.some(text => text.includes(FINAL_RESPONSE_OPEN))
      ? texts.flatMap(text => this.splitEnvelopes(text).answers)
      : texts.map((text) => {
        const bare = this.withoutEnvelopeTags(text);
        return streaming ? this.withoutPartialTag(bare, FINAL_RESPONSE_OPEN) : bare;
      });
    return parts.map(part => part.trim()).filter(part => part.length > 0).join('\n\n');
  }

  /**
   * Splits a message into the prose around `<final_response>` envelopes and the envelope contents.
   * An envelope still missing its closing tag runs to the end of the text, since it is still streaming.
   */
  private splitEnvelopes(text: string): EnvelopeParts {
    let prose = '';
    const answers: string[] = [];
    let rest = text;

    while (rest.length > 0) {
      const open = rest.indexOf(FINAL_RESPONSE_OPEN);
      if (open < 0) {
        prose += rest;
        break;
      }

      prose += rest.slice(0, open);
      const contentStart = open + FINAL_RESPONSE_OPEN.length;
      const close = rest.indexOf(FINAL_RESPONSE_CLOSE, contentStart);
      if (close < 0) {
        answers.push(this.withoutPartialTag(rest.slice(contentStart), FINAL_RESPONSE_CLOSE));
        break;
      }

      answers.push(rest.slice(contentStart, close));
      rest = rest.slice(close + FINAL_RESPONSE_CLOSE.length);
    }

    return { prose, answers };
  }

  private withoutEnvelopeTags(text: string): string {
    return text.split(FINAL_RESPONSE_OPEN).join('').split(FINAL_RESPONSE_CLOSE).join('');
  }

  /** A tag still being typed ends the text with its first characters; they are held back until the tag completes. */
  private withoutPartialTag(text: string, tag: string): string {
    for (let length = Math.min(text.length, tag.length - 1); length > 0; length--) {
      if (text.endsWith(tag.slice(0, length))) {
        return text.slice(0, -length);
      }
    }
    return text;
  }

  private withoutTagBeingTyped(text: string, codeSpans: ReturnType<typeof findCodeSpans>): string {
    const start = text.lastIndexOf('<');
    if (start < 0 || isInCode(start, codeSpans)) {
      return text;
    }
    const typed = text.slice(start + 1);
    if (typed.includes('>')) {
      return text;
    }
    const name = /^[A-Za-z_]*/.exec(typed)![0].toLowerCase();
    const rest = typed.slice(name.length);
    const stillTypingName = rest === '' && PROTOCOL_TAGS.some(tag => tag.startsWith(name));
    const typingAttributes = PROTOCOL_TAGS.some(tag => tag === name) && /^[\s/]/.test(rest);
    return stillTypingName || typingAttributes ? text.slice(0, start) : text;
  }

  private tidy(text: string): string {
    return text.replace(/\n{3,}/g, '\n\n').trim();
  }
}
