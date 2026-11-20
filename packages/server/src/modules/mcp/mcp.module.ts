import { Module } from '@nestjs/common';

import { OrchestratorModule } from '../orchestrator/orchestrator.module.js';

import { McpHttpHandler } from './handlers/mcp-http.handler.js';
import { McpRpcService } from './services/mcp-rpc.service.js';


@Module({
  imports: [OrchestratorModule],
  providers: [McpRpcService, McpHttpHandler],
})
export class McpModule {}
