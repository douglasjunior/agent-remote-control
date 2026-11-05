import { describe, expect, it } from 'vitest';

import type { TeamMember } from '../../conversations/team-state.js';

import { squadStatus } from './squad-status.js';


const member = (role: string, state: TeamMember['state']): TeamMember => ({ role, roleName: role, state, steps: 0 });

describe('squadStatus', () => {
  it('is ready when everyone is idle', () => {
    expect(squadStatus([member('CEO', 'idle'), member('DEVELOPER', 'idle')])).toEqual({ live: false, text: 'Ready', tab: 'Squad' });
  });

  it('tallies the agents at work', () => {
    expect(squadStatus([member('CEO', 'idle'), member('DEVELOPER', 'working'), member('GIT_OPS', 'working')]))
      .toEqual({ live: true, text: '2 working', tab: 'Squad · 2 working' });
  });

  it('puts the question first on the tab', () => {
    expect(squadStatus([member('DEVELOPER', 'working'), member('PRODUCT_OWNER', 'waiting')]))
      .toEqual({ live: true, text: '1 working · needs your answer', tab: 'Squad · needs your answer' });
  });

  it('says the answer was delivered once the coordinator is done', () => {
    expect(squadStatus([member('CEO', 'done'), member('DEVELOPER', 'done')]).text).toBe('Answer delivered');
  });

  it('says something failed', () => {
    expect(squadStatus([member('CEO', 'idle'), member('DEVELOPER', 'failed')]).text).toBe('Something failed');
  });

  it('says how many agents stopped, without counting as live', () => {
    const stopped = { ...member('DEVELOPER', 'idle'), interruptedWorkId: 'w' };

    expect(squadStatus([member('CEO', 'idle'), stopped])).toEqual({ live: false, text: '1 stopped', tab: 'Squad' });
    expect(squadStatus([member('CEO', 'working'), stopped]).text).toBe('1 working · 1 stopped');
  });
});
