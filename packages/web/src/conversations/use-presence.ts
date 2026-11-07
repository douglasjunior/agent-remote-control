import { useEffect } from 'react';

import { agentIdentity } from '../lib/agent-identity.js';

import type { TeamMember } from './team-state.js';


function titleFor(members: readonly TeamMember[]): string | null {
  if (members.some(member => member.state === 'waiting')) {
    return '❓ Needs your answer';
  }
  const working = members.filter(member => member.state === 'working');
  if (working.length > 1) {
    return `🛠 ${working.length} agents working…`;
  }
  const [only] = working;
  if (!only) {
    return null;
  }
  return only.role === 'CEO' ? '💭 Thinking…' : `🛠 ${agentIdentity(only.role, only.roleName).label} working…`;
}

/**
 * Lets the user know from afar what the team is up to: the tab title tells who works or that an answer is needed,
 * the page light takes the color of the agent at work, and a notification (when the user already allowed them)
 * announces a question while the tab is hidden.
 */
export function usePresence(members: readonly TeamMember[]): void {
  const title = titleFor(members);
  const active = members.find(member => member.state === 'working' || member.state === 'waiting');
  const asking = members.find(member => member.state === 'waiting');
  const glowColor = active ? agentIdentity(active.role, active.roleName).color : null;

  useEffect(() => {
    if (title === null) {
      return;
    }
    const original = document.title;
    document.title = title;
    return () => {
      document.title = original;
    };
  }, [title]);

  useEffect(() => {
    if (glowColor === null) {
      return;
    }
    document.documentElement.style.setProperty('--glow-color', glowColor);
    return () => {
      document.documentElement.style.removeProperty('--glow-color');
    };
  }, [glowColor]);

  const askingRole = asking?.role;
  const askingSummary = asking?.summary;
  useEffect(() => {
    if (askingRole && document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification('Needs your answer', { body: askingSummary ?? agentIdentity(askingRole).label });
    }
  }, [askingRole, askingSummary]);
}
