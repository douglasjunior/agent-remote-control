import { describe, expect, it } from 'vitest';

import { escapeTagAttribute, findCodeSpans, isInCode, parseTagAttributes, readTagBody } from './protocol-tag.util.js';


describe('protocol tag utils', () => {
  describe('parseTagAttributes', () => {
    it('should read quoted attributes in lower case, trimming their values', () => {
      const attributes = parseTagAttributes('<delegate>', ' ROLE=" DEVELOPER " project=\'app\'', ['role', 'project']);

      expect(attributes).toEqual(new Map([['role', 'DEVELOPER'], ['project', 'app']]));
    });

    it('should list the allowed attributes when one is unknown', () => {
      expect(parseTagAttributes('<attachment>', ' name="x"', ['path'])).toBe('Unknown attribute "name" in <attachment>. Use only "path".');
    });

    it('should say the tag takes no attributes when none are allowed', () => {
      expect(parseTagAttributes('<option>', ' value="1"', [])).toBe('Unknown attribute "value" in <option>. This tag takes no attributes.');
    });

    it('should reject attributes written without quotes', () => {
      expect(parseTagAttributes('<delegate role=X>', ' role=X', ['role'])).toBe('Malformed tag <delegate role=X>. Write each attribute as name="value".');
    });
  });

  describe('readTagBody', () => {
    it('should return the content up to the closing tag and the index after it', () => {
      expect(readTagBody('<a>body</A> rest', 'a', 3)).toEqual({ content: 'body', end: 11 });
    });

    it('should reject a body that never closes or opens another tag of the same name', () => {
      expect(readTagBody('<a>body', 'a', 3)).toBe('Every <a> must be closed with </a> before the next <a> starts.');
      expect(readTagBody('<a>one<a>two</a>', 'a', 3)).toBe('Every <a> must be closed with </a> before the next <a> starts.');
    });
  });

  it('should escape an attribute value into a single line', () => {
    expect(escapeTagAttribute(' Say "yes" &\n  go ')).toBe('Say &quot;yes&quot; &amp; go');
  });

  describe('findCodeSpans', () => {
    it('should find fenced blocks and inline spans', () => {
      const text = 'a `b` c\n```\n`d`\n```\ne';
      const spans = findCodeSpans(text);

      expect(spans.map(([start, end]) => text.slice(start, end))).toEqual(['`b`', '```\n`d`\n```']);
      expect(isInCode(text.indexOf('b'), spans)).toBe(true);
      expect(isInCode(text.indexOf('e'), spans)).toBe(false);
    });
  });
});
