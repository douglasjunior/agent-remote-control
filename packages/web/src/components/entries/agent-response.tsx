import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';

import type { TeamRecap } from '../../conversations/group-entries.js';
import { formatDuration } from '../../lib/format.js';

import { AgentMessage } from './agent-message.js';
import { Markdown } from './markdown.js';


type AgentResponseEntry = Extract<ConversationEntry, { type: 'agent_response' }>;

export function AgentResponse({ entry, recap, onFocus }: {
  readonly entry: AgentResponseEntry;
  readonly recap?: TeamRecap;
  readonly onFocus: (role: string) => void;
}) {
  const footer = entry.agentInfo
    ? [entry.agentInfo.roleName, entry.agentInfo.agentName, entry.agentInfo.modelName, entry.agentInfo.effortName]
      .filter(Boolean)
      .join(' · ')
    : null;
  const teamNote = recap ? `${recap.agents} ${recap.agents === 1 ? 'agent' : 'agents'} · ${formatDuration(recap.totalMs)}` : null;

  return (
    <AgentMessage role="CEO" onFocus={onFocus}>
      {entry.status === 'failed'
        ? (
          <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            {entry.errorMessage ?? 'The agent failed.'}
          </p>
        )
        : <Markdown text={entry.response} />}
      {entry.status === 'cancelled' && <p className="text-xs text-muted-foreground">Cancelled</p>}
      {(footer || teamNote) && <p className="mt-1.5 font-mono text-[12.5px] text-muted-foreground">{[footer, teamNote].filter(Boolean).join(' · ')}</p>}
    </AgentMessage>
  );
}
