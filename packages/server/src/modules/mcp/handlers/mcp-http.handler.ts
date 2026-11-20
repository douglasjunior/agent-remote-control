import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import { IAgentToolsPort } from '../../orchestrator/ports/agent-tools.port.js';
import { MCP_MAX_BODY_BYTES, MCP_PATH } from '../constants/mcp.constant.js';
import { JSON_RPC_INVALID_REQUEST, JSON_RPC_PARSE_ERROR, JSON_RPC_SESSION_CLOSED, jsonRpcError } from '../models/json-rpc.model.js';
import { McpRpcService } from '../services/mcp-rpc.service.js';


type RequestListener = (request: IncomingMessage, response: ServerResponse) => void;

const BEARER = /^Bearer\s+(\S+)$/i;
const UNSPECIFIED_ADDRESSES: readonly string[] = ['0.0.0.0', '::'];

/**
 * The MCP Streamable HTTP endpoint of the agent tools, on the server's own port. It takes the requests for `/mcp`
 * from the HTTP server before Nest does, so neither the JSON body parser nor the routes and static files of the
 * channels see them, refuses, before reading the body, any credential the orchestrator has not opened, and answers in
 * plain JSON: it opens no server-to-client stream and keeps no MCP session of its own.
 */
@Injectable()
export class McpHttpHandler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(McpHttpHandler.name);
  private nestListeners: RequestListener[] = [];
  private readonly onRequest: RequestListener = (request, response) => {
    if (!this.isMcpRequest(request)) {
      for (const listener of this.nestListeners) {
        listener.call(this.server(), request, response);
      }
      return;
    }
    void this.handle(request, response).catch((error: unknown) => {
      this.logger.error(`[MCP Request Failed] ${error instanceof Error ? error.message : String(error)}`);
      if (!response.headersSent) {
        response.writeHead(500).end();
      }
    });
  };

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    @Inject(IAgentToolsPort) private readonly agentTools: IAgentToolsPort,
    private readonly rpc: McpRpcService,
  ) {}

  onModuleInit(): void {
    const server = this.server();
    this.nestListeners = server.listeners('request') as RequestListener[];
    server.removeAllListeners('request');
    server.on('request', this.onRequest);
    this.agentTools.serveAt({ connection: credential => this.connection(credential) });
  }

  onModuleDestroy(): void {
    const server = this.server();
    server.off('request', this.onRequest);
    for (const listener of this.nestListeners) {
      server.on('request', listener);
    }
  }

  /** The target is compared as text: one that is no URL (`//`) has no path to read, and belongs to Nest like any other. */
  private isMcpRequest({ url = '' }: IncomingMessage): boolean {
    const queryStart = url.indexOf('?');
    return (queryStart === -1 ? url : url.slice(0, queryStart)) === MCP_PATH;
  }

  private server(): Server {
    return this.httpAdapterHost.httpAdapter.getHttpServer() as Server;
  }

  /** An agent CLI runs on this machine, so it reaches the address the server listens on through loopback. */
  private connection(credential: string): { url: string; headers: Record<string, string> } | undefined {
    const address = this.server().address();
    if (!address || typeof address === 'string') {
      return undefined;
    }
    const host = UNSPECIFIED_ADDRESSES.includes(address.address)
      ? '127.0.0.1'
      : address.family === 'IPv6' ? `[${address.address}]` : address.address;
    return { url: `http://${host}:${address.port}${MCP_PATH}`, headers: { authorization: `Bearer ${credential}` } };
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const credential = BEARER.exec(request.headers.authorization ?? '')?.[1];
    if (!credential || !this.agentTools.isOpen(credential)) {
      this.logger.debug(`mcp_credential_refused: method=${request.method}`);
      request.resume();
      this.json(response, 401, jsonRpcError(null, JSON_RPC_SESSION_CLOSED, 'Unknown or closed tool session.'), { 'www-authenticate': 'Bearer' });
      return;
    }
    if (request.method === 'DELETE') {
      request.resume();
      response.writeHead(200).end();
      return;
    }
    if (request.method !== 'POST') {
      request.resume();
      response.writeHead(405, { allow: 'POST, DELETE' }).end();
      return;
    }
    const body = await this.readBody(request);
    if (body === undefined) {
      this.json(response, 413, jsonRpcError(null, JSON_RPC_INVALID_REQUEST, `The request is larger than ${MCP_MAX_BODY_BYTES} bytes.`));
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      this.json(response, 400, jsonRpcError(null, JSON_RPC_PARSE_ERROR, 'Parse error.'));
      return;
    }
    const batch = Array.isArray(parsed);
    const messages: readonly unknown[] = Array.isArray(parsed) ? parsed : [parsed];
    if (messages.length === 0) {
      this.json(response, 400, jsonRpcError(null, JSON_RPC_INVALID_REQUEST, 'Empty batch.'));
      return;
    }
    const responses = (await Promise.all(messages.map(message => this.rpc.handle(message, credential)))).filter(answer => answer !== undefined);
    if (responses.length === 0) {
      response.writeHead(202).end();
      return;
    }
    this.json(response, 200, batch ? responses : responses[0]);
  }

  /** `undefined` once the body passes the limit; the rest is consumed without being kept. */
  private readBody(request: IncomingMessage): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      request.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size <= MCP_MAX_BODY_BYTES) {
          chunks.push(chunk);
        }
      });
      request.on('end', () => resolve(size > MCP_MAX_BODY_BYTES ? undefined : Buffer.concat(chunks).toString('utf8')));
      request.on('error', reject);
    });
  }

  private json(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    response.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(body));
  }
}
