import type { ToClientSignal, ToHostSignal } from '@agent-remote-control/protocol/signaling';

import type { ISignalingSocket, ISignalingTransportPort } from '../ports/signaling-transport.port.js';


let nextId = 0;

export class FakeSignalingSocket<TSignal> implements ISignalingSocket<TSignal> {
  readonly id = `socket-${++nextId}`;
  readonly sent: TSignal[] = [];
  closed?: { readonly code?: number; readonly reason?: string };
  private readonly messageListeners = new Set<(data: unknown) => void>();
  private readonly closeListeners = new Set<() => void>();

  constructor(readonly address = '203.0.113.10') {}

  send(signal: TSignal): void {
    this.sent.push(signal);
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
    this.closed = { code, reason };
  }

  receive(data: unknown): void {
    this.messageListeners.forEach(listener => listener(data));
  }

  /** What the transport does once the socket is gone, after `close` or when the peer leaves. */
  emitClose(): void {
    this.closeListeners.forEach(listener => listener());
  }
}

export class FakeSignalingTransport implements ISignalingTransportPort {
  private readonly hostListeners = new Set<(socket: FakeSignalingSocket<ToHostSignal>) => void>();
  private readonly clientListeners = new Set<(socket: FakeSignalingSocket<ToClientSignal>) => void>();

  onHost(listener: (socket: FakeSignalingSocket<ToHostSignal>) => void): () => void {
    this.hostListeners.add(listener);
    return () => this.hostListeners.delete(listener);
  }

  onClient(listener: (socket: FakeSignalingSocket<ToClientSignal>) => void): () => void {
    this.clientListeners.add(listener);
    return () => this.clientListeners.delete(listener);
  }

  connectHost(): FakeSignalingSocket<ToHostSignal> {
    const socket = new FakeSignalingSocket<ToHostSignal>();
    this.hostListeners.forEach(listener => listener(socket));
    return socket;
  }

  connectClient(address?: string): FakeSignalingSocket<ToClientSignal> {
    const socket = new FakeSignalingSocket<ToClientSignal>(address);
    this.clientListeners.forEach(listener => listener(socket));
    return socket;
  }
}
