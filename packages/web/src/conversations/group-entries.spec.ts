import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';

import { groupEntries } from './group-entries.js';


const at = '2026-01-01T00:00:00.000Z';
const thought = (id: string, removed?: boolean): ConversationEntry => ({ id, at, type: 'thought', role: 'CEO', text: id, removed });
const tool = (id: string, role = 'CEO'): ConversationEntry => ({ id, at, type: 'tool', role, title: id, status: 'completed' });
const user = (id: string): ConversationEntry => ({ id, at, type: 'user_message', text: id });

describe('groupEntries', () => {
  it('groups consecutive thoughts and tools and keeps other entries in order', () => {
    const items = groupEntries([user('u1'), thought('t1'), tool('x1'), thought('t2'), user('u2'), tool('x2')]);

    expect(items.map(item => item.kind)).toEqual(['entry', 'activity', 'entry', 'activity']);
    expect(items[1]).toMatchObject({ id: 'activity:t1', steps: [{ id: 't1' }, { id: 'x1' }, { id: 't2' }] });
    expect(items[3]).toMatchObject({ id: 'activity:x2', steps: [{ id: 'x2' }] });
  });

  it('starts a new activity item when another agent takes over', () => {
    const items = groupEntries([tool('x1'), tool('x2', 'DEVELOPER'), tool('x3', 'DEVELOPER'), tool('x4')]);

    expect(items.map(item => item.kind === 'activity' && item.steps.length)).toEqual([1, 2, 1]);
  });

  it('drops removed thoughts', () => {
    const items = groupEntries([thought('t1', true), tool('x1')]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'activity', steps: [{ id: 'x1' }] });
  });

  describe('delegations', () => {
    const delegation = (phase: 'started' | 'finished' | 'failed', role: string, round = 1, extra: object = {}): ConversationEntry => ({
      id: `d:${round}:${role}:${phase}`, at, type: 'delegation', delegationId: `${round}:${role}`, phase, round, role, roleName: role, prompt: 'Do the work', summary: `${role} summary`, ...extra,
    });

    it('joins the start and the end of a delegation into one handoff placed at its start', () => {
      const items = groupEntries([
        user('u1'),
        delegation('started', 'DEVELOPER', 1, { projectName: 'app' }),
        tool('x1'),
        delegation('finished', 'DEVELOPER', 1, { response: 'done', durationMs: 9000 }),
      ]);

      expect(items.map(item => item.kind)).toEqual(['entry', 'squad', 'activity']);
      expect(items[1]).toMatchObject({
        id: 'squad:d:1:DEVELOPER:started',
        handoffs: [{ role: 'DEVELOPER', summary: 'DEVELOPER summary', prompt: 'Do the work', projectName: 'app', status: 'done', response: 'done', durationMs: 9000, startedAt: Date.parse(at) }],
      });
    });

    it('files the steps of a delegated agent under its delegation instead of the feed', () => {
      const items = groupEntries([
        delegation('started', 'DEVELOPER'),
        delegation('started', 'CODE_REVIEWER'),
        tool('d1', 'DEVELOPER'),
        tool('r1', 'CODE_REVIEWER'),
        tool('d2', 'DEVELOPER'),
        tool('c1'),
        delegation('finished', 'DEVELOPER'),
        { id: 'gone', at, type: 'thought', role: 'DEVELOPER', text: 'x', removed: true },
      ]);

      expect(items.map(item => item.kind)).toEqual(['squad', 'activity']);
      expect(items[0]).toMatchObject({ handoffs: [{ role: 'DEVELOPER', steps: [{ id: 'd1' }, { id: 'd2' }] }, { role: 'CODE_REVIEWER', steps: [{ id: 'r1' }] }] });
      expect(items[1]).toMatchObject({ steps: [{ id: 'c1' }] });
    });

    it('pairs delegations by id, so two with the same round and role in different turns keep their own outcome', () => {
      const items = groupEntries([
        user('u1'),
        delegation('started', 'DEVELOPER', 1, { id: 's1', delegationId: 'dl-a' }),
        tool('a', 'DEVELOPER'),
        delegation('finished', 'DEVELOPER', 1, { id: 'f1', delegationId: 'dl-a', response: 'first' }),
        user('u2'),
        delegation('started', 'DEVELOPER', 1, { id: 's2', delegationId: 'dl-b' }),
        tool('b', 'DEVELOPER'),
        delegation('failed', 'DEVELOPER', 1, { id: 'f2', delegationId: 'dl-b', errorMessage: 'boom' }),
        user('u3'),
        delegation('started', 'DEVELOPER', 1, { id: 's3', delegationId: 'dl-c' }),
      ]);

      expect(items.map(item => item.kind)).toEqual(['entry', 'squad', 'entry', 'squad', 'entry', 'squad']);
      expect(items.filter(item => item.kind === 'squad').map(item => item.handoffs)).toMatchObject([
        [{ delegationId: 'dl-a', status: 'done', response: 'first', steps: [{ id: 'a' }] }],
        [{ delegationId: 'dl-b', status: 'failed', errorMessage: 'boom', steps: [{ id: 'b' }] }],
        [{ delegationId: 'dl-c', status: 'working' }],
      ]);
    });

    it('files steps of a second delegation of the same role under the second one', () => {
      const items = groupEntries([delegation('started', 'DEVELOPER', 1), tool('a', 'DEVELOPER'), delegation('started', 'DEVELOPER', 2), tool('b', 'DEVELOPER')]);

      expect(items).toMatchObject([
        { kind: 'squad', handoffs: [{ round: 1, steps: [{ id: 'a' }] }] },
        { kind: 'squad', handoffs: [{ round: 2, steps: [{ id: 'b' }] }] },
      ]);
    });

    it('keeps steps of an agent that was never delegated to in the feed', () => {
      expect(groupEntries([tool('x', 'DEVELOPER')]).map(item => item.kind)).toEqual(['activity']);
    });

    it('keeps a delegation without an end working', () => {
      const [item] = groupEntries([delegation('started', 'DEVELOPER')]);

      expect(item).toMatchObject({ handoffs: [{ status: 'working' }] });
      expect(item).not.toMatchObject({ handoffs: [{ durationMs: expect.anything() }] });
    });

    it('marks a delegation that failed with its reason', () => {
      const [item] = groupEntries([delegation('started', 'DEVELOPER'), delegation('failed', 'DEVELOPER', 1, { errorMessage: 'boom', durationMs: 5 })]);

      expect(item).toMatchObject({ handoffs: [{ status: 'failed', errorMessage: 'boom', durationMs: 5 }] });
    });

    it('gathers delegations that start together in one squad', () => {
      const items = groupEntries([
        delegation('started', 'DEVELOPER'),
        delegation('started', 'CODE_REVIEWER'),
        delegation('finished', 'CODE_REVIEWER'),
        delegation('finished', 'DEVELOPER'),
      ]);

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ handoffs: [{ role: 'DEVELOPER', status: 'done' }, { role: 'CODE_REVIEWER', status: 'done' }] });
    });

    it('starts a new squad for the next round', () => {
      const items = groupEntries([delegation('started', 'DEVELOPER', 1), delegation('started', 'CODE_REVIEWER', 2)]);

      expect(items.map(item => item.kind)).toEqual(['squad', 'squad']);
    });

    it('notes what the team did on the answer that closes the turn', () => {
      const answer: ConversationEntry = { id: 'r1', at: '2026-01-01T00:12:03.000Z', type: 'agent_response', status: 'completed', response: 'done' };
      const items = groupEntries([
        user('u0'),
        delegation('started', 'TECH_LEAD', 1),
        user('u1'),
        delegation('started', 'DEVELOPER', 2),
        delegation('started', 'DEVELOPER', 3),
        delegation('started', 'CODE_REVIEWER', 3),
        answer,
      ]);

      expect(items.map(item => item.kind)).toEqual(['entry', 'squad', 'entry', 'squad', 'squad', 'entry']);
      expect(items[5]).toMatchObject({ recap: { agents: 2, totalMs: 723_000 } });
    });

    it('notes the recap once, on the last answer, however many answers the turn gave', () => {
      const answer = (id: string): ConversationEntry => ({ id, at, type: 'agent_response', status: 'completed', response: id });
      const items = groupEntries([user('u'), delegation('started', 'DEVELOPER'), answer('progress'), delegation('finished', 'DEVELOPER'), answer('final')]);

      const recaps = items.flatMap(item => (item.kind === 'entry' && item.recap ? [item.entry.id] : []));
      expect(recaps).toEqual(['final']);
    });

    it('notes a recap on the last answer of every turn', () => {
      const answer = (id: string): ConversationEntry => ({ id, at, type: 'agent_response', status: 'completed', response: id });
      const items = groupEntries([
        user('u1'), delegation('started', 'DEVELOPER', 1), answer('a1'),
        user('u2'), delegation('started', 'TECH_LEAD', 2), answer('a2'),
      ]);

      const recaps = items.flatMap(item => (item.kind === 'entry' && item.recap ? [item.entry.id] : []));
      expect(recaps).toEqual(['a1', 'a2']);
    });

    it('notes no recap on a turn that delegated nothing or did not complete', () => {
      const failed: ConversationEntry = { id: 'r2', at, type: 'agent_response', status: 'failed', response: '' };
      const completed: ConversationEntry = { id: 'r3', at, type: 'agent_response', status: 'completed', response: 'ok' };

      expect(groupEntries([user('u'), delegation('started', 'DEVELOPER'), failed]).at(-1)).not.toHaveProperty('recap');
      expect(groupEntries([user('u'), completed]).at(-1)).not.toHaveProperty('recap');
    });

    it('drops an end that has no start', () => {
      expect(groupEntries([delegation('finished', 'DEVELOPER')])).toEqual([]);
    });
  });

  it('returns nothing for no entries', () => {
    expect(groupEntries([])).toEqual([]);
  });
});
