import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';

import { deriveTeam } from './team-state.js';


type Delegation = Extract<ConversationEntry, { type: 'delegation' }>;

const at = '2026-01-01T00:00:00.000Z';
const user: ConversationEntry = { id: 'u', at, type: 'user_message', text: 'build it' };
const delegation = (phase: Delegation['phase'], role: string, extra: Partial<Delegation> = {}): ConversationEntry => ({
  id: `d:${role}:${phase}`,
  at,
  type: 'delegation',
  delegationId: role,
  phase,
  round: 1,
  role,
  roleName: role,
  prompt: 'Do the work',
  summary: `${role} summary`,
  ...extra,
});
const response = (status: 'completed' | 'failed' | 'cancelled'): ConversationEntry => ({ id: 'r', at, type: 'agent_response', status, response: 'x' });
const stateOf = (team: ReturnType<typeof deriveTeam>, role: string) => team.find(member => member.role === role)!;

describe('deriveTeam', () => {
  it('lists the whole team, idle, when nothing happened', () => {
    const team = deriveTeam([], false);

    expect(team.map(member => member.role)).toEqual(['CEO', 'PRODUCT_OWNER', 'TECH_LEAD', 'DEVELOPER', 'CODE_REVIEWER', 'GIT_OPS']);
    expect(team.every(member => member.state === 'idle')).toBe(true);
  });

  it('has the coordinator working while a turn runs with nobody delegated', () => {
    expect(stateOf(deriveTeam([user], true), 'CEO').state).toBe('working');
  });

  it('puts delegates to work and rests the coordinator while they do', () => {
    const team = deriveTeam([user, delegation('started', 'DEVELOPER', { projectName: 'app' }), delegation('started', 'CODE_REVIEWER')], true);

    expect(stateOf(team, 'DEVELOPER')).toMatchObject({ state: 'working', summary: 'DEVELOPER summary', projectName: 'app', startedAt: Date.parse(at) });
    expect(stateOf(team, 'CODE_REVIEWER').state).toBe('working');
    expect(stateOf(team, 'CEO').state).toBe('idle');
    expect(stateOf(team, 'TECH_LEAD').state).toBe('idle');
  });

  it('marks a delegate done with its duration and keeps its project', () => {
    const team = deriveTeam([user, delegation('started', 'DEVELOPER', { projectName: 'app' }), delegation('finished', 'DEVELOPER', { durationMs: 5000 })], true);

    expect(stateOf(team, 'DEVELOPER')).toMatchObject({ state: 'done', durationMs: 5000, projectName: 'app' });
  });

  it('marks a delegate that failed', () => {
    const team = deriveTeam([user, delegation('started', 'DEVELOPER'), delegation('failed', 'DEVELOPER', { errorMessage: 'boom' })], true);

    expect(stateOf(team, 'DEVELOPER').state).toBe('failed');
  });

  it('restarts a delegate that is delegated to again', () => {
    const team = deriveTeam([user, delegation('finished', 'DEVELOPER', { durationMs: 1 }), delegation('started', 'DEVELOPER')], true);

    expect(stateOf(team, 'DEVELOPER')).toMatchObject({ state: 'working' });
    expect(stateOf(team, 'DEVELOPER')).not.toHaveProperty('durationMs');
  });

  it('shows the asker as waiting while the question is open', () => {
    const question: ConversationEntry = {
      id: 'q', at, type: 'question', askerRole: 'DEVELOPER', askerRoleName: 'Developer', text: 'Which?', options: [], number: 1, total: 1, closed: false,
    };

    const team = deriveTeam([user, delegation('started', 'DEVELOPER'), question], true);
    expect(stateOf(team, 'DEVELOPER')).toMatchObject({ state: 'waiting', summary: 'DEVELOPER summary' });

    const coordinatorAsks = deriveTeam([user, { ...question, askerRole: 'CEO' }], true);
    expect(stateOf(coordinatorAsks, 'CEO')).toMatchObject({ state: 'waiting', startedAt: Date.parse(at) });
  });

  it('keeps the asker waiting while entries follow its open question', () => {
    const question: ConversationEntry = {
      id: 'q', at, type: 'question', askerRole: 'DEVELOPER', askerRoleName: 'Developer', text: 'Which?', options: [], number: 1, total: 1, closed: false,
    };
    const later: ConversationEntry[] = [{ ...user, id: 'u2' }, { id: 'n', at, type: 'notice', level: 'info', text: 'x' }, response('completed')];

    const open = deriveTeam([user, delegation('started', 'DEVELOPER'), question, ...later], true);
    const closed = deriveTeam([user, delegation('started', 'DEVELOPER'), { ...question, closed: true }, ...later], true);

    expect(stateOf(open, 'DEVELOPER').state).toBe('waiting');
    expect(stateOf(open, 'CEO').state).toBe('idle');
    expect(stateOf(closed, 'DEVELOPER').state).toBe('working');

    const askedOnly = deriveTeam([user, question, ...later], true);
    const askedAndClosed = deriveTeam([user, { ...question, closed: true }, ...later], true);
    expect(stateOf(askedOnly, 'CEO').state).toBe('idle');
    expect(stateOf(askedAndClosed, 'CEO').state).toBe('working');
  });

  it('tells what each agent did last and how many steps it took', () => {
    const step = (id: string, role: string, title?: string): ConversationEntry => title
      ? { id, at, type: 'tool', role, title, status: 'completed' }
      : { id, at, type: 'thought', role, text: 'hmm' };
    const team = deriveTeam([
      user,
      delegation('started', 'DEVELOPER'),
      step('a', 'DEVELOPER', 'Read file'),
      step('b', 'DEVELOPER'),
      step('c', 'CODE_REVIEWER', 'pnpm test'),
      { id: 'gone', at, type: 'thought', role: 'DEVELOPER', text: 'x', removed: true },
    ], true);

    expect(stateOf(team, 'DEVELOPER')).toMatchObject({ steps: 2, doing: 'Thinking' });
    expect(stateOf(team, 'CODE_REVIEWER')).toMatchObject({ steps: 1, doing: 'Running tests' });
    expect(stateOf(team, 'GIT_OPS')).toMatchObject({ steps: 0 });
    expect(stateOf(team, 'GIT_OPS')).not.toHaveProperty('doing');
  });

  it('forgets the delegations of earlier turns', () => {
    const team = deriveTeam([user, delegation('finished', 'DEVELOPER'), response('completed'), { ...user, id: 'u2' }], true);

    expect(stateOf(team, 'DEVELOPER').state).toBe('idle');
  });

  describe('across user messages', () => {
    const next = { ...user, id: 'u2' };
    const question: ConversationEntry = {
      id: 'q', at, type: 'question', askerRole: 'DEVELOPER', askerRoleName: 'Developer', text: 'Which?', options: [], number: 1, total: 1, closed: false,
    };

    it('keeps a delegation still open working after a new user message while a turn runs', () => {
      const step: ConversationEntry = { id: 's', at, type: 'tool', role: 'DEVELOPER', title: 'Read file', status: 'completed' };
      const team = deriveTeam([user, delegation('started', 'DEVELOPER', { projectName: 'app' }), step, next], true);

      expect(stateOf(team, 'DEVELOPER')).toMatchObject({ state: 'working', summary: 'DEVELOPER summary', projectName: 'app', steps: 1, doing: 'Reading files' });
      expect(stateOf(team, 'CEO').state).toBe('idle');
    });

    it('drops a closed delegation at a new user message', () => {
      const step: ConversationEntry = { id: 's', at, type: 'tool', role: 'DEVELOPER', title: 'Read file', status: 'completed' };
      const team = deriveTeam([user, delegation('started', 'DEVELOPER'), step, delegation('finished', 'DEVELOPER'), next], true);

      expect(stateOf(team, 'DEVELOPER')).toMatchObject({ state: 'idle', steps: 0 });
      expect(stateOf(team, 'DEVELOPER')).not.toHaveProperty('summary');
    });

    it('counts only the current turn for an agent without an open delegation', () => {
      const step = (id: string): ConversationEntry => ({ id, at, type: 'tool', role: 'CODE_REVIEWER', title: 'Read file', status: 'completed' });
      const team = deriveTeam([user, step('a'), step('b'), next, step('c')], true);

      expect(stateOf(team, 'CODE_REVIEWER').steps).toBe(1);
    });

    it('lets a kept delegation close in a later turn and ignores the end of a replaced one', () => {
      const closed = deriveTeam([user, delegation('started', 'DEVELOPER'), next, delegation('finished', 'DEVELOPER', { durationMs: 7 })], true);
      expect(stateOf(closed, 'DEVELOPER')).toMatchObject({ state: 'done', durationMs: 7 });

      const replaced = deriveTeam([
        delegation('started', 'DEVELOPER', { delegationId: 'old' }),
        delegation('started', 'DEVELOPER', { delegationId: 'new' }),
        delegation('finished', 'DEVELOPER', { delegationId: 'old' }),
      ], true);
      expect(stateOf(replaced, 'DEVELOPER').state).toBe('working');
    });

    it('drops open delegations at a new user message once no turn runs', () => {
      const team = deriveTeam([user, delegation('started', 'DEVELOPER'), next], false);

      expect(stateOf(team, 'DEVELOPER').state).toBe('idle');
      expect(stateOf(team, 'DEVELOPER')).not.toHaveProperty('summary');
    });

    it('does not show the coordinator working while another agent waits for an answer', () => {
      const team = deriveTeam([user, delegation('started', 'DEVELOPER'), next, question], true);
      expect(stateOf(team, 'DEVELOPER').state).toBe('waiting');
      expect(stateOf(team, 'CEO').state).toBe('idle');

      const unknownAsker = deriveTeam([user, { ...question, askerRole: 'GIT_OPS' }], true);
      expect(stateOf(unknownAsker, 'GIT_OPS').state).toBe('waiting');
      expect(stateOf(unknownAsker, 'CEO').state).toBe('idle');
    });
  });

  it('rests an agent whose delegation was cancelled', () => {
    const team = deriveTeam([user, delegation('started', 'DEVELOPER'), response('cancelled')], false);

    expect(stateOf(team, 'DEVELOPER').state).toBe('idle');
    expect(stateOf(team, 'CEO').state).toBe('idle');
  });

  it('shows how the turn ended on the coordinator', () => {
    expect(stateOf(deriveTeam([user, response('completed')], false), 'CEO').state).toBe('done');
    expect(stateOf(deriveTeam([user, response('failed')], false), 'CEO').state).toBe('failed');
  });

  it('adds a role outside the team after the team', () => {
    const team = deriveTeam([user, delegation('started', 'DESIGNER', { roleName: 'Designer Agent' })], true);

    expect(team.at(-1)).toMatchObject({ role: 'DESIGNER', roleName: 'Designer Agent', state: 'working' });
  });

  it('keeps an agent waiting on a question a restart left open, with no turn running', () => {
    const question: ConversationEntry = { id: 'q', at, type: 'question', askerRole: 'DEVELOPER', askerRoleName: 'DEVELOPER', text: 'Which?', options: [], number: 1, total: 1, closed: false };

    const team = deriveTeam([user, delegation('started', 'DEVELOPER'), question], false);

    expect(team.find(member => member.role === 'DEVELOPER')).toMatchObject({ state: 'waiting' });
  });

  it('marks an agent a restart stopped, taking its summary and project', () => {
    const work = { id: 'w', role: 'DEVELOPER', roleName: 'DEVELOPER', projectName: 'app', summary: 'Build' };

    const team = deriveTeam([user, delegation('started', 'DEVELOPER')], false, [work]);

    expect(team.find(member => member.role === 'DEVELOPER')).toMatchObject({ state: 'idle', summary: 'Build', projectName: 'app', interruptedWorkId: 'w' });
  });

  it('marks a stopped coordinator, which has no summary or project of its own', () => {
    const work = { id: 'c', role: 'CEO', roleName: 'CEO', projectName: null, summary: '' };

    const team = deriveTeam([user], false, [work]);

    expect(team.find(member => member.role === 'CEO')).toMatchObject({ state: 'idle', interruptedWorkId: 'c' });
  });
});
