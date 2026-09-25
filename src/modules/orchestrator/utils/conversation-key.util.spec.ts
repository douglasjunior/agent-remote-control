import { describe, expect, it } from 'vitest';

import { buildConversationKey } from './conversation-key.util.js';


describe('buildConversationKey', () => {
  it('should combine the channel and the thread', () => {
    expect(buildConversationKey('ch-1', 'th-1')).toBe('ch-1:th-1');
  });

  it('should keep an empty thread segment outside threads', () => {
    expect(buildConversationKey('ch-1')).toBe('ch-1:');
  });
});
