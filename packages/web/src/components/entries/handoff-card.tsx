import { ChevronRight, SquareCheck } from 'lucide-react';
import type { CSSProperties } from 'react';
import { Link, useParams } from 'react-router';

import { artifactPath } from '../../artifacts/artifact-paths.js';
import type { Handoff, HandoffStatus } from '../../conversations/group-entries.js';
import { agentIdentity } from '../../lib/agent-identity.js';
import { formatDuration } from '../../lib/format.js';
import { useNow } from '../../lib/use-now.js';
import { cn } from '../../lib/utils.js';
import { AgentMark, type AgentMarkState } from '../agent/agent-mark.js';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible.js';

import { ActivitySteps } from './activity-group.js';
import { Markdown } from './markdown.js';


const RESTING_MARK: Record<HandoffStatus, AgentMarkState> = { working: 'idle', done: 'done', failed: 'failed', cancelled: 'idle' };

function triggerLabel({ status, response, steps }: Handoff): string {
  if (status === 'failed') {
    return 'See what went wrong';
  }
  if (response) {
    return 'See the result';
  }
  return steps.length > 0 ? 'See the steps' : 'See the prompt';
}

/** A prompt can run for pages, so it scrolls in place and leaves the steps and the result in view. */
function HandoffPrompt({ prompt }: { readonly prompt: string }) {
  return (
    <div className="rounded-r-lg border-l-2 border-(--c) bg-[color-mix(in_oklab,var(--c)_7%,transparent)] py-2 pr-1 pl-3">
      <p className="mb-1 text-[11.5px] font-medium tracking-[.05em] text-muted-foreground/80 uppercase">
        {`Prompt from the ${agentIdentity('CEO').label}`}
      </p>
      <div className="max-h-60 overflow-y-auto pr-2">
        <Markdown text={prompt} className="text-foreground" />
      </div>
    </div>
  );
}

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
  const stopped = handoff.status === 'cancelled' || (handoff.status === 'working' && !running);
  const now = useNow(working);
  const { conversationId = '' } = useParams();
  const markState: AgentMarkState = working ? 'working' : RESTING_MARK[handoff.status];
  const time = working
    ? formatDuration(Math.max(0, now - handoff.startedAt))
    : stopped
      ? 'Stopped'
      : `${handoff.status === 'failed' ? 'Failed · ' : ''}${formatDuration(handoff.durationMs ?? 0)}`;

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
      <div className="flex items-center">
        <CollapsibleTrigger
          aria-label={triggerLabel(handoff)}
          className="group flex min-w-0 flex-1 items-center gap-[11px] px-[13px] py-2.5 text-left outline-none hover:bg-[color-mix(in_oklab,var(--c)_7%,transparent)] focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <AgentMark role={handoff.role} roleName={handoff.roleName} state={markState} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block leading-[1.3] font-medium" title={handoff.projectName}>{handoff.summary}</span>
            <span className="block text-[12.5px] text-muted-foreground">{label}</span>
          </span>
          <span className="font-mono text-[12.5px] whitespace-nowrap text-muted-foreground tabular-nums">{time}</span>
          <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-250 group-data-[panel-open]:rotate-90" />
        </CollapsibleTrigger>
        {handoff.artifactId && (
          <Link
            to={artifactPath(conversationId, handoff.artifactId)}
            title={`Open ${handoff.artifactId}`}
            className="mr-[13px] inline-flex shrink-0 items-center gap-1 rounded-md bg-[color-mix(in_oklab,var(--c)_12%,transparent)] px-1.5 py-0.5 font-mono text-[11.5px] text-foreground outline-none hover:bg-[color-mix(in_oklab,var(--c)_20%,transparent)] focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <SquareCheck aria-hidden className="size-3" />
            {handoff.artifactId}
          </Link>
        )}
      </div>
      <CollapsibleContent className="flex flex-col gap-2.5 px-[13px] pt-0.5 pb-[13px] text-sm text-muted-foreground">
        {handoff.prompt && <HandoffPrompt prompt={handoff.prompt} />}
        {handoff.steps.length > 0 && <ActivitySteps steps={handoff.steps} />}
        {handoff.response && <Markdown text={handoff.response} className="text-foreground" />}
        {handoff.errorMessage && <p className="text-destructive">{handoff.errorMessage}</p>}
      </CollapsibleContent>
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
