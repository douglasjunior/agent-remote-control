import { Link } from 'react-router';

import { conversationPath } from '../../conversations/conversation-paths.js';
import { useConversations } from '../../conversations/conversations-context.js';
import { formatRelativeTime } from '../../lib/format.js';
import { useNow } from '../../lib/use-now.js';
import { Button } from '../ui/button.js';


const RECENT_LIMIT = 6;

/** The most recently updated conversations that are not archived, as cards; nothing without any. */
export function RecentConversations({ onSeeAll }: { readonly onSeeAll: () => void }) {
  const { state } = useConversations();
  const now = useNow(true);
  const recent = state.list.filter(conversation => conversation.archivedAt === undefined).slice(0, RECENT_LIMIT);

  if (recent.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="recent-conversations" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 id="recent-conversations" className="text-sm font-medium text-muted-foreground">Recent conversations</h3>
        <Button variant="link" size="sm" className="h-auto p-0" onClick={onSeeAll}>See all</Button>
      </div>
      <ul className="grid grid-cols-1 gap-2 @xl:grid-cols-2">
        {recent.map(conversation => (
          <li key={conversation.id}>
            <Link
              to={conversationPath(conversation.id)}
              className="flex h-full flex-col gap-0.5 rounded-xl border bg-card/80 px-3.5 py-3 outline-none backdrop-blur-sm transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <span className="truncate text-sm font-medium">{conversation.title}</span>
              <span className="text-xs text-muted-foreground">{formatRelativeTime(conversation.updatedAt, now)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
