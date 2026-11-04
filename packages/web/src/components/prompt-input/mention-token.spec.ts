import { findMentionAtCursor, formatMention } from './mention-token.js';


describe('findMentionAtCursor', () => {
  it('finds a bare @ at the start of the text', () => {
    expect(findMentionAtCursor('@', 1)).toEqual({ start: 0, end: 1, query: '' });
  });

  it('reads the query between the @ and the cursor, and the token end after it', () => {
    expect(findMentionAtCursor('see @app/src now', 8)).toEqual({ start: 4, end: 12, query: 'app' });
  });

  it('finds the @ after whitespace and after a line break', () => {
    expect(findMentionAtCursor('a\n@b', 4)).toEqual({ start: 2, end: 4, query: 'b' });
  });

  it.each([
    ['an @ inside a word', 'mail@host', 9],
    ['no @', 'plain text', 5],
    ['whitespace between the @ and the cursor', '@a b', 4],
    ['the cursor before the @', 'x @a', 1],
    ['an empty text', '', 0],
  ])('returns null for %s', (_label, value, cursor) => {
    expect(findMentionAtCursor(value, cursor)).toBeNull();
  });
});

describe('formatMention', () => {
  it('adds a trailing space after a file', () => {
    expect(formatMention('app/a.ts', 'file')).toBe('@app/a.ts ');
  });

  it('leaves a directory open so the list keeps going into it', () => {
    expect(formatMention('app/', 'directory')).toBe('@app/');
  });

  it('quotes a path with whitespace', () => {
    expect(formatMention('my app/a b.ts', 'file')).toBe('@"my app/a b.ts" ');
  });
});
