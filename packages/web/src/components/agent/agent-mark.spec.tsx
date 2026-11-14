import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TEAM_ROLES } from '../../lib/agent-identity.js';

import { AgentMark } from './agent-mark.js';


describe('AgentMark', () => {
  it('should name the agent and its state for assistive technology', () => {
    render(<AgentMark role="DEVELOPER" state="working" />);

    expect(screen.getByRole('img', { name: 'Developer, working' })).toHaveAttribute('data-state', 'working');
  });

  it('should be idle by default and show no badge', () => {
    const { container } = render(<AgentMark role="CEO" />);

    expect(screen.getByRole('img', { name: 'Coordinator, idle' })).toBeInTheDocument();
    expect(container.querySelector('.mark-badge')).toBeNull();
  });

  it('should draw a different glyph for each role of the team', () => {
    const glyphs = TEAM_ROLES.map((role) => {
      const { container, unmount } = render(<AgentMark role={role} />);
      const glyph = container.querySelector('svg')!.innerHTML;
      unmount();
      return glyph;
    });

    expect(new Set(glyphs).size).toBe(TEAM_ROLES.length);
  });

  it('should draw the generic glyph for an unknown role and use its name', () => {
    const { container } = render(<AgentMark role="DESIGNER" roleName="Designer Agent" size="sm" />);

    expect(screen.getByRole('img', { name: 'Designer Agent, idle' })).toHaveAttribute('data-mark', 'generic');
    expect(container.querySelectorAll('circle')).toHaveLength(2);
  });

  it('should badge a finished agent with a check and a failed one with a cross', () => {
    const done = render(<AgentMark role="GIT_OPS" state="done" size="lg" />);
    expect(done.container.querySelector('.mark-badge')).toHaveClass('bg-good');
    done.unmount();

    const failed = render(<AgentMark role="GIT_OPS" state="failed" />);
    expect(failed.container.querySelector('.mark-badge')).toHaveClass('bg-destructive');
  });

  it('should label a waiting agent as waiting for the user and mute it on request', () => {
    render(<AgentMark role="PRODUCT_OWNER" state="waiting" dim />);

    expect(screen.getByRole('img', { name: 'Product Owner, waiting for you' })).toHaveClass('saturate-[.45]');
  });
});
