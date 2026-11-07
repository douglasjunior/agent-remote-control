import { Check, ChevronRight, LoaderCircle, X } from 'lucide-react';

import type { ActivityEntry } from '../../conversations/group-entries.js';
import { agentIdentity } from '../../lib/agent-identity.js';
import { toolLabel } from '../../lib/tool-label.js';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible.js';

import { Markdown } from './markdown.js';
import { WorkingDots, WorkingLabel } from './working-indicator.js';


function ToolStatusIcon({ status }: { readonly status: Extract<ActivityEntry, { type: 'tool' }>['status'] }) {
  if (status === 'completed') {
    return <Check aria-label="completed" className="size-3.5 text-green-600" />;
  }
  if (status === 'failed') {
    return <X aria-label="failed" className="size-3.5 text-destructive" />;
  }
  return <LoaderCircle aria-label="running" className="size-3.5 animate-spin" />;
}

export function ActivitySteps({ steps }: { readonly steps: readonly ActivityEntry[] }) {
  return (
    <div className="flex flex-col gap-2 text-sm text-muted-foreground">
      {steps.map(step => step.type === 'tool'
        ? (
          <div key={step.id} className="flex items-center gap-2">
            <ToolStatusIcon status={step.status} />
            <span className="min-w-0 truncate" title={step.title}>{toolLabel(step.title)}</span>
          </div>
        )
        : <Markdown key={step.id} text={step.text} className="text-muted-foreground" />)}
    </div>
  );
}

export function ActivityGroup({ steps, running, open, onOpenChange }: {
  readonly steps: readonly ActivityEntry[];
  readonly running: boolean;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}) {
  const count = `(${steps.length} ${steps.length === 1 ? 'step' : 'steps'})`;
  const { role } = steps[0]!;
  const { label, color } = agentIdentity(role);
  const lastTool = steps.findLast(step => step.type === 'tool');
  const doing = lastTool ? toolLabel(lastTool.title) : 'Thinking';
  return (
    <Collapsible className="text-sm text-muted-foreground" open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="group flex items-center gap-1 hover:text-foreground">
        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
        <span aria-hidden className="mx-1 size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="font-medium text-foreground">{label}</span>
        <span aria-hidden>·</span>
        {running ? <WorkingLabel>{`${doing}…`}</WorkingLabel> : <span>Show details</span>}
        {' '}
        {count}
        {running && <WorkingDots className="ml-1" />}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 border-l pl-3">
        <ActivitySteps steps={steps} />
      </CollapsibleContent>
    </Collapsible>
  );
}
