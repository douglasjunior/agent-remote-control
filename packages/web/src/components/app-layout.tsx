import { Menu } from 'lucide-react';
import { useState } from 'react';
import { Outlet } from 'react-router';

import { useConnection } from '../connection/connection-context.js';
import { ConversationsProvider } from '../conversations/conversations-context.js';
import { MissingTokenPage } from '../pages/missing-token-page.js';

import { AmbientGlow } from './ambient-glow.js';
import { ConnectionBadge } from './connection-badge.js';
import { ConversationList } from './conversation-list.js';
import { IconButton } from './icon-button.js';
import { ThemeToggle } from './theme-toggle.js';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet.js';


export function AppLayout() {
  const { status, hasToken } = useConnection();
  const [menuOpen, setMenuOpen] = useState(false);

  if (!hasToken) {
    return <MissingTokenPage />;
  }

  return (
    <ConversationsProvider>
      <AmbientGlow />
      <div className="relative z-10 flex h-dvh">
        <aside className="hidden w-72 shrink-0 border-r md:block">
          <ConversationList />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between gap-2 border-b px-4 py-2">
            <div className="flex items-center gap-2">
              <IconButton variant="ghost" className="md:hidden" label="Open conversations" onClick={() => setMenuOpen(true)}>
                <Menu />
              </IconButton>
              <h1 className="text-sm font-semibold">Agent Remote Control</h1>
            </div>
            <div className="flex items-center gap-2">
              <ConnectionBadge status={status} />
              <ThemeToggle />
            </div>
          </header>
          <main className="min-h-0 flex-1">
            <Outlet />
          </main>
        </div>
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetContent side="left">
            <SheetHeader className="sr-only">
              <SheetTitle>Conversations</SheetTitle>
              <SheetDescription>Pick a conversation or start a new one.</SheetDescription>
            </SheetHeader>
            <ConversationList onNavigate={() => setMenuOpen(false)} />
          </SheetContent>
        </Sheet>
      </div>
    </ConversationsProvider>
  );
}
