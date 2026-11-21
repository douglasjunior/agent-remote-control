import type { AgentLoginEvent } from '@agent-remote-control/protocol/agent-auth';
import { act } from '@testing-library/react';

import type { FakeServerConnection } from './fake-server-connection.js';


const AT = '2026-01-01T00:00:00.000Z';

type Status = 'authenticated' | 'unauthenticated' | 'unknown';

export function emitStatus(connection: FakeServerConnection, ...entries: [string, Status, string?][]) {
  act(() => connection.emitEvent({
    type: 'auth.status',
    fetchedAt: AT,
    agents: entries.map(([agentId, status, detail]) => ({
      agentId,
      displayName: agentId === 'claude' ? 'Claude Code' : 'OpenAI Codex',
      status,
      ...(detail ? { detail } : {}),
    })),
  }));
}

export function emitLogin(connection: FakeServerConnection, agentId: string, event: AgentLoginEvent) {
  act(() => connection.emitEvent({ type: 'auth.login', agentId, event }));
}

export const sentOfType = (connection: FakeServerConnection, type: string) =>
  connection.sent.filter(command => command.type === type);
