import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';

import { groupEntries } from './group-entries.js';


const at = '2026-01-01T00:00:00.000Z';
const thought = (id: string, removed?: boolean): ConversationEntry => ({ id, at, type: 'thought', text: id, removed });
const tool = (id: string): ConversationEntry => ({ id, at, type: 'tool', title: id, status: 'completed' });
const user = (id: string): ConversationEntry => ({ id, at, type: 'user_message', text: id });

describe('groupEntries', () => {
  it('groups consecutive thoughts and tools and keeps other entries in order', () => {
    const items = groupEntries([user('u1'), thought('t1'), tool('x1'), thought('t2'), user('u2'), tool('x2')]);

    expect(items.map(item => item.kind)).toEqual(['entry', 'activity', 'entry', 'activity']);
    expect(items[1]).toMatchObject({ id: 'activity:t1', steps: [{ id: 't1' }, { id: 'x1' }, { id: 't2' }] });
    expect(items[3]).toMatchObject({ id: 'activity:x2', steps: [{ id: 'x2' }] });
  });

  it('drops removed thoughts', () => {
    const items = groupEntries([thought('t1', true), tool('x1')]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'activity', steps: [{ id: 'x1' }] });
  });

  it('returns nothing for no entries', () => {
    expect(groupEntries([])).toEqual([]);
  });
});
