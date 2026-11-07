import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { act, render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { VirtuosoMockContext } from 'react-virtuoso';

import { ConnectionProvider } from '../connection/connection-context.js';
import { routes } from '../router.js';
import { ThemeProvider } from '../theme/theme-provider.js';

import { FakeServerConnection } from './fake-server-connection.js';


export type AppHarness = {
  connection: FakeServerConnection;
  router: ReturnType<typeof createMemoryRouter>;
};

export const AT = '2026-01-01T00:00:00.000Z';

export const roleProfiles = [
  { role: 'CEO', roleName: 'CEO', agent: { id: 'codex', name: 'Codex', available: true } },
  { role: 'DEVELOPER', roleName: 'Developer' },
];

export function userEntry(id: string, text = id): ConversationEntry {
  return { id, at: AT, type: 'user_message', text };
}

export function renderApp(path = '/'): AppHarness {
  localStorage.clear();
  const connection = new FakeServerConnection();
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <VirtuosoMockContext.Provider value={{ viewportHeight: 100_000, itemHeight: 100 }}>
      <ThemeProvider>
        <ConnectionProvider connection={connection}>
          <RouterProvider router={router} />
        </ConnectionProvider>
      </ThemeProvider>
    </VirtuosoMockContext.Provider>,
  );
  act(() => connection.emitStatus('open'));
  return { connection, router };
}

export function openConversation(options: { configured?: boolean; entries?: ConversationEntry[] } = {}): AppHarness {
  const app = renderApp('/c/c1');
  act(() => {
    app.connection.emitEvent({
      type: 'conversation.list',
      conversations: [{ id: 'c1', title: 'My task', createdAt: AT, updatedAt: AT }],
    });
    app.connection.emitEvent({
      type: 'conversation.history',
      conversationId: 'c1',
      entries: options.entries ?? [],
      state: 'idle',
    });
    app.connection.emitEvent({
      type: 'profiles',
      conversationId: 'c1',
      configured: options.configured ?? true,
      profiles: roleProfiles,
    });
  });
  return app;
}
