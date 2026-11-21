import { Module } from '@nestjs/common';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { loadEnvironment } from './env-config.js';
import { AgentModule } from './modules/agent/agent.module.js';
import { AgentDefinitionsModule } from './modules/agent-definitions/agent-definitions.module.js';
import { DiscordModule } from './modules/discord/discord.module.js';
import { LoggingModule } from './modules/logging/logging.module.js';
import { McpModule } from './modules/mcp/mcp.module.js';
import { OrchestratorModule } from './modules/orchestrator/orchestrator.module.js';
import { WebModule } from './modules/web/web.module.js';
import { WorkspaceModule } from './modules/workspace/workspace.module.js';


@Module({
  imports: [
    loadEnvironment(),
    LoggingModule,
    AgentModule,
    OrchestratorModule,
    AgentDefinitionsModule,
    WorkspaceModule,
    DiscordModule,
    McpModule,
    ...(process.env.WEB_ENABLED === 'false' ? [] : [WebModule]),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
