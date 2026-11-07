import { describe, expect, it } from 'vitest';

import { stripAnsi } from './strip-ansi.util.js';


describe('stripAnsi', () => {
  it('should remove color and cursor sequences', () => {
    expect(stripAnsi('\u001B[90m│\u001B[39m \u001B[36m◆\u001B[39m ready')).toBe('│ ◆ ready');
  });

  it('should remove operating system commands ended by a bell', () => {
    expect(stripAnsi('\u001B]0;title\u0007text')).toBe('text');
  });

  it('should keep plain text', () => {
    expect(stripAnsi('plain')).toBe('plain');
  });
});
