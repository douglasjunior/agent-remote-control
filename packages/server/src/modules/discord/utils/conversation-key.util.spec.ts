import type { Channel } from 'discord.js';
import { describe, expect, it } from 'vitest';

import { resolveConversationKey } from './conversation-key.util.js';


const channel = (id: string, isThread: boolean, parentId: string | null = null): Channel =>
  ({ id, isThread: () => isThread, parentId }) as unknown as Channel;

describe('resolveConversationKey', () => {
  it('should use the channel itself outside threads', () => {
    expect(resolveConversationKey('ch-1', channel('ch-1', false))).toEqual({ channelId: 'ch-1' });
  });

  it('should use the channel itself when the channel is not cached', () => {
    expect(resolveConversationKey('dm-1', null)).toEqual({ channelId: 'dm-1' });
  });

  it('should use the parent channel and the thread inside a thread', () => {
    expect(resolveConversationKey('th-1', channel('th-1', true, 'ch-1'))).toEqual({ channelId: 'ch-1', threadId: 'th-1' });
  });

  it('should fall back to the thread id when the thread has no parent', () => {
    expect(resolveConversationKey('th-1', channel('th-1', true))).toEqual({ channelId: 'th-1', threadId: 'th-1' });
  });
});
