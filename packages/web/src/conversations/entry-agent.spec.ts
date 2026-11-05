import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { describe, expect, it } from 'vitest';

import { entryAgent } from './entry-agent.js';
import { groupEntries } from './group-entries.js';


const AT = '2026-01-01T00:00:00.000Z';

const entries: Record<string, ConversationEntry> = {
  user: { id: 'u', at: AT, type: 'user_message', text: 'hi' },
  response: { id: 'r', at: AT, type: 'agent_response', status: 'completed', response: 'done' },
  interim: { id: 'i', at: AT, type: 'interim', text: 'working on it' },
  notice: { id: 'n', at: AT, type: 'notice', level: 'info', text: 'note' },
  question: {
    id: 'q', at: AT, type: 'question', askerRole: 'PRODUCT_OWNER', askerRoleName: 'Product Owner', text: 'Which?', options: [], number: 1, total: 1, closed: false,
  },
  step: { id: 't', at: AT, type: 'tool', role: 'DEVELOPER', title: 'Run tests', status: 'completed' },
  delegation: {
    id: 'd', at: AT, type: 'delegation', delegationId: '1:DEVELOPER', phase: 'started', round: 1, role: 'DEVELOPER', roleName: 'Developer', prompt: 'Do the work', summary: 'Build it',
  },
};

const agentOf = (key: string) => entryAgent(groupEntries([entries[key]!])[0]!);

describe('entryAgent', () => {
  it.each([
    ['response', 'CEO'],
    ['interim', 'CEO'],
    ['question', 'PRODUCT_OWNER'],
    ['step', 'DEVELOPER'],
  ])('attributes %s to %s', (key, role) => {
    expect(agentOf(key)).toBe(role);
  });

  it.each(['user', 'notice', 'delegation'])('attributes %s to nobody', (key) => {
    expect(agentOf(key)).toBeUndefined();
  });
});
