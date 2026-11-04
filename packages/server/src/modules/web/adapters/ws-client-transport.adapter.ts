import type { ServerEvent } from '@agent-remote-control/protocol/server-event';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { type RawData, WebSocket, WebSocketServer } from 'ws';

import type { IClientConnection, IClientTransportPort } from '../ports/client-transport.port.js';
import { isOriginAllowed, parseAllowedOrigins } from '../utils/web-origin.util.js';


const WS_PATH = '/ws';
const MAX_PAYLOAD_BYTES = 256 * 1024;

class WsClientConnection implements IClientConnection {
  readonly id = randomUUID();

  constructor(private readonly socket: WebSocket) {}

  send(event: ServerEvent): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(event));
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
export class WsClientTransportAdapter implements IClientTransportPort, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WsClientTransportAdapter.name);
  private readonly server = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  private readonly allowedOrigins = parseAllowedOrigins(process.env.WEB_ALLOWED_ORIGINS);
  private readonly listeners = new Set<(connection: IClientConnection) => void>();
  private readonly onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    this.handleUpgrade(request, socket, head);
  };

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  onConnection(listener: (connection: IClientConnection) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onModuleInit(): void {
    this.httpAdapterHost.httpAdapter.getHttpServer().on('upgrade', this.onUpgrade);
  }

  async onModuleDestroy(): Promise<void> {
    this.httpAdapterHost.httpAdapter.getHttpServer().off('upgrade', this.onUpgrade);
    for (const client of this.server.clients) {
      client.terminate();
    }
    await new Promise<void>(done => this.server.close(() => done()));
  }

  private handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname !== WS_PATH) {
      socket.destroy();
      return;
    }
    const { origin, host } = request.headers;
    if (!isOriginAllowed(origin, host, this.allowedOrigins)) {
      this.logger.warn(`ws_origin_rejected: origin=${origin ?? '(none)'}`);
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    this.server.handleUpgrade(request, socket, head, (webSocket) => {
      const connection = new WsClientConnection(webSocket);
      for (const listener of this.listeners) {
        listener(connection);
      }
    });
  }
}
