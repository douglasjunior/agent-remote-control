import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';

import { formatDuration } from '../../lib/format.js';
import { Card } from '../ui/card.js';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible.js';

import { Markdown } from './markdown.js';


type DelegationEntry = Extract<ConversationEntry, { type: 'delegation' }>;

export function DelegationCard({ entry }: { readonly entry: DelegationEntry }) {
  const finished = entry.phase === 'finished';
  const title = finished && entry.durationMs !== undefined
    ? `${entry.roleName} finished in ${formatDuration(entry.durationMs)}`
    : `${entry.roleName} ${finished ? 'finished' : 'started'}`;

  return (
    <Card className="gap-2 py-3 text-sm">
      <Collapsible className="px-4">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">{title}</span>
          {entry.projectName && <span className="text-xs text-muted-foreground">{entry.projectName}</span>}
        </div>
        {entry.response && (
          <>
            <CollapsibleTrigger className="mt-1 text-xs text-muted-foreground underline">
              Show response
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <Markdown text={entry.response} />
            </CollapsibleContent>
          </>
        )}
      </Collapsible>
    </Card>
  );
}
