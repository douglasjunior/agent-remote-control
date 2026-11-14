import { MAX_SIGNAL_BYTES, SIGNALING_CLIENT_PATH, SIGNALING_HOST_PATH } from '@agent-remote-control/protocol/signaling';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { type RawData, WebSocket, WebSocketServer } from 'ws';

import type { ClientSocket, HostSocket, ISignalingSocket, ISignalingTransportPort } from '../ports/signaling-transport.port.js';


/** Pings keep the hosts' idle sockets alive through proxies, which drop a quiet connection after about a minute. */
const HEARTBEAT_INTERVAL_MS = 25_000;
/** Sockets open at once, in all and from one address; a host keeps its socket for as long as it runs. */
const MAX_SOCKETS = 2_000;
const MAX_SOCKETS_PER_ADDRESS = 20;
/** Sockets one address may open in a burst, and how fast that allowance comes back. */
const UPGRADE_RATE: Rate = { capacity: 30, perSecond: 0.5 };
/** A host relays the negotiation of up to 16 sessions at once; a browser negotiates only its own. */
const HOST_MESSAGE_RATE: Rate = { capacity: 256, perSecond: 64 };
const CLIENT_MESSAGE_RATE: Rate = { capacity: 64, perSecond: 16 };
const POLICY_VIOLATION = 1008;

type Rate = { readonly capacity: number; readonly perSecond: number };

class TokenBucket {
  private tokens: number;
  private updatedAt = Date.now();

  constructor(private readonly rate: Rate) {
    this.tokens = rate.capacity;
  }

  take(): boolean {
    this.refill();
    if (this.tokens < 1) {
      return false;
    }
    this.tokens -= 1;
    return true;
  }

  isFull(): boolean {
    this.refill();
    return this.tokens >= this.rate.capacity;
  }

  private refill(): void {
    const now = Date.now();
    this.tokens = Math.min(this.rate.capacity, this.tokens + (now - this.updatedAt) / 1000 * this.rate.perSecond);
    this.updatedAt = now;
  }
}

type AddressUsage = { sockets: number; readonly upgrades: TokenBucket };

class WsSignalingSocket<TSignal> implements ISignalingSocket<TSignal> {
  readonly id = randomUUID();
  private readonly messageListeners = new Set<(data: unknown) => void>();

  constructor(private readonly socket: WebSocket, rate: Rate, logger: Logger) {
    const bucket = new TokenBucket(rate);
    socket.on('message', (raw: RawData) => {
      if (!bucket.take()) {
        logger.warn(`signal_rate_limited: socket=${this.id}`);
        this.close(POLICY_VIOLATION, 'rate limited');
        return;
      }
      const data = parseJson(raw.toString());
      this.messageListeners.forEach(listener => listener(data));
    });
  }

