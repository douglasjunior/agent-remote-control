import type { ServerEvent } from '@agent-remote-control/protocol/server-event';


export interface IClientConnection {
  readonly id: string;
  send(event: ServerEvent): void;
  /** Delivers each message as parsed JSON, or as the raw value when it is not JSON. */
  onMessage(listener: (data: unknown) => void): () => void;
  onClose(listener: () => void): () => void;
  close(code?: number, reason?: string): void;
}

export interface IClientTransportPort {
  onConnection(listener: (connection: IClientConnection) => void): () => void;
}

export const IClientTransportPort = Symbol('IClientTransportPort');
