import { describe, expect, it } from '@rstest/core';
import { render, screen } from '@testing-library/react';

import type { TeamMember } from '../../conversations/team-state.js';

import { WorkingIndicator } from './working-indicator.js';


const member = (role: string, roleName: string, state: TeamMember['state']): TeamMember => ({ role, roleName, state, steps: 0 });

describe('WorkingIndicator', () => {
  it('should say the CEO is thinking before anyone works', () => {
    render(<WorkingIndicator members={[member('CEO', 'CEO', 'idle')]} />);

    expect(screen.getByRole('status')).toHaveTextContent('CEO is thinking…');
  });

  it('should name the one agent at work', () => {
    render(<WorkingIndicator members={[member('CEO', 'CEO', 'working')]} />);
    expect(screen.getByRole('status')).toHaveTextContent('CEO is thinking…');
  });

  it('should name a delegate as working', () => {
    render(<WorkingIndicator members={[member('DEVELOPER', 'Developer', 'working')]} />);

    expect(screen.getByRole('status')).toHaveTextContent('Developer is working…');
  });

  it('should count several agents at work', () => {
    render(<WorkingIndicator members={[member('DEVELOPER', 'Developer', 'working'), member('GIT_OPS', 'Git Ops', 'working')]} />);

    expect(screen.getByRole('status')).toHaveTextContent('2 agents are working…');
  });
});
