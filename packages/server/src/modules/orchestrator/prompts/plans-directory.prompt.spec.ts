import { describe, expect, it } from 'vitest';

import { buildPlansDirectoryPrompt } from './plans-directory.prompt.js';


describe('buildPlansDirectoryPrompt', () => {
  it('should name the folder and authorize writing there', () => {
    expect(buildPlansDirectoryPrompt('/work/.plans/my-app')).toBe([
      '[PLANS_DIRECTORY]',
      'Folder for this task: /work/.plans/my-app',
      'Writing there is authorized as an exception to your working directory boundaries, and nothing else outside your working directory is.',
      '',
    ].join('\n'));
  });
});
