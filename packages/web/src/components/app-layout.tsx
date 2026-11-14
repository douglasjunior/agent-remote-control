import { PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react';
import { useState } from 'react';
import { Outlet } from 'react-router';

import { ArtifactsProvider } from '../artifacts/artifacts-context.js';
import { useConnection } from '../connection/connection-context.js';
import { ConversationsProvider, useConversations } from '../conversations/conversations-context.js';
import { useMediaQuery } from '../lib/use-media-query.js';
import { useStoredFlag } from '../lib/use-stored-flag.js';
import { MissingTokenPage } from '../pages/missing-token-page.js';

import { AmbientGlow } from './ambient-glow.js';
import { AgentAuthController } from './auth/agent-auth-controller.js';
import { ConnectionBadge } from './connection-badge.js';
import { ConversationList } from './conversation-list.js';
import { IconButton } from './icon-button.js';
import { ThemeToggle } from './theme-toggle.js';
import { Button } from './ui/button.js';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet.js';
import { Toaster } from './ui/sonner.js';
import { UsageIndicator } from './usage/usage-indicator.js';


export function AppLayout() {
  const { hasToken } = useConnection();

  if (!hasToken) {
    return <MissingTokenPage />;
  }

  return (
    <ConversationsProvider>
      <ArtifactsProvider>
        <AmbientGlow />
        <AppShell />
        <Toaster position="bottom-right" />
      </ArtifactsProvider>
    </ConversationsProvider>
  );
}

/** From this width the conversation list docks beside the page; below it the list is a drawer. */
const DOCKED_QUERY = '(min-width: 768px)';
const CONVERSATION_LIST_ID = 'conversation-list';

function AppShell() {
  const { status } = useConnection();
  const { createConversation } = useConversations();
  const docked = useMediaQuery(DOCKED_QUERY);
  const [dockOpen, setDockOpen] = useStoredFlag('arc.conversationListOpen', false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const listOpen = docked ? dockOpen : drawerOpen;
  const toggleList = () => (docked ? setDockOpen(!dockOpen) : setDrawerOpen(true));

  return (
    <div className="relative z-10 flex h-dvh">
      {docked && (
        <aside id={CONVERSATION_LIST_ID} hidden={!dockOpen} className="w-72 shrink-0 border-r">
          <ConversationList />
        </aside>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-2 border-b px-4 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <IconButton
              variant="ghost"
              label={listOpen ? 'Hide conversations' : 'Show conversations'}
              aria-expanded={listOpen}
              aria-controls={docked ? CONVERSATION_LIST_ID : undefined}
              onClick={toggleList}
            >
              {listOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
            </IconButton>
            <Button size="sm" aria-label="New conversation" className="shrink-0" onClick={createConversation}>
              <Plus />
              <span className="hidden sm:inline">New conversation</span>
            </Button>
            <h1 className="min-w-0 truncate text-sm font-semibold">Agent Remote Control</h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <AgentAuthController />
            <UsageIndicator />
            <ConnectionBadge status={status} />
            <ThemeToggle />
          </div>
        </header>
        <main className="min-h-0 flex-1">
          <Outlet />
        </main>
      </div>
      {!docked && (
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent side="left">
            <SheetHeader className="sr-only">
              <SheetTitle>Conversations</SheetTitle>
              <SheetDescription>Pick a conversation.</SheetDescription>
            </SheetHeader>
            <ConversationList onNavigate={() => setDrawerOpen(false)} />
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
