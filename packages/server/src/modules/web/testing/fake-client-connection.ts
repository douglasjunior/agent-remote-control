import type { ServerEvent } from '@agent-remote-control/protocol/server-event';

import type { IClientConnection, IClientTransportPort } from '../ports/client-transport.port.js';


export class FakeClientConnection implements IClientConnection {
  readonly sent: ServerEvent[] = [];
  closedWith?: { code?: number; reason?: string };
  private readonly messageListeners = new Set<(data: unknown) => void>();
  private readonly closeListeners = new Set<() => void>();

  constructor(readonly id = 'connection-1') {}

  send(event: ServerEvent): void {
    this.sent.push(event);
  }

  onMessage(listener: (data: unknown) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  close(code?: number, reason?: string): void {
    this.closedWith = { code, reason };
    this.simulateClose();
  }

  receive(data: unknown): void {
    for (const listener of this.messageListeners) {
      listener(data);
    }
  }

  simulateClose(): void {
    for (const listener of this.closeListeners) {
      listener();
    }
  }
}

export class FakeClientTransport implements IClientTransportPort {
  private readonly listeners = new Set<(connection: IClientConnection) => void>();

  get listenerCount(): number {
    return this.listeners.size;
  }

  onConnection(listener: (connection: IClientConnection) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  connect(connection: IClientConnection): void {
    for (const listener of this.listeners) {
      listener(connection);
    }
  }
}
