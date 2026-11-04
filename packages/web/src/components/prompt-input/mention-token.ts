export type Mention = {
  /** Index of the `@`. */
  readonly start: number;
  /** End of the token: the next whitespace after the cursor, or the end of the text. */
  readonly end: number;
  /** The text between the `@` and the cursor. */
  readonly query: string;
};

/** The `@` token under the cursor, when the `@` begins a word and no whitespace sits between it and the cursor. */
export function findMentionAtCursor(value: string, cursor: number): Mention | null {
  let start = cursor - 1;
  while (start >= 0 && !/\s/.test(value[start])) {
    if (value[start] === '@') {
      break;
    }
    start -= 1;
  }
  if (start < 0 || value[start] !== '@' || (start > 0 && !/\s/.test(value[start - 1]))) {
    return null;
  }
  let end = cursor;
  while (end < value.length && !/\s/.test(value[end])) {
    end += 1;
  }
  return { start, end, query: value.slice(start + 1, cursor) };
}

/** Directories end with `/` and get no trailing space, so the list keeps going into them. */
export function formatMention(path: string, kind: 'file' | 'directory'): string {
  const reference = /\s/.test(path) ? `@"${path}"` : `@${path}`;
  return kind === 'directory' ? reference : `${reference} `;
}
