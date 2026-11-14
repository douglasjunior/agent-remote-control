import type { ClientCommand } from '@agent-remote-control/protocol/client-command';
import { parseServerEvent, type ServerEvent } from '@agent-remote-control/protocol/server-event';

import type { AccessTokenStore } from './access-token-store.js';
import type { ConnectionStatus, ConnectionTransport, IServerConnection } from './server-connection.js';


const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10_000;

export type ChannelCloseReason = 'closed' | 'unauthorized' | 'incompatible' | 'untrusted';

/** What a channel reports while it lives; reports of a channel the connection replaced are ignored. */
export type ChannelHandlers = {
  readonly onOpen: () => void;
  /** One whole JSON message from the server. */
  readonly onMessage: (text: string) => void;
  readonly onClose: (reason: ChannelCloseReason) => void;
  readonly onTransport: (transport: ConnectionTransport) => void;
};

/** One attempt to reach the server, carrying text messages; `close` ends it without reporting back. */
export type ServerChannel = {
  send(text: string): void;
  close(): void;
};

/**
 * The connection rules every transport shares: authenticate first with the access token, queue commands until
 * `auth.ok`, validate every event, stop on a rejected token and reconnect otherwise with exponential backoff, at once
 * when the page becomes visible again.
 */
export abstract class ChannelServerConnection implements IServerConnection {
  private channel: ServerChannel | null = null;
  private attemptId = 0;
  private status: ConnectionStatus = 'closed';
  private currentTransport: ConnectionTransport;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private queue: ClientCommand[] = [];
  private readonly eventListeners = new Set<(event: ServerEvent) => void>();
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>();
  private readonly transportListeners = new Set<(transport: ConnectionTransport) => void>();
  private readonly onVisibilityChange = () => {
    if (document.visibilityState === 'visible' && this.retryTimer) {
      this.clearRetry();
      this.open();
    }
  };

  protected constructor(private readonly tokens: AccessTokenStore, transport: ConnectionTransport) {
    this.currentTransport = transport;
  }

  /** Opens one attempt, reporting through the handlers. */
  protected abstract openChannel(handlers: ChannelHandlers): ServerChannel;

  get transport(): ConnectionTransport {
    return this.currentTransport;
  }

  connect(): void {
    this.clearRetry();
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.open();
  }

  disconnect(): void {
    this.clearRetry();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.closeChannel();
    this.setStatus('closed');
  }

  hasAccessToken(): boolean {
    return this.tokens.load() !== null;
  }

  setAccessToken(token: string): void {
    this.tokens.store(token);
  }

  send(command: ClientCommand): void {
    if (this.status === 'open' && this.channel) {
      this.channel.send(JSON.stringify(command));
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

  onTransport(listener: (transport: ConnectionTransport) => void): () => void {
    this.transportListeners.add(listener);
    return () => this.transportListeners.delete(listener);
  }

  private open(): void {
    const token = this.tokens.read();
    if (!token) {
      this.rejectCredentials();
      return;
    }
    this.setStatus('connecting');
    const id = ++this.attemptId;
    const live = () => id === this.attemptId && this.channel !== null;
    this.channel = this.openChannel({
      onOpen: () => live() && this.channel!.send(JSON.stringify({ type: 'auth', token })),
      onMessage: text => live() && this.handleMessage(text),
      onClose: reason => live() && this.handleClose(reason),
      onTransport: transport => live() && this.setTransport(transport),
    });
  }

  private handleMessage(text: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
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
      this.flushQueue();
      return;
    }
    if (event.type === 'auth.failed') {
      this.rejectCredentials();
      return;
    }
    this.eventListeners.forEach(listener => listener(event));
  }

  private handleClose(reason: ChannelCloseReason): void {
    this.channel = null;
    if (reason === 'unauthorized') {
      this.rejectCredentials();
      return;
    }
    if (reason !== 'closed') {
      this.queue = [];
      this.setStatus(reason);
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
    this.queue = [];
    this.tokens.clear();
    this.closeChannel();
    this.setStatus('unauthorized');
  }

  private closeChannel(): void {
    const channel = this.channel;
    this.channel = null;
    channel?.close();
  }

  private flushQueue(): void {
    const pending = this.queue;
    this.queue = [];
    pending.forEach(command => this.channel!.send(JSON.stringify(command)));
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

  private setTransport(transport: ConnectionTransport): void {
    if (this.currentTransport === transport) {
      return;
    }
    this.currentTransport = transport;
    this.transportListeners.forEach(listener => listener(transport));
  }
}
