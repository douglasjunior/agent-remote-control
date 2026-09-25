import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AgentDefinitionsModule } from './modules/agent-definitions/agent-definitions.module.js';
import { AgentModule } from './modules/agent/agent.module.js';
import { OrchestratorModule } from './modules/orchestrator/orchestrator.module.js';
import { WorkspaceModule } from './modules/workspace/workspace.module.js';

@Module({
  imports: [
    AgentModule,
    OrchestratorModule,
    AgentDefinitionsModule,
    WorkspaceModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
