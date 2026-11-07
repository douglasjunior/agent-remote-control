import type { ClientCommand } from '@agent-remote-control/protocol/client-command';
import type { ServerEvent } from '@agent-remote-control/protocol/server-event';


export type ConnectionStatus = 'connecting' | 'open' | 'unauthorized' | 'closed';

export interface IServerConnection {
  connect(): void;
  disconnect(): void;
  send(command: ClientCommand): void;
  /** Whether an access token is at hand, in storage or in a `#token=` link the page was opened with. */
  hasAccessToken(): boolean;
  setAccessToken(token: string): void;
  onEvent(listener: (event: ServerEvent) => void): () => void;
  onStatus(listener: (status: ConnectionStatus) => void): () => void;
}
