import type { ClientCommand } from '@agent-remote-control/protocol/client-command';
import { parseServerEvent, type ServerEvent } from '@agent-remote-control/protocol/server-event';

import type { AccessTokenStore } from './access-token-store.js';
import type { ConnectionStatus, IServerConnection } from './server-connection.js';


const UNAUTHORIZED_CLOSE_CODE = 4401;
const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10_000;

export class WebSocketServerConnection implements IServerConnection {
  private socket: WebSocket | null = null;
  private status: ConnectionStatus = 'closed';
  private stopped = true;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private queue: ClientCommand[] = [];
  private readonly eventListeners = new Set<(event: ServerEvent) => void>();
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>();

  constructor(private readonly tokens: AccessTokenStore) {}

  connect(): void {
    this.stopped = false;
    this.clearRetry();
    this.open();
  }

  disconnect(): void {
    this.stopped = true;
    this.clearRetry();
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.setStatus('closed');
  }

  hasAccessToken(): boolean {
    return this.tokens.load() !== null;
  }

  setAccessToken(token: string): void {
    this.tokens.store(token);
  }

  send(command: ClientCommand): void {
    if (this.status === 'open' && this.socket) {
      this.socket.send(JSON.stringify(command));
      return;
    }
    this.queue.push(command);
  }

  onEvent(listener: (event: ServerEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private open(): void {
    const token = this.tokens.read();
    if (!token) {
      this.rejectCredentials();
      return;
    }
    this.setStatus('connecting');
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${location.host}/ws`);
    this.socket = socket;
    socket.onopen = () => socket.send(JSON.stringify({ type: 'auth', token }));
    socket.onmessage = message => this.handleFrame(socket, message.data);
    socket.onclose = closeEvent => this.handleClose(socket, closeEvent.code);
  }

  private handleFrame(socket: WebSocket, data: unknown): void {
    if (socket !== this.socket) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(data));
    } catch {
      console.warn('Dropped a frame that is not JSON');
      return;
    }
    const result = parseServerEvent(parsed);
    if (!result.ok) {
      console.warn('Dropped an invalid server event', result.error);
      return;
    }
    const event = result.value;
    if (event.type === 'auth.ok') {
      this.attempt = 0;
      this.setStatus('open');
      this.flushQueue(socket);
      return;
    }
    if (event.type === 'auth.failed') {
      this.rejectCredentials();
      return;
    }
    this.eventListeners.forEach(listener => listener(event));
  }

  private handleClose(socket: WebSocket, code: number): void {
    if (socket !== this.socket) {
      return;
    }
    this.socket = null;
    if (code === UNAUTHORIZED_CLOSE_CODE) {
      this.rejectCredentials();
      return;
    }
    this.setStatus('closed');
    const delay = Math.min(INITIAL_BACKOFF_MS * 2 ** this.attempt, MAX_BACKOFF_MS);
    this.attempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }

  private rejectCredentials(): void {
    this.stopped = true;
    this.queue = [];
    this.tokens.clear();
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.setStatus('unauthorized');
  }

  private flushQueue(socket: WebSocket): void {
    const pending = this.queue;
    this.queue = [];
    pending.forEach(command => socket.send(JSON.stringify(command)));
  }

  private clearRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) {
      return;
    }
    this.status = status;
    this.statusListeners.forEach(listener => listener(status));
  }
}
