import type { ClientCommand } from '@agent-remote-control/protocol/client-command';
import type { ServerEvent } from '@agent-remote-control/protocol/server-event';

import type { ConnectionStatus, IServerConnection } from '../connection/server-connection.js';


export class FakeServerConnection implements IServerConnection {
  readonly sent: ClientCommand[] = [];
  connectCalls = 0;
  disconnectCalls = 0;
  /** Starts with a token, so a spec mounts signed in unless it clears it. */
  accessToken: string | null = 'token';
  private readonly eventListeners = new Set<(event: ServerEvent) => void>();
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>();

  connect(): void {
    this.connectCalls += 1;
  }

  disconnect(): void {
    this.disconnectCalls += 1;
  }

  hasAccessToken(): boolean {
    return this.accessToken !== null;
  }

  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  send(command: ClientCommand): void {
    this.sent.push(command);
  }

  onEvent(listener: (event: ServerEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  emitEvent(event: ServerEvent): void {
    this.eventListeners.forEach(listener => listener(event));
  }

  emitStatus(status: ConnectionStatus): void {
    this.statusListeners.forEach(listener => listener(status));
  }
}
