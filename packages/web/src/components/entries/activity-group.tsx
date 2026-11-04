import { Check, ChevronRight, LoaderCircle, X } from 'lucide-react';

import type { ActivityEntry } from '../../conversations/group-entries.js';
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

export function ActivityGroup({ steps, running }: {
  readonly steps: readonly ActivityEntry[];
  readonly running: boolean;
}) {
  const count = `(${steps.length} ${steps.length === 1 ? 'step' : 'steps'})`;
  return (
    <Collapsible className="text-sm text-muted-foreground">
      <CollapsibleTrigger className="group flex items-center gap-1 hover:text-foreground">
        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
        {running ? <WorkingLabel>Working…</WorkingLabel> : 'Show details'}
        {' '}
        {count}
        {running && <WorkingDots className="ml-1" />}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 flex flex-col gap-2 border-l pl-3">
        {steps.map(step => step.type === 'tool'
          ? (
            <div key={step.id} className="flex items-center gap-2">
              <ToolStatusIcon status={step.status} />
              <span className="min-w-0 truncate">{step.title}</span>
            </div>
          )
          : <Markdown key={step.id} text={step.text} className="text-muted-foreground" />)}
      </CollapsibleContent>
    </Collapsible>
  );
}
