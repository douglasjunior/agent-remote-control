import { createTestingModule } from '../../../test/testing-module.js';

import { McpHttpHandler } from './handlers/mcp-http.handler.js';
import { McpModule } from './mcp.module.js';
import { McpRpcService } from './services/mcp-rpc.service.js';


describe('McpModule', () => {
  it('should resolve the endpoint handler and its JSON-RPC service', async () => {
    const module = await createTestingModule({ imports: [McpModule] }).compile();

    expect(module.get(McpHttpHandler)).toBeInstanceOf(McpHttpHandler);
    expect(module.get(McpRpcService)).toBeInstanceOf(McpRpcService);
  });
});
