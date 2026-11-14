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

class WsSignalingSocket<TSignal> implements ISignalingSocket<TSignal> {
  readonly id = randomUUID();

  constructor(private readonly socket: WebSocket) {}

  send(signal: TSignal): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(signal));
    }
  }

  onMessage(listener: (data: unknown) => void): () => void {
    const handler = (raw: RawData) => listener(parseJson(raw.toString()));
    this.socket.on('message', handler);
    return () => this.socket.off('message', handler);
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
  private readonly hostListeners = new Set<(socket: HostSocket) => void>();
  private readonly clientListeners = new Set<(socket: ClientSocket) => void>();
  private readonly alive = new WeakSet<WebSocket>();
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

  /** Terminates the sockets that did not answer the previous ping and pings the others. */
  private sweep(): void {
    for (const client of this.server.clients) {
      if (!this.alive.has(client)) {
        client.terminate();
        continue;
      }
      this.alive.delete(client);
      client.ping();
    }
  }

  private handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname === SIGNALING_HOST_PATH) {
      this.accept(request, socket, head, this.hostListeners);
      return;
    }
    if (pathname !== SIGNALING_CLIENT_PATH) {
      socket.destroy();
      return;
    }
    const { origin, host } = request.headers;
    if (!this.isOriginAllowed(origin, host)) {
      this.logger.warn(`signal_origin_rejected: origin=${origin ?? '(none)'}`);
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    this.accept(request, socket, head, this.clientListeners);
  }

  private accept<TSignal>(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    listeners: ReadonlySet<(socket: ISignalingSocket<TSignal>) => void>,
  ): void {
    this.server.handleUpgrade(request, socket, head, (webSocket) => {
      this.alive.add(webSocket);
      webSocket.on('pong', () => this.alive.add(webSocket));
      const signalingSocket = new WsSignalingSocket<TSignal>(webSocket);
      listeners.forEach(listener => listener(signalingSocket));
    });
  }

  private parseAllowedOrigins(raw: string | undefined): ReadonlySet<string> {
    return new Set((raw ?? '')
      .split(',')
      .map(origin => origin.trim().replace(/\/+$/, ''))
      .filter(origin => origin.length > 0));
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
