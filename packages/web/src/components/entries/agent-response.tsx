import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';

import { Markdown } from './markdown.js';


type AgentResponseEntry = Extract<ConversationEntry, { type: 'agent_response' }>;

export function AgentResponse({ entry }: { readonly entry: AgentResponseEntry }) {
  const footer = entry.agentInfo
    ? [entry.agentInfo.roleName, entry.agentInfo.agentName, entry.agentInfo.modelName, entry.agentInfo.effortName]
      .filter(Boolean)
      .join(' · ')
    : null;

  return (
    <div className="flex flex-col gap-1">
      {entry.status === 'failed'
        ? (
          <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            {entry.errorMessage ?? 'The agent failed.'}
          </p>
        )
        : <Markdown text={entry.response} />}
      {entry.status === 'cancelled' && <p className="text-xs text-muted-foreground">Cancelled</p>}
      {footer && <p className="text-xs text-muted-foreground">{footer}</p>}
    </div>
  );
}
