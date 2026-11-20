import { Inject, Injectable, Logger } from '@nestjs/common';

import type { AgentToolCatalog } from '../../orchestrator/models/agent-tool.model.js';
import { IAgentToolsPort } from '../../orchestrator/ports/agent-tools.port.js';
import { MCP_PROTOCOL_VERSIONS, MCP_SERVER_INFO } from '../constants/mcp.constant.js';
import {
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_SESSION_CLOSED,
  type JsonRpcId,
  jsonRpcError,
  type JsonRpcResponse,
} from '../models/json-rpc.model.js';


type Params = Readonly<Record<string, unknown>>;

/** A failure answered as a JSON-RPC error. */
class RpcError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

const SESSION_CLOSED = 'The tool session is closed.';

/**
 * Answers the MCP methods the agent tools need: `initialize`, `ping`, `tools/list` and `tools/call`, empty lists of
 * resources and prompts, and `Method not found` for anything else, which clients such as those that start with
 * `server/discover` carry on from. Notifications and the client's own responses get no answer.
 */
@Injectable()
export class McpRpcService {
  private readonly logger = new Logger(McpRpcService.name);

  constructor(@Inject(IAgentToolsPort) private readonly agentTools: IAgentToolsPort) {}

  async handle(message: unknown, credential: string): Promise<JsonRpcResponse | undefined> {
    if (!this.isObject(message) || typeof message.method !== 'string') {
      return this.isObject(message) && ('result' in message || 'error' in message)
        ? undefined
        : jsonRpcError(this.idOf(message), JSON_RPC_INVALID_REQUEST, 'Invalid request.');
    }
    if (message.id === undefined) {
      return undefined;
    }
    const id = this.idOf(message);
    const params = this.isObject(message.params) ? message.params : {};
    try {
      return { jsonrpc: '2.0', id, result: await this.dispatch(message.method, params, credential) };
    } catch (error) {
      if (error instanceof RpcError) {
        return jsonRpcError(id, error.code, error.message);
      }
      this.logger.error(`[MCP Request Failed] Method=${message.method}: ${error instanceof Error ? error.message : String(error)}`);
      return jsonRpcError(id, JSON_RPC_INTERNAL_ERROR, 'Internal error.');
    }
  }

  private async dispatch(method: string, params: Params, credential: string): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return this.initialize(params, credential);
      case 'ping':
        return {};
      case 'tools/list':
        return { tools: (await this.catalog(credential)).tools };
      case 'tools/call':
        return this.callTool(params, credential);
      case 'resources/list':
        return { resources: [] };
      case 'resources/templates/list':
        return { resourceTemplates: [] };
      case 'prompts/list':
        return { prompts: [] };
      default:
        throw new RpcError(JSON_RPC_METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  }

  private async initialize(params: Params, credential: string): Promise<unknown> {
    const { instructions } = await this.catalog(credential);
    const requested = params.protocolVersion;
    return {
      protocolVersion: typeof requested === 'string' && MCP_PROTOCOL_VERSIONS.includes(requested) ? requested : MCP_PROTOCOL_VERSIONS[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: MCP_SERVER_INFO,
      instructions,
    };
  }

  private async catalog(credential: string): Promise<AgentToolCatalog> {
    const catalog = await this.agentTools.describe(credential);
    if (!catalog) {
      throw new RpcError(JSON_RPC_SESSION_CLOSED, SESSION_CLOSED);
    }
    return catalog;
  }

  /** A tool that fails to run answers as a failed call, so the agent reads why. */
  private async callTool(params: Params, credential: string): Promise<unknown> {
    const { name } = params;
    if (typeof name !== 'string') {
      throw new RpcError(JSON_RPC_INVALID_PARAMS, 'tools/call needs the name of the tool.');
    }
    const args = this.isObject(params.arguments) ? params.arguments : {};
    let result;
    try {
      result = await this.agentTools.call(credential, name, args);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`[MCP Tool Failed] Tool=${name}: ${reason}`);
      return this.toolResult(`The server failed to carry out ${name}: ${reason}`, true);
    }
    switch (result.status) {
      case 'closed':
        throw new RpcError(JSON_RPC_SESSION_CLOSED, SESSION_CLOSED);
      case 'unknown_tool':
        throw new RpcError(JSON_RPC_INVALID_PARAMS, `Unknown tool: ${name}`);
      default:
        return this.toolResult(result.text, result.isError);
    }
  }

  private toolResult(text: string, isError: boolean): unknown {
    return { content: [{ type: 'text', text }], isError };
  }

  private idOf(message: unknown): JsonRpcId {
    const id = this.isObject(message) ? message.id : undefined;
    return typeof id === 'string' || typeof id === 'number' ? id : null;
  }

  private isObject(value: unknown): value is Params {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
