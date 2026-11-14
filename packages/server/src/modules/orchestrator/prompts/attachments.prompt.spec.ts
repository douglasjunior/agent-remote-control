import { describe, expect, it } from 'vitest';

import { buildAttachmentsPrompt } from './attachments.prompt.js';


describe('attachments.prompt', () => {
  it('should keep a message without attachments as it is', () => {
    expect(buildAttachmentsPrompt('Hi')).toBe('Hi');
    expect(buildAttachmentsPrompt('Hi', [])).toBe('Hi');
  });

  it('should list each file before the message', () => {
    expect(buildAttachmentsPrompt('Look', [{ name: 'a.txt', path: '/tmp/a.txt', contentType: 'text/plain', size: 3 }])).toBe(
      '[ATTACHMENTS]\n- Name: a.txt\n  Size: 3 bytes\n  Type: text/plain\n  Path: /tmp/a.txt\nInspect these files using your available tools as needed.\n\nLook',
    );
  });
});
