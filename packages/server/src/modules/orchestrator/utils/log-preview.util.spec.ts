import { describe, expect, it } from '@rstest/core';

import { previewForLog } from './log-preview.util.js';


describe('log-preview.util', () => {
  it('should put the text on one line', () => {
    expect(previewForLog('  Build\n the   login ')).toBe('Build the login');
  });

  it('should cut a long text at 100 characters', () => {
    expect(previewForLog('a'.repeat(120))).toBe(`${'a'.repeat(100)}...`);
  });
});
