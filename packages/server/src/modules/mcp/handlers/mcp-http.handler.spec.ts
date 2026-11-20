import { Logger } from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import { afterEach, describe, expect, it, rs } from '@rstest/core';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { StubAgentToolsPort } from '../../orchestrator/testing/stub-agent-tools.port.js';
import { McpRpcService } from '../services/mcp-rpc.service.js';

import { McpHttpHandler } from './mcp-http.handler.js';


const AUTHORIZATION = { authorization: 'Bearer open-credential' };

function hostOf(server: Server): HttpAdapterHost {
  return { httpAdapter: { getHttpServer: () => server } } as unknown as HttpAdapterHost;
}

async function start(rpc?: McpRpcService) {
  const nestRequests: string[] = [];
  const server = createServer((request, response) => {
    nestRequests.push(`${request.method} ${request.url}`);
    response.writeHead(204).end();
  });
  const agentTools = new StubAgentToolsPort();
  const handler = new McpHttpHandler(hostOf(server), agentTools, rpc ?? new McpRpcService(agentTools));
  handler.onModuleInit();
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (body: unknown, headers: Record<string, string> = AUTHORIZATION) => fetch(`${url}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { server, handler, agentTools, nestRequests, url, post };
}

describe('McpHttpHandler', () => {
  const servers: Server[] = [];
  const track = async (rpc?: McpRpcService) => {
    const started = await start(rpc);
    servers.push(started.server);
    return started;
  };

  afterEach(async () => {
    rs.restoreAllMocks();
    await Promise.all(servers.splice(0).map(server => new Promise(done => server.close(done))));
  });

  it('should answer a JSON-RPC request with JSON', async () => {
    const { post } = await track();

    const response = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toMatchObject({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'artifact_list' }] } });
  });

  it('should accept a notification with 202 and no body', async () => {
    const { post } = await track();

    const response = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });

    expect(response.status).toBe(202);
    expect(await response.text()).toBe('');
  });

  it('should answer a batch with the responses of its requests', async () => {
    const { post } = await track();

    const response = await post([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'server/discover' }]);

    expect(await response.json()).toEqual([
      { jsonrpc: '2.0', id: 1, result: {} },
      { jsonrpc: '2.0', id: 2, error: { code: -32601, message: 'Method not found: server/discover' } },
    ]);
  });

  it.each([
    ['without a credential', {}],
    ['with an unknown credential', { authorization: 'Bearer guessed' }],
    ['with another scheme', { authorization: 'Basic open-credential' }],
  ])('should refuse a request %s with 401 before reading its body', async (_label, headers) => {
    const { post, agentTools } = await track();

    const response = await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'artifact_list' } }, headers);

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
    expect(await response.json()).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unknown or closed tool session.' } });
    expect(agentTools.calls).toEqual([]);
  });

  it('should refuse a GET for a stream with 405 and accept the DELETE of a session', async () => {
    const { url } = await track();

    const get = await fetch(`${url}/mcp`, { headers: { ...AUTHORIZATION, accept: 'text/event-stream' } });
    const remove = await fetch(`${url}/mcp`, { method: 'DELETE', headers: AUTHORIZATION });
    const refused = await fetch(`${url}/mcp`, { method: 'DELETE' });

    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST, DELETE');
    expect(remove.status).toBe(200);
    expect(refused.status).toBe(401);
  });

  it.each([
    ['a body that is not JSON', '{"jsonrpc":', -32700, 'Parse error.'],
    ['an empty batch', '[]', -32600, 'Empty batch.'],
  ])('should answer %s with 400', async (_label, body, code, message) => {
    const { post } = await track();

    const response = await post(body);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ jsonrpc: '2.0', id: null, error: { code, message } });
  });

  it('should refuse a body over the limit with 413', async () => {
    const { post } = await track();

    const response = await post({ jsonrpc: '2.0', id: 1, method: 'ping', params: { padding: 'x'.repeat(4 * 1024 * 1024) } });

    expect(response.status).toBe(413);
  });

  it('should leave every other path to Nest', async () => {
    const { url, nestRequests } = await track();

    const response = await fetch(`${url}/health?x=1`);
    await fetch(`${url}/mcp/other`, { method: 'POST', headers: AUTHORIZATION });

    expect(response.status).toBe(204);
    expect(nestRequests).toEqual(['GET /health?x=1', 'POST /mcp/other']);
  });

  it('should answer the endpoint whatever its query string', async () => {
    const { url, nestRequests } = await track();

    const response = await fetch(`${url}/mcp?session=1`, { method: 'DELETE', headers: AUTHORIZATION });

    expect(response.status).toBe(200);
    expect(nestRequests).toEqual([]);
  });

  it.each(['//', '//[', '/%'])('should leave the target %j, which is no URL, to Nest', async (target) => {
    const { server, nestRequests } = await track();
    const { port } = server.address() as AddressInfo;

    const status = await new Promise<number | undefined>((resolve, reject) => {
      request({ host: '127.0.0.1', port, path: target }, response => resolve(response.statusCode)).on('error', reject).end();
    });

    expect(status).toBe(204);
    expect(nestRequests).toEqual([`GET ${target}`]);
  });

  it('should answer 500 when a request cannot be handled', async () => {
    const rpc = {
      handle: async () => {
        throw new Error('broken');
      },
    } as unknown as McpRpcService;
    const { post } = await track(rpc);
    const error = rs.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const response = await post({ jsonrpc: '2.0', id: 1, method: 'ping' });

    expect(response.status).toBe(500);
    expect(error).toHaveBeenCalledWith('[MCP Request Failed] broken');
  });

  it('should give the tools the loopback URL of the port the server listens on, with the credential in a header', async () => {
    const { agentTools, url } = await track();

    expect(agentTools.endpoint?.connection('abc')).toEqual({ url: `${url}/mcp`, headers: { authorization: 'Bearer abc' } });
  });

  it.each([
    [{ address: '0.0.0.0', family: 'IPv4', port: 3000 }, 'http://127.0.0.1:3000/mcp'],
    [{ address: '::', family: 'IPv6', port: 3000 }, 'http://127.0.0.1:3000/mcp'],
    [{ address: '::1', family: 'IPv6', port: 3001 }, 'http://[::1]:3001/mcp'],
    [{ address: '192.168.0.2', family: 'IPv4', port: 80 }, 'http://192.168.0.2:80/mcp'],
  ])('should reach the server listening on %j at %s', (address, expected) => {
    const server = createServer();
    rs.spyOn(server, 'address').mockReturnValue(address);
    const agentTools = new StubAgentToolsPort();
    new McpHttpHandler(hostOf(server), agentTools, new McpRpcService(agentTools)).onModuleInit();

    expect(agentTools.endpoint?.connection('abc')?.url).toBe(expected);
  });

  it('should not offer the tools while the server listens on no port', () => {
    const server = createServer();
    rs.spyOn(server, 'address').mockReturnValue('/tmp/socket');
    const agentTools = new StubAgentToolsPort();
    new McpHttpHandler(hostOf(server), agentTools, new McpRpcService(agentTools)).onModuleInit();

    expect(agentTools.endpoint?.connection('abc')).toBeUndefined();
  });

  it('should give the requests back to Nest when the module is destroyed', async () => {
    const { handler, post, nestRequests } = await track();

    handler.onModuleDestroy();
    const response = await post({ jsonrpc: '2.0', id: 1, method: 'ping' });

    expect(response.status).toBe(204);
    expect(nestRequests).toEqual(['POST /mcp']);
  });
});
