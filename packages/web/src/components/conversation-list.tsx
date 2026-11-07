import { LoaderCircle } from 'lucide-react';
import { NavLink } from 'react-router';

import { useConversations } from '../conversations/conversations-context.js';
import { formatRelativeTime } from '../lib/format.js';
import { useNow } from '../lib/use-now.js';
import { cn } from '../lib/utils.js';


export function ConversationList({ onNavigate }: { readonly onNavigate?: () => void }) {
  const { state } = useConversations();
  const now = useNow(true);

  return (
    <nav className="flex h-full flex-col gap-2 p-3" aria-label="Conversations">
      <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {state.list.map((conversation) => {
          const busy = (state.byId[conversation.id]?.state ?? 'idle') !== 'idle';
          return (
            <li key={conversation.id}>
              <NavLink
                to={`/c/${conversation.id}`}
                onClick={onNavigate}
                className={({ isActive }) => cn(
                  'flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent',
                  isActive && 'bg-accent',
                )}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{conversation.title}</span>
                  <span className="text-xs text-muted-foreground">{formatRelativeTime(conversation.updatedAt, now)}</span>
                </span>
                {busy && <LoaderCircle aria-label="Running" className="size-4 shrink-0 animate-spin" />}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
