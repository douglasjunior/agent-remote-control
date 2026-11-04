import { findCodeSpans, isInCode } from './protocol-tag.util.js';


const PROTOCOL_TAGS = ['delegate', 'question', 'attachment', 'user_language'] as const;
const OPENING_TAG = new RegExp(String.raw`<(${PROTOCOL_TAGS.join('|')})\b[^>]*>`, 'gi');

/**
 * The text of a CEO response that the user reads, from a response that may still be streaming: the protocol
 * tags (`<delegate>`, `<question>`, `<attachment>`, `<user_language>`) and their bodies are left out, and so is
 * a tag still being typed, which stays out until it is complete. Tags inside Markdown code are quoted markup
 * and stay.
 */
export function visibleReply(response: string): string {
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
      return tidy(visible);
    }
    cursor = close + closing.length;
    tags.lastIndex = cursor;
  }

  visible += response.slice(cursor);
  return tidy(withoutTagBeingTyped(visible, findCodeSpans(visible)));
}

function withoutTagBeingTyped(text: string, codeSpans: ReturnType<typeof findCodeSpans>): string {
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

function tidy(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').trim();
}
