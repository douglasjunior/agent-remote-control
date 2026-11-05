import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import type { InterruptedWork } from '@agent-remote-control/protocol/server-event';

import type { AgentMarkState } from '../components/agent/agent-mark.js';
import { agentIdentity, TEAM_ROLES } from '../lib/agent-identity.js';
import { toolLabel } from '../lib/tool-label.js';

import { openQuestion } from './open-question.js';


export interface TeamMember {
  readonly role: string;
  readonly roleName: string;
  readonly state: AgentMarkState;
  /** What the CEO asked the agent to do; present while the agent has a delegation in the current turn or one still running. */
  readonly summary?: string;
  readonly projectName?: string;
  /** Epoch milliseconds at which the agent started; present while it works or waits. */
  readonly startedAt?: number;
  /** Present once the agent has stopped. */
  readonly durationMs?: number;
  /** Thoughts and tool calls the agent produced in the current turn. */
  readonly steps: number;
  /** What the agent did last, in plain words. */
  readonly doing?: string;
  /** The work a server restart stopped for this agent, which the user can set going again. */
  readonly interruptedWorkId?: string;
}

const CEO_ROLE = 'CEO';

/**
 * The team as the current turn left it: every role of the team in order, then any other role delegated to.
 * A user message ends the turn that precedes it, except for delegations still open while a turn runs: the
 * coordinator accepts new messages while delegates keep working, so those stay in the team with their
 * activity. The agent whose question is still open is waiting, whatever was published after the question.
 * A delegation still open when no turn runs was cancelled or stopped by a restart, so its agent is idle. An open
 * question outlives a restart, which leaves its agent waiting with no turn running.
 */
export function deriveTeam(
  entries: readonly ConversationEntry[],
  running: boolean,
  interrupted: readonly InterruptedWork[] = [],
): readonly TeamMember[] {
  const delegates = new Map<string, { member: TeamMember; delegationId: string; open: boolean }>();
  const activity = new Map<string, { steps: number; doing: string }>();

  for (const entry of entries) {
    if (entry.type === 'user_message') {
      for (const [role, delegate] of delegates) {
        if (!running || !delegate.open) {
          delegates.delete(role);
        }
      }
      for (const role of activity.keys()) {
        if (!delegates.has(role)) {
          activity.delete(role);
        }
      }
    } else if ((entry.type === 'thought' && !entry.removed) || entry.type === 'tool') {
      activity.set(entry.role, {
        steps: (activity.get(entry.role)?.steps ?? 0) + 1,
        doing: entry.type === 'tool' ? toolLabel(entry.title) : 'Thinking',
      });
    } else if (entry.type === 'delegation') {
      const previous = delegates.get(entry.role);
      const base = { role: entry.role, roleName: entry.roleName, summary: entry.summary, projectName: entry.projectName ?? previous?.member.projectName, steps: 0 };
      if (entry.phase === 'started') {
        delegates.set(entry.role, {
          member: { ...base, state: running ? 'working' : 'idle', startedAt: Date.parse(entry.at) },
          delegationId: entry.delegationId,
          open: true,
        });
      } else if (previous?.delegationId === entry.delegationId) {
        delegates.set(entry.role, {
          member: {
            ...base,
            state: entry.phase === 'finished' ? 'done' : 'failed',
            ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
          },
          delegationId: entry.delegationId,
          open: false,
        });
      }
    }
  }

  const last = entries.at(-1);
  const asking = openQuestion(entries);
  const otherAsking = asking !== undefined && asking.askerRole !== CEO_ROLE;
  const othersBusy = otherAsking || [...delegates.values()].some(delegate => delegate.member.state === 'working');

  const roster = [...TEAM_ROLES, ...[...delegates.keys()].filter(role => !TEAM_ROLES.includes(role))];
  return roster.map((role): TeamMember => {
    const member = role === CEO_ROLE ? coordinator(running, othersBusy, last) : delegates.get(role)?.member;
    const identity = agentIdentity(role, member?.roleName);
    const found = activity.get(role);
    const base: TeamMember = { ...(member ?? { role, roleName: identity.label, state: 'idle', steps: 0 }), ...(found ? { steps: found.steps, doing: found.doing } : {}) };
    const waiting = asking?.askerRole === role;
    if (waiting) {
      return { ...base, state: 'waiting', startedAt: base.startedAt ?? Date.parse(asking.at) };
    }
    const stopped = interrupted.find(work => work.role === role);
    return stopped
      ? { ...base, state: 'idle', summary: stopped.summary || base.summary, ...(stopped.projectName ? { projectName: stopped.projectName } : {}), interruptedWorkId: stopped.id }
      : base;
  });
}

function coordinator(running: boolean, othersBusy: boolean, last: ConversationEntry | undefined): TeamMember {
  const base = { role: CEO_ROLE, roleName: agentIdentity(CEO_ROLE).label, steps: 0 };
  if (running) {
    return { ...base, state: othersBusy ? 'idle' : 'working' };
  }
  if (last?.type === 'agent_response') {
    if (last.status === 'completed') {
      return { ...base, state: 'done' };
    }
    if (last.status === 'failed') {
      return { ...base, state: 'failed' };
    }
  }
  return { ...base, state: 'idle' };
}
