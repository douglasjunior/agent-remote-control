import type { ClientCommand } from '@agent-remote-control/protocol/client-command';
import type { ServerEvent } from '@agent-remote-control/protocol/server-event';


/**
 * `incompatible`: the host speaks another protocol version. `untrusted`: the host presented a certificate other
 * than the one the link pinned. Neither is retried.
 */
export type ConnectionStatus = 'connecting' | 'open' | 'unauthorized' | 'closed' | 'incompatible' | 'untrusted';

/** How the page reaches the server: a WebSocket, a direct WebRTC data channel, or one relayed by a TURN server. */
export type ConnectionTransport = 'websocket' | 'webrtc' | 'turn';

export interface IServerConnection {
  /** Known before connecting; a WebRTC connection turns `turn` once it finds out a relay carries it. */
  readonly transport: ConnectionTransport;
  connect(): void;
  disconnect(): void;
  send(command: ClientCommand): void;
  /** Whether an access token is at hand, in storage or in a `#token=` link the page was opened with. */
  hasAccessToken(): boolean;
  setAccessToken(token: string): void;
  onEvent(listener: (event: ServerEvent) => void): () => void;
  onStatus(listener: (status: ConnectionStatus) => void): () => void;
  onTransport(listener: (transport: ConnectionTransport) => void): () => void;
}
