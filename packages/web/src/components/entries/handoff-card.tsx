import { ChevronRight } from 'lucide-react';
import type { CSSProperties } from 'react';

import type { Handoff } from '../../conversations/group-entries.js';
import { agentIdentity } from '../../lib/agent-identity.js';
import { formatDuration } from '../../lib/format.js';
import { useNow } from '../../lib/use-now.js';
import { cn } from '../../lib/utils.js';
import { AgentMark, type AgentMarkState } from '../agent/agent-mark.js';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible.js';

import { ActivitySteps } from './activity-group.js';
import { Markdown } from './markdown.js';


const ROW_CLASSES = 'flex w-full items-center gap-[11px] px-[13px] py-2.5 text-left outline-none';

function HandoffRow({ handoff, running, open, dimmed, onOpenChange, onHover }: {
  readonly handoff: Handoff;
  readonly running: boolean;
  readonly open: boolean;
  readonly dimmed: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onHover: (role: string | null) => void;
}) {
  const { label, color } = agentIdentity(handoff.role, handoff.roleName);
  const working = handoff.status === 'working' && running;
  const stopped = handoff.status === 'working' && !running;
  const now = useNow(working);
  const hasDetails = handoff.response !== undefined || handoff.errorMessage !== undefined || handoff.steps.length > 0;
  const markState: AgentMarkState = working ? 'working' : stopped ? 'idle' : handoff.status === 'working' ? 'idle' : handoff.status;
  const time = working
    ? formatDuration(Math.max(0, now - handoff.startedAt))
    : stopped
      ? 'Stopped'
      : `${handoff.status === 'failed' ? 'Failed · ' : ''}${formatDuration(handoff.durationMs ?? 0)}`;

  const summary = (
    <>
      <AgentMark role={handoff.role} roleName={handoff.roleName} state={markState} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block leading-[1.3] font-medium" title={handoff.projectName}>{handoff.summary}</span>
        <span className="block text-[12.5px] text-muted-foreground">{label}</span>
      </span>
      <span className="font-mono text-[12.5px] whitespace-nowrap text-muted-foreground tabular-nums">{time}</span>
    </>
  );

  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      data-status={stopped ? 'stopped' : handoff.status}
      data-dimmed={dimmed}
      onMouseEnter={() => onHover(handoff.role)}
      onMouseLeave={() => onHover(null)}
      style={{ '--c': color } as CSSProperties}
      className={cn(
        'overflow-hidden rounded-[13px] border bg-card text-sm transition-[border-color,opacity] duration-300 sm:ml-[46px]',
        working && 'border-[color-mix(in_oklab,var(--c)_55%,var(--border))]',
        dimmed && 'opacity-30',
      )}
    >
      {hasDetails
        ? (
          <CollapsibleTrigger
            aria-label={handoff.status === 'failed' ? 'See what went wrong' : handoff.response ? 'See the result' : 'See the steps'}
            className={cn(ROW_CLASSES, 'group hover:bg-[color-mix(in_oklab,var(--c)_7%,transparent)] focus-visible:ring-[3px] focus-visible:ring-ring/50')}
          >
            {summary}
            <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-250 group-data-[panel-open]:rotate-90" />
          </CollapsibleTrigger>
        )
        : <div className={ROW_CLASSES}>{summary}</div>}
      {hasDetails && (
        <CollapsibleContent className="flex flex-col gap-2.5 px-[13px] pt-0.5 pb-[13px] text-sm text-muted-foreground">
          {handoff.steps.length > 0 && <ActivitySteps steps={handoff.steps} />}
          {handoff.response && <Markdown text={handoff.response} className="text-foreground" />}
          {handoff.errorMessage && <p className="text-destructive">{handoff.errorMessage}</p>}
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

/** The agents the CEO put to work together, one row each; the present moment is the squad panel. */
export function SquadCard({ handoffs, running, focus, expanded, onExpandedChange, onHover }: {
  readonly handoffs: readonly Handoff[];
  readonly running: boolean;
  readonly focus: string | null;
  readonly expanded: ReadonlySet<string>;
  readonly onExpandedChange: (id: string, open: boolean) => void;
  readonly onHover: (role: string | null) => void;
}) {
  return (
    <section aria-label="Delegation" className="flex flex-col gap-1.5">
      {handoffs.map(handoff => (
        <HandoffRow
          key={handoff.id}
          handoff={handoff}
          running={running}
          open={expanded.has(handoff.id)}
          dimmed={focus !== null && focus !== handoff.role}
          onOpenChange={open => onExpandedChange(handoff.id, open)}
          onHover={onHover}
        />
      ))}
    </section>
  );
}
