import type { CSSProperties } from 'react';

import type { TeamMember } from '../../conversations/team-state.js';
import { agentIdentity } from '../../lib/agent-identity.js';
import { formatDuration } from '../../lib/format.js';
import { cn } from '../../lib/utils.js';
import { AgentMark, type AgentMarkState } from '../agent/agent-mark.js';
import { Button } from '../ui/button.js';


const COORDINATOR = 'CEO';

function present(member: TeamMember, delegating: boolean): { state: AgentMarkState; line: string; action?: string } {
  const { tagline } = agentIdentity(member.role, member.roleName);
  if (member.role !== COORDINATOR) {
    return { state: member.state, line: member.summary ?? tagline, action: member.doing ?? 'Starting' };
  }
  switch (member.state) {
    case 'working': return { state: 'working', line: 'Thinking', action: member.doing ?? 'Thinking' };
    case 'waiting': return { state: 'waiting', line: 'Asking you' };
    case 'done': return { state: 'done', line: 'Answer delivered' };
    case 'failed': return { state: 'failed', line: 'Hit a problem' };
    case 'idle': return delegating
      ? { state: 'working', line: 'Coordinating the squad', action: 'Waiting on the squad' }
      : { state: 'idle', line: tagline };
  }
}

function timeOf(member: TeamMember, state: AgentMarkState, now: number): string | undefined {
  if ((state === 'working' || state === 'waiting') && member.startedAt !== undefined) {
    return formatDuration(Math.max(0, now - member.startedAt));
  }
  return member.durationMs === undefined ? undefined : formatDuration(member.durationMs);
}

/**
 * One role of the squad: mark, name, stage, time, a summary clamped to two lines and one ticker line with the latest
 * action. Selecting it reveals the role's responsibility; nothing here grows with the length of the conversation.
 */
export function Station({ member, index, now, delegating, selected, highlighted, onSelect, onContinue }: {
  readonly member: TeamMember;
  readonly index: number;
  readonly now: number;
  /** Whether other agents are at work, which keeps the Coordinator active although it is not itself working. */
  readonly delegating: boolean;
  readonly selected: boolean;
  readonly highlighted: boolean;
  readonly onSelect: (role: string) => void;
  readonly onContinue: (workId: string) => void;
}) {
  const { label, stage, color, responsibility } = agentIdentity(member.role, member.roleName);
  const { state, line, action } = present(member, delegating);
  const time = timeOf(member, state, now);
  const { interruptedWorkId } = member;

  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        data-state={state}
        data-role={member.role}
        onClick={() => onSelect(member.role)}
        style={{ '--c': color, '--i': index } as CSSProperties}
        className={cn(
          'grid w-full grid-cols-[60px_minmax(0,1fr)] rounded-[15px] py-3 pr-2.5 text-left outline-none transition-colors duration-300 hover:bg-foreground/5 focus-visible:ring-[3px] focus-visible:ring-ring/50',
          'data-[state=working]:bg-[color-mix(in_oklab,var(--c)_9%,transparent)] data-[state=waiting]:bg-[color-mix(in_oklab,var(--c)_9%,transparent)]',
          selected && 'bg-[color-mix(in_oklab,var(--c)_9%,transparent)]',
          highlighted && 'bg-[color-mix(in_oklab,var(--c)_14%,transparent)]',
        )}
      >
        <span data-lens={member.role} className="relative z-10 flex justify-center">
          <AgentMark role={member.role} roleName={member.roleName} state={state} dim={state === 'idle'} size="lg" />
        </span>
        <span className="block min-w-0 pl-3">
          <span className="flex items-baseline gap-2">
            <span className={cn('font-heading text-[15.5px] leading-[1.3] font-semibold', state === 'idle' && !selected && 'text-muted-foreground')}>{label}</span>
            <span className="text-[11.5px] tracking-[.05em] text-muted-foreground/80 uppercase">{stage}</span>
            {time && <span className="ml-auto font-mono text-[12.5px] whitespace-nowrap text-muted-foreground tabular-nums">{time}</span>}
          </span>
          <span className={cn('line-clamp-2 block text-sm leading-[1.4] text-muted-foreground', (state === 'working' || state === 'waiting') && 'font-medium text-foreground')}>{line}</span>
          {state === 'working' && action && (
            <span className="mt-[7px] flex min-h-[18px] items-center gap-2 font-mono text-[12.5px] leading-[1.4] text-(--c)">
              <span aria-hidden className="inline-flex h-[11px] items-end gap-0.5">
                {[0, 1, 2].map(bar => <i key={bar} className="squad-ticker-bar h-full w-0.5 origin-bottom bg-(--c)" />)}
              </span>
              <span key={action} className="squad-ticker-text min-w-0 truncate">{action}</span>
            </span>
          )}
          {state === 'waiting' && <span className="mt-[7px] block text-[13px] font-semibold text-attention">Waiting for your answer</span>}
          {state === 'failed' && <span className="mt-[7px] block text-[13px] font-semibold text-destructive">Failed</span>}
          {selected && (
            <span className="mt-[9px] block text-[13.5px] text-muted-foreground motion-safe:animate-in motion-safe:fade-in">
              <span className="mb-px block text-[11.5px] font-medium tracking-[.05em] text-muted-foreground/80 uppercase">Responsibility</span>
              {responsibility}
            </span>
          )}
        </span>
      </button>
      {interruptedWorkId !== undefined && (
        <div className="flex items-center justify-between gap-2 pr-2.5 pb-2 pl-[72px]">
          <span className="text-[13px] font-semibold text-attention">Interrupted unexpectedly</span>
          <Button size="sm" variant="outline" aria-label={`Continue ${label}`} onClick={() => onContinue(interruptedWorkId)}>Continue</Button>
        </div>
      )}
    </li>
  );
}