  send(signal: TSignal): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(signal));
    }
  }

  onMessage(listener: (data: unknown) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onClose(listener: () => void): () => void {
    this.socket.on('close', listener);
    return () => this.socket.off('close', listener);
  }

  close(code?: number, reason?: string): void {
    this.socket.close(code, reason);
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

@Injectable()
export class WsSignalingTransportAdapter implements ISignalingTransportPort, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WsSignalingTransportAdapter.name);
  private readonly server = new WebSocketServer({ noServer: true, maxPayload: MAX_SIGNAL_BYTES });
  private readonly allowedOrigins = this.parseAllowedOrigins(process.env.P2P_ALLOWED_ORIGINS);
  private readonly trustedProxyHops = this.parseHops(process.env.P2P_TRUSTED_PROXY_HOPS);
  private readonly hostListeners = new Set<(socket: HostSocket) => void>();
  private readonly clientListeners = new Set<(socket: ClientSocket) => void>();
  private readonly alive = new WeakSet<WebSocket>();
  private readonly addresses = new Map<string, AddressUsage>();
  private heartbeat?: ReturnType<typeof setInterval>;
  private readonly onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    this.handleUpgrade(request, socket, head);
  };

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  onHost(listener: (socket: HostSocket) => void): () => void {
    this.hostListeners.add(listener);
    return () => this.hostListeners.delete(listener);
  }

  onClient(listener: (socket: ClientSocket) => void): () => void {
    this.clientListeners.add(listener);
    return () => this.clientListeners.delete(listener);
  }

  onModuleInit(): void {
    this.httpAdapterHost.httpAdapter.getHttpServer().on('upgrade', this.onUpgrade);
    this.heartbeat = setInterval(() => this.sweep(), HEARTBEAT_INTERVAL_MS);
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.heartbeat);
    this.httpAdapterHost.httpAdapter.getHttpServer().off('upgrade', this.onUpgrade);
    for (const client of this.server.clients) {
      client.terminate();
    }
    await new Promise<void>(done => this.server.close(() => done()));
  }

  /**
   * Terminates the sockets that did not answer the previous ping and pings the others, and forgets the addresses
   * with no socket open and their whole allowance back.
   */
  private sweep(): void {
    for (const client of this.server.clients) {
      if (!this.alive.has(client)) {
        client.terminate();
        continue;
      }
      this.alive.delete(client);
      client.ping();
    }
    for (const [address, usage] of this.addresses) {
      if (usage.sockets === 0 && usage.upgrades.isFull()) {
        this.addresses.delete(address);
      }
    }
  }

  private handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname !== SIGNALING_HOST_PATH && pathname !== SIGNALING_CLIENT_PATH) {
      socket.destroy();
      return;
    }
    const { origin, host } = request.headers;
    if (pathname === SIGNALING_CLIENT_PATH && !this.isOriginAllowed(origin, host)) {
      this.logger.warn(`signal_origin_rejected: origin=${origin ?? '(none)'}`);
      this.refuse(socket, '403 Forbidden');
      return;
    }
    const address = this.clientAddress(request);
    const usage = this.addresses.get(address) ?? { sockets: 0, upgrades: new TokenBucket(UPGRADE_RATE) };
    this.addresses.set(address, usage);
    if (this.server.clients.size >= MAX_SOCKETS) {
      this.logger.warn('signal_capacity_reached');
      this.refuse(socket, '503 Service Unavailable');
      return;
    }
    if (usage.sockets >= MAX_SOCKETS_PER_ADDRESS || !usage.upgrades.take()) {
      this.logger.warn(`signal_address_limited: address=${address}`);
      this.refuse(socket, '429 Too Many Requests');
      return;
    }
    if (pathname === SIGNALING_HOST_PATH) {
      this.accept(request, socket, head, usage, HOST_MESSAGE_RATE, this.hostListeners);
      return;
    }
    this.accept(request, socket, head, usage, CLIENT_MESSAGE_RATE, this.clientListeners);
  }

  private accept<TSignal>(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    usage: AddressUsage,
    rate: Rate,
    listeners: ReadonlySet<(socket: ISignalingSocket<TSignal>) => void>,
  ): void {
    this.server.handleUpgrade(request, socket, head, (webSocket) => {
      // ws reports a frame it refuses (over MAX_SIGNAL_BYTES, malformed) as an error, thrown without a listener.
      webSocket.on('error', error => this.logger.warn(`signal_socket_error: ${error.message}`));
      usage.sockets += 1;
      webSocket.on('close', () => {
        usage.sockets -= 1;
      });
      this.alive.add(webSocket);
      webSocket.on('pong', () => this.alive.add(webSocket));
      const signalingSocket = new WsSignalingSocket<TSignal>(webSocket, rate, this.logger);
      listeners.forEach(listener => listener(signalingSocket));
    });
  }

  private refuse(socket: Duplex, status: string): void {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  }

  /**
   * The address a socket comes from. Each of the `P2P_TRUSTED_PROXY_HOPS` proxies in front of this server appends
   * the address it saw to `X-Forwarded-For`, so the client's sits that many entries from the end; the entries before
   * it are whatever the client sent.
   */
  private clientAddress(request: IncomingMessage): string {
    const forwarded = request.headers['x-forwarded-for'];
    if (this.trustedProxyHops > 0 && forwarded) {
      const entries = [forwarded].flat().join(',').split(',').map(entry => entry.trim()).filter(entry => entry.length > 0);
      const address = entries.at(-this.trustedProxyHops);
      if (address) {
        return address;
      }
    }
    return request.socket.remoteAddress ?? 'unknown';
  }

  private parseAllowedOrigins(raw: string | undefined): ReadonlySet<string> {
    return new Set((raw ?? '')
      .split(',')
      .map(origin => origin.trim().replace(/\/+$/, ''))
      .filter(origin => origin.length > 0));
  }

  private parseHops(raw: string | undefined): number {
    const hops = Number(raw);
    return Number.isInteger(hops) && hops > 0 ? hops : 0;
  }

  /** Browsers open the client socket from the page this server serves; an absent `Origin` is not a browser. */
  private isOriginAllowed(origin: string | undefined, host: string | undefined): boolean {
    if (!origin) {
      return false;
    }
    if (this.allowedOrigins.has(origin)) {
      return true;
    }
    try {
      return host !== undefined && new URL(origin).host === host;
    } catch {
      return false;
    }
  }
}
