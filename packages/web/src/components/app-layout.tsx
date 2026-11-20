import { PanelLeftClose, PanelLeftOpen, Plus, Settings } from 'lucide-react';
import { useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';

import { ArtifactsProvider } from '../artifacts/artifacts-context.js';
import { useConnection } from '../connection/connection-context.js';
import { ConversationsProvider, useConversations } from '../conversations/conversations-context.js';
import { useMediaQuery } from '../lib/use-media-query.js';
import { useStoredFlag } from '../lib/use-stored-flag.js';
import { cn } from '../lib/utils.js';
import { MissingTokenPage } from '../pages/missing-token-page.js';

import { AmbientGlow } from './ambient-glow.js';
import type { AppOutletContext } from './app-outlet-context.js';
import { AgentAuthProvider, useAgentAuth } from './auth/agent-auth-provider.js';
import { ConnectionBadge } from './connection-badge.js';
import { ConversationList } from './conversation-list.js';
import { HOME_PATH, homeFocusState } from './home/home-paths.js';
import { IconButton } from './icon-button.js';
import { SETTINGS_PATH, settingsState } from './settings-hub/settings-paths.js';
import { ThemeToggle } from './theme-toggle.js';
import { Button, buttonVariants } from './ui/button.js';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet.js';
import { Toaster } from './ui/sonner.js';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip.js';
import { UsageIndicator } from './usage/usage-indicator.js';


export function AppLayout() {
  const { hasToken } = useConnection();

  if (!hasToken) {
    return <MissingTokenPage />;
  }

  return (
    <ConversationsProvider>
      <ArtifactsProvider>
        <AgentAuthProvider>
          <AmbientGlow />
          <AppShell />
          <Toaster position="bottom-right" />
        </AgentAuthProvider>
      </ArtifactsProvider>
    </ConversationsProvider>
  );
}

/** From this width the conversation list docks beside the page; below it the list is a drawer. */
const DOCKED_QUERY = '(min-width: 768px)';
const CONVERSATION_LIST_ID = 'conversation-list';

function AppShell() {
  const { status, transport } = useConnection();
  const { needsLogin } = useAgentAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { createConversation } = useConversations();
  const docked = useMediaQuery(DOCKED_QUERY);
  const [dockOpen, setDockOpen] = useStoredFlag('arc.conversationListOpen', false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const listOpen = docked ? dockOpen : drawerOpen;
  const toggleList = () => (docked ? setDockOpen(!dockOpen) : setDrawerOpen(true));
  const showConversations = () => (docked ? setDockOpen(true) : setDrawerOpen(true));
  const outletContext: AppOutletContext = { conversationListVisible: docked && dockOpen, showConversations };
  const newConversation = () => (location.pathname === HOME_PATH
    ? void navigate(HOME_PATH, { replace: true, state: homeFocusState() })
    : createConversation());

  return (
    <div className="relative z-10 flex h-dvh">
      {docked && (
        <aside id={CONVERSATION_LIST_ID} hidden={!dockOpen} className="w-72 shrink-0 border-r">
          <ConversationList />
        </aside>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-1 border-b px-3 py-2 sm:gap-2 sm:px-4">
          <div className="flex min-w-0 items-center gap-1 sm:gap-2">
            <IconButton
              variant="ghost"
              label={listOpen ? 'Hide conversations' : 'Show conversations'}
              aria-expanded={listOpen}
              aria-controls={docked ? CONVERSATION_LIST_ID : undefined}
              onClick={toggleList}
            >
              {listOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
            </IconButton>
            <Button size="sm" aria-label="New conversation" className="shrink-0" onClick={newConversation}>
              <Plus />
              <span className="hidden sm:inline">New conversation</span>
            </Button>
            <h1 className="hidden min-w-0 truncate text-sm font-semibold sm:block">Agent Remote Control</h1>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <Tooltip>
              <TooltipTrigger render={<Link to={SETTINGS_PATH} state={settingsState(location)} aria-label={needsLogin ? 'Settings, agent login needed' : 'Settings'} className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'relative')} />}>
                <Settings />
                {needsLogin && <span aria-hidden className="absolute top-1.5 right-1.5 size-2 rounded-full bg-destructive" />}
              </TooltipTrigger>
              <TooltipContent>Settings</TooltipContent>
            </Tooltip>
            <UsageIndicator />
            <ConnectionBadge status={status} transport={transport} />
            <ThemeToggle />
          </div>
        </header>
        <main className="min-h-0 flex-1">
          <Outlet context={outletContext} />
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
