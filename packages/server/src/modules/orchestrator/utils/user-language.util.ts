import { userLanguageSchema } from '@agent-remote-control/protocol/settings';

import { findCodeSpans, isInCode } from './protocol-tag.util.js';


export type ExtractedUserLanguage = {
  readonly language?: string;
  /** The response without its `<user_language>` tags. */
  readonly text: string;
};

const USER_LANGUAGE_TAG = /<user_language>([\s\S]*?)<\/user_language>/gi;

/**
 * The language goes into every prompt, so `userLanguageSchema` rejects anything that could break out of a prompt line;
 * the settings page checks it with the same schema.
 */
export function normalizeUserLanguage(input: string): string | undefined {
  const parsed = userLanguageSchema.safeParse(input);
  return parsed.success ? parsed.data : undefined;
}

/** The first valid tag outside Markdown code wins; every tag outside code is removed from the text. */
export function extractUserLanguage(response: string): ExtractedUserLanguage {
  const codeSpans = findCodeSpans(response);
  let language: string | undefined;
  const text = response.replace(USER_LANGUAGE_TAG, (tag: string, content: string, index: number) => {
    if (isInCode(index, codeSpans)) {
      return tag;
    }
    language ??= normalizeUserLanguage(content);
    return '';
  });
  if (text === response) {
    return { text: response };
  }
  return { ...(language ? { language } : {}), text: text.replace(/\n{3,}/g, '\n\n').trim() };
}
