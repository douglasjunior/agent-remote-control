import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, rs } from '@rstest/core';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { IAgentPortFactory } from '../src/modules/agent/ports/agent-port-factory.port.js';
import type { AgentUpdate } from '../src/modules/agent/ports/agent.port.js';
import { IArtifactsPort } from '../src/modules/artifacts/ports/artifacts.port.js';
import type { TurnResult } from '../src/modules/orchestrator/models/turn-result.model.js';
import { IAgentTurnPort } from '../src/modules/orchestrator/ports/agent-turn.port.js';
import { StubAgentPortFactory } from '../src/modules/orchestrator/testing/stub-agent-port-factory.js';
import { StubAgentPort } from '../src/modules/orchestrator/testing/stub-agent.port.js';

import { createTestingModule } from './testing-module.js';


type Exchange = { readonly status: number; readonly body: any };

/** A CEO whose CLI takes HTTP MCP servers and, in its first prompt, uses the tools it was given as an agent CLI does. */
class McpClientAgent extends StubAgentPort {
  readonly exchanges: Exchange[] = [];

  constructor() {
    super();
    this.supportsHttpMcp = true;
  }

  get server() {
    return this.mcpServersSent.at(-1)?.[0];
  }

  override async* prompt(text: string): AsyncGenerator<AgentUpdate> {
    this.promptCalls.push(text);
    if (this.exchanges.length === 0) {
      await this.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } } });
      await this.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      await this.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
      await this.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'artifact_create', arguments: { type: 'feature', title: 'Checkout', project: 'shop', toolSummary: 'Creating the feature' } } });
      await this.send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'artifact_update', arguments: { id: 'F-1', status: 'frozen' } } });
    }
    this.lastAgentMessage = 'The feature is on the board.';
    yield { kind: 'text', text: this.lastAgentMessage };
  }

  async send(message: unknown, credentialHeaders = this.server!.headers): Promise<Exchange> {
    const response = await fetch(this.server!.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...credentialHeaders },
      body: JSON.stringify(message),
    });
    const raw = await response.text();
    const exchange = { status: response.status, body: raw ? JSON.parse(raw) : undefined };
    this.exchanges.push(exchange);
    return exchange;
  }
}

describe('Agent tools over MCP (e2e)', () => {
  let app: INestApplication;
  let dataDir: string;
  let workspaceDir: string;
  let ceo: McpClientAgent;
  let turn: TurnResult;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'mcp-e2e-data-'));
    workspaceDir = mkdtempSync(join(tmpdir(), 'mcp-e2e-workspace-'));
    mkdirSync(join(workspaceDir, 'shop'));
    rs.stubEnv('WEB_ACCESS_TOKEN', 'web-token');
    rs.stubEnv('DATA_DIR', dataDir);
    rs.stubEnv('WORKSPACE_DIR', workspaceDir);
    ceo = new McpClientAgent();

    const { AppModule } = await import('./../src/app.module.js');
    const module = await createTestingModule({ imports: [AppModule] })
      .overrideProvider(IAgentPortFactory)
      .useValue(new StubAgentPortFactory(() => ceo))
      .compile();
    app = module.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');

    turn = await app.get(IAgentTurnPort).executeTurn({
      conversationId: 'mcp-e2e',
      userId: 'user-1',
      prompt: 'Put the checkout on the board.',
      workspacePath: workspaceDir,
      agentRole: 'CEO',
    });
  });

  afterAll(async () => {
    await app.close();
    rs.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  const port = () => (app.getHttpServer().address() as AddressInfo).port;

  it('should attach the tools to the session of the CEO at the port the server listens on', () => {
    expect(turn.status).toBe('completed');
    expect(ceo.server).toEqual({ name: 'arc', url: `http://127.0.0.1:${port()}/mcp`, headers: { authorization: expect.stringMatching(/^Bearer /) } });
  });

  it('should initialize with the instructions and the skills of the CEO', () => {
    const [initialize, initialized] = ceo.exchanges;

    expect(initialize?.status).toBe(200);
    expect(initialize?.body.result).toMatchObject({ protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } } });
    const instructions: string = initialize?.body.result.instructions;
    expect(instructions.split('\n')[0]).toBe('The board of this conversation and the skills of your team are reached through the tools of this server, and the skills your role may read are listed below.');
    expect(instructions).toMatch(/\n- [a-z-]+: /);
    expect(initialized).toEqual({ status: 202, body: undefined });
  });

  it('should list the tools of the CEO', () => {
    const tools: { name: string }[] = ceo.exchanges[2]?.body.result.tools;

    expect(tools.map(tool => tool.name)).toEqual(['artifact_list', 'artifact_read', 'artifact_create', 'artifact_update', 'artifact_comment', 'skill_read', 'skill_list', 'skill_write']);
  });

  it('should carry out a tool call on the board of the conversation and refuse what the tag path refuses', async () => {
    const [created, frozen] = ceo.exchanges.slice(3);

    expect(created?.body.result).toEqual({ content: [{ type: 'text', text: 'Created feature F-1 "Checkout" in project shop, status backlog.' }], isError: false });
    expect(frozen?.body.result).toEqual({ content: [{ type: 'text', text: 'Only the server freezes an artifact. Set blocked to hold it yourself.' }], isError: true });
    expect(await app.get(IArtifactsPort, { strict: false }).get('mcp-e2e', 'F-1')).toMatchObject({ title: 'Checkout', status: 'backlog' });
  });

  it('should refuse a credential it did not open, the web access token included', async () => {
    const guessed = await ceo.send({ jsonrpc: '2.0', id: 9, method: 'tools/list' }, { authorization: 'Bearer guessed' });
    const webToken = await ceo.send({ jsonrpc: '2.0', id: 9, method: 'tools/list' }, { authorization: 'Bearer web-token' });
    const none = await ceo.send({ jsonrpc: '2.0', id: 9, method: 'tools/list' }, {});

    expect([guessed.status, webToken.status, none.status]).toEqual([401, 401, 401]);
  });

  it('should keep the rest of the server answering on the same port', async () => {
    const health = await fetch(`http://127.0.0.1:${port()}/health`);

    expect(await health.json()).toEqual({ status: 'ok' });
  });
});
