import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';

import { earlierPageStart, latestPageStart } from './history-page.util.js';


const at = '2026-01-01T00:00:00.000Z';
const user = (id: string): ConversationEntry => ({ id, at, type: 'user_message', text: id });
const step = (id: string): ConversationEntry => ({ id, at, type: 'tool', role: 'DEVELOPER', title: id, status: 'completed' });
const delegation = (delegationId: string, phase: 'started' | 'finished'): ConversationEntry => ({
  id: `${delegationId}:${phase}`, at, type: 'delegation', delegationId, phase, round: 1, role: 'DEVELOPER', roleName: 'Developer', prompt: '', summary: '',
});
const question = (id: string, closed: boolean): ConversationEntry => ({
  id, at, type: 'question', askerRole: 'PRODUCT_OWNER', askerRoleName: 'Product Owner', text: id, options: [], number: 1, total: 1, closed,
});

/** Three segments of three entries: positions 0, 3 and 6 start them. */
const segments = [user('u1'), step('a'), step('b'), user('u2'), step('c'), step('d'), user('u3'), step('e'), step('f')];
const none = new Set<string>();

describe('latestPageStart', () => {
  it('should take the last segments that fit the size', () => {
    expect(latestPageStart(segments, { size: 6, liveDelegations: none })).toBe(3);
    expect(latestPageStart(segments, { size: 100, liveDelegations: none })).toBe(0);
  });

  it('should take the last segment whole when it alone is longer than the size', () => {
    expect(latestPageStart(segments, { size: 2, liveDelegations: none })).toBe(6);
  });

  it('should start an empty history at 0', () => {
    expect(latestPageStart([], { size: 2, liveDelegations: none })).toBe(0);
  });

  it('should count the entries before the first user message as a segment', () => {
    expect(latestPageStart([step('a'), user('u1'), step('b')], { size: 1, liveDelegations: none })).toBe(1);
    expect(latestPageStart([step('a'), step('b')], { size: 1, liveDelegations: none })).toBe(0);
  });

  it('should reach back to the oldest question still open', () => {
    const entries = [user('u1'), question('q1', true), user('u2'), question('q2', false), user('u3'), step('a'), user('u4')];

    expect(latestPageStart(entries, { size: 1, liveDelegations: none })).toBe(2);
  });

  it('should never start inside a delegation that a user message interrupted', () => {
    const entries = [user('u1'), delegation('d', 'started'), user('u2'), step('a'), delegation('d', 'finished'), user('u3'), step('b')];

    expect(latestPageStart(entries, { size: 3, liveDelegations: none })).toBe(5);
    expect(latestPageStart(entries, { size: 7, liveDelegations: none })).toBe(0);
  });

  it('should keep a delegation still running with everything after it', () => {
    const entries = [user('u1'), delegation('d', 'started'), user('u2'), step('a'), user('u3'), step('b')];

    expect(latestPageStart(entries, { size: 2, liveDelegations: new Set(['d']) })).toBe(0);
  });

  it('should let a delegation a restart stopped span nothing', () => {
    const entries = [user('u1'), delegation('d', 'started'), user('u2'), step('a'), user('u3'), step('b')];

    expect(latestPageStart(entries, { size: 2, liveDelegations: none })).toBe(4);
  });
});

describe('earlierPageStart', () => {
  it('should take the segments right before the position that fit the size', () => {
    expect(earlierPageStart(segments, 6, { size: 3, liveDelegations: none })).toBe(3);
    expect(earlierPageStart(segments, 6, { size: 6, liveDelegations: none })).toBe(0);
  });

  it('should take one whole segment when it alone is longer than the size', () => {
    expect(earlierPageStart(segments, 6, { size: 1, liveDelegations: none })).toBe(3);
  });

  it('should read a position past the end as the end of the history', () => {
    expect(earlierPageStart(segments, 50, { size: 3, liveDelegations: none })).toBe(6);
  });
});
