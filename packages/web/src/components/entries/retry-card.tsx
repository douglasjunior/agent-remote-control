import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';

import { Button } from '../ui/button.js';

import { AgentMessage } from './agent-message.js';
import { EntryCountdown } from './entry-countdown.js';


type RetryEntry = Extract<ConversationEntry, { type: 'retry' }>;

/** A failure of the CEO, with the time the next attempt happens at and the choice to take it now or give up while the wait lasts. */
export function RetryCard({ entry, onFocus, onRetryNow, onStopRetrying }: {
  readonly entry: RetryEntry;
  readonly onFocus: (role: string) => void;
  readonly onRetryNow: () => void;
  readonly onStopRetrying: () => void;
}) {
  return (
    <AgentMessage role="CEO" roleName={entry.roleName} onFocus={onFocus}>
      <div data-retry-id={entry.id} className="flex flex-col gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
        <p className="text-destructive [overflow-wrap:anywhere]">{entry.errorMessage}</p>
        {!entry.closed && (
          <>
            <EntryCountdown timeout={entry.timeout} label="Time left until the next attempt" description={`Trying again automatically (attempt ${entry.attempt})`} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={onRetryNow}>Retry now</Button>
              <Button size="sm" variant="outline" onClick={onStopRetrying}>Stop retrying</Button>
            </div>
          </>
        )}
      </div>
    </AgentMessage>
  );
}
