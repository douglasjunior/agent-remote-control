import { Logger } from '@nestjs/common';
import { describe, expect, it, rs } from '@rstest/core';

import { StubAgentToolsPort } from '../../orchestrator/testing/stub-agent-tools.port.js';

import { McpRpcService } from './mcp-rpc.service.js';


const CREDENTIAL = 'open-credential';

function setup() {
  const agentTools = new StubAgentToolsPort();
  return { agentTools, rpc: new McpRpcService(agentTools) };
}

const request = (method: string, params?: unknown, id: unknown = 1) => ({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) });

describe('McpRpcService', () => {
  it('should initialize with the version the client asks for, the tools capability and the instructions of the session', async () => {
    const { rpc, agentTools } = setup();

    const response = await rpc.handle(request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } }), CREDENTIAL);

    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'agent-remote-control', version: '1.0.0' },
        instructions: agentTools.catalog.instructions,
      },
    });
  });

  it('should answer a version it does not know with the newest it supports', async () => {
    const { rpc } = setup();

    const response = await rpc.handle(request('initialize', { protocolVersion: '2099-01-01' }), CREDENTIAL);

    expect(response).toMatchObject({ result: { protocolVersion: '2025-11-25' } });
  });

  it('should list the tools of the session', async () => {
    const { rpc, agentTools } = setup();

    await expect(rpc.handle(request('tools/list', {}, 'a'), CREDENTIAL)).resolves.toEqual({ jsonrpc: '2.0', id: 'a', result: { tools: agentTools.catalog.tools } });
  });

  it('should call a tool with its arguments and return its text', async () => {
    const { rpc, agentTools } = setup();

    const response = await rpc.handle(request('tools/call', { name: 'artifact_list', arguments: { status: ['all'], toolSummary: 'x' } }), CREDENTIAL);

    expect(agentTools.calls).toEqual([{ credential: CREDENTIAL, name: 'artifact_list', args: { status: ['all'], toolSummary: 'x' } }]);
    expect(response).toEqual({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'Listed.' }], isError: false } });
  });

  it('should flag a failed request as a tool error and call a tool without arguments with none', async () => {
    const { rpc, agentTools } = setup();
    agentTools.callResult = { status: 'done', text: 'You cannot create artifacts.', isError: true };

    const response = await rpc.handle(request('tools/call', { name: 'artifact_list' }), CREDENTIAL);

    expect(agentTools.calls[0]?.args).toEqual({});
    expect(response).toMatchObject({ result: { content: [{ type: 'text', text: 'You cannot create artifacts.' }], isError: true } });
  });

  it('should answer a tool that fails to run as a failed call', async () => {
    const { rpc, agentTools } = setup();
    agentTools.callError = new Error('disk full');
    rs.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const response = await rpc.handle(request('tools/call', { name: 'artifact_list' }), CREDENTIAL);

    expect(response).toMatchObject({ result: { content: [{ type: 'text', text: 'The server failed to carry out artifact_list: disk full' }], isError: true } });
    rs.restoreAllMocks();
  });

  it.each([
    ['an unknown tool', request('tools/call', { name: 'artifact_delete' }), -32602, 'Unknown tool: artifact_delete'],
    ['a call without a tool name', request('tools/call', {}), -32602, 'tools/call needs the name of the tool.'],
    ['an unknown method', request('server/discover'), -32601, 'Method not found: server/discover'],
    ['a message without a method', { jsonrpc: '2.0', id: 4 }, -32600, 'Invalid request.'],
  ])('should answer %s with a JSON-RPC error', async (_label, message, code, text) => {
    const { rpc } = setup();

    const response = await rpc.handle(message, CREDENTIAL);

    expect(response).toEqual({ jsonrpc: '2.0', id: (message as { id: unknown }).id, error: { code, message: text } });
  });

  it('should answer a message that is not an object with an error without id', async () => {
    const { rpc } = setup();

    await expect(rpc.handle('ping', CREDENTIAL)).resolves.toEqual({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request.' } });
  });

  it('should answer ping and empty resource and prompt lists', async () => {
    const { rpc } = setup();

    await expect(rpc.handle(request('ping'), CREDENTIAL)).resolves.toMatchObject({ result: {} });
    await expect(rpc.handle(request('resources/list'), CREDENTIAL)).resolves.toMatchObject({ result: { resources: [] } });
    await expect(rpc.handle(request('resources/templates/list'), CREDENTIAL)).resolves.toMatchObject({ result: { resourceTemplates: [] } });
    await expect(rpc.handle(request('prompts/list', [1]), CREDENTIAL)).resolves.toMatchObject({ result: { prompts: [] } });
  });

  it('should not answer notifications or the responses of the client', async () => {
    const { rpc } = setup();

    await expect(rpc.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, CREDENTIAL)).resolves.toBeUndefined();
    await expect(rpc.handle({ jsonrpc: '2.0', id: 9, result: {} }, CREDENTIAL)).resolves.toBeUndefined();
    await expect(rpc.handle({ jsonrpc: '2.0', id: 9, error: { code: 1, message: 'x' } }, CREDENTIAL)).resolves.toBeUndefined();
  });

  it('should answer with a closed session error when the session closed after the request was let in', async () => {
    const { rpc, agentTools } = setup();
    agentTools.openCredentials.clear();

    await expect(rpc.handle(request('tools/list'), CREDENTIAL)).resolves.toMatchObject({ error: { code: -32001, message: 'The tool session is closed.' } });
    await expect(rpc.handle(request('tools/call', { name: 'artifact_list' }), CREDENTIAL)).resolves.toMatchObject({ error: { code: -32001 } });
  });

  it('should answer an unexpected failure with an internal error', async () => {
    const { rpc, agentTools } = setup();
    agentTools.describe = async () => {
      throw new Error('skills unreadable');
    };
    const error = rs.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await expect(rpc.handle(request('initialize'), CREDENTIAL)).resolves.toEqual({ jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'Internal error.' } });
    expect(error).toHaveBeenCalledWith('[MCP Request Failed] Method=initialize: skills unreadable');
    rs.restoreAllMocks();
  });
});
