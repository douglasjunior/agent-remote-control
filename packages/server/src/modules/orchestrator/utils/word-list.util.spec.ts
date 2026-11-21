import { describe, expect, it } from '@rstest/core';

import { formatWordList } from './word-list.util.js';


describe('formatWordList', () => {
  it.each([
    [[], ''],
    [['business'], 'business'],
    [['business', 'technical'], 'business and technical'],
    [['business', 'design', 'technical'], 'business, design and technical'],
  ])('should join %j as %j', (items, expected) => {
    expect(formatWordList(items)).toBe(expected);
  });
});
