import type { ConversationSummary } from '@agent-remote-control/protocol/conversation';
import { Archive, ArchiveRestore, ChevronRight, Ellipsis, LoaderCircle, Pencil } from 'lucide-react';
import { useState } from 'react';
import { NavLink } from 'react-router';

import { useConversations } from '../conversations/conversations-context.js';
import { formatRelativeTime } from '../lib/format.js';
import { useNow } from '../lib/use-now.js';
import { useStoredFlag } from '../lib/use-stored-flag.js';
import { cn } from '../lib/utils.js';

import { IconButton } from './icon-button.js';
import { TitleInput } from './title-input.js';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu.js';


function ConversationRow({ conversation, now, onNavigate }: {
  readonly conversation: ConversationSummary;
  readonly now: number;
  readonly onNavigate?: () => void;
}) {
  const { state, renameConversation, archiveConversation } = useConversations();
  const [renaming, setRenaming] = useState(false);
  const busy = (state.byId[conversation.id]?.state ?? 'idle') !== 'idle';
  const archived = conversation.archivedAt !== undefined;

  return (
    <li className="group/row relative">
      {renaming && (
        <div className="px-1 py-1">
          <TitleInput
            title={conversation.title}
            label="Conversation title"
            onSave={title => renameConversation(conversation.id, title)}
            onDone={() => setRenaming(false)}
          />
        </div>
      )}
      <NavLink
        hidden={renaming}
        to={`/c/${conversation.id}`}
        onClick={onNavigate}
        className={({ isActive }) => cn(
          'flex items-center justify-between gap-2 rounded-md py-2 pr-10 pl-3 text-sm hover:bg-accent',
          isActive && 'bg-accent',
          archived && 'text-muted-foreground',
        )}
      >
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{conversation.title}</span>
          <span className="text-xs text-muted-foreground">{formatRelativeTime(conversation.updatedAt, now)}</span>
        </span>
        {busy && <LoaderCircle aria-label="Running" className="size-4 shrink-0 animate-spin" />}
      </NavLink>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={(
            <IconButton
              variant="ghost"
              size="icon-sm"
              label={`Actions for ${conversation.title}`}
              hidden={renaming}
              className="absolute top-1/2 right-1.5 -translate-y-1/2 opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100 pointer-coarse:opacity-100"
            />
          )}
        >
          <Ellipsis />
        </DropdownMenuTrigger>
        {/* Renaming focuses the title field, which the menu would blur by returning the focus to its trigger. */}
        <DropdownMenuContent align="end" className="w-44" finalFocus={!renaming}>
          <DropdownMenuItem onClick={() => setRenaming(true)}>
            <Pencil />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => archiveConversation(conversation.id, !archived)}>
            {archived ? <ArchiveRestore /> : <Archive />}
            {archived ? 'Unarchive' : 'Archive'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

/**
 * The conversations, most recent first, with the archived ones in a group of their own at the bottom: collapsed
 * unless the viewer opened it, and still openable.
 */
export function ConversationList({ onNavigate }: { readonly onNavigate?: () => void }) {
  const { state } = useConversations();
  const now = useNow(true);
  const [archivedOpen, setArchivedOpen] = useStoredFlag('arc.archivedConversationsOpen', false);
  const active = state.list.filter(conversation => conversation.archivedAt === undefined);
  const archived = state.list.filter(conversation => conversation.archivedAt !== undefined);

  return (
    <nav className="flex h-full flex-col gap-2 p-3" aria-label="Conversations">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        <ul className="flex flex-col gap-1">
          {active.map(conversation => <ConversationRow key={conversation.id} conversation={conversation} now={now} onNavigate={onNavigate} />)}
        </ul>
        {archived.length > 0 && (
          <div className="mt-auto flex flex-col gap-1 border-t pt-2">
            <button
              type="button"
              aria-expanded={archivedOpen}
              onClick={() => setArchivedOpen(!archivedOpen)}
              className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] font-medium tracking-[.04em] text-muted-foreground uppercase outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <ChevronRight aria-hidden className={cn('size-3.5 transition-transform duration-200 motion-reduce:transition-none', archivedOpen && 'rotate-90')} />
              {`Archived (${archived.length})`}
            </button>
            {archivedOpen && (
              <ul aria-label="Archived conversations" className="flex flex-col gap-1">
                {archived.map(conversation => <ConversationRow key={conversation.id} conversation={conversation} now={now} onNavigate={onNavigate} />)}
              </ul>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}
