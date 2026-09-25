import { Module } from '@nestjs/common';

import { IAgentRegistryPort } from '../orchestrator/ports/agent-registry.port.js';

import { AgentRegistryService } from './services/agent-registry.service.js';


@Module({
  providers: [
    AgentRegistryService,
    {
      provide: IAgentRegistryPort,
      useClass: AgentRegistryService,
    },
  ],
  exports: [AgentRegistryService, IAgentRegistryPort],
})
export class AgentDefinitionsModule {}
