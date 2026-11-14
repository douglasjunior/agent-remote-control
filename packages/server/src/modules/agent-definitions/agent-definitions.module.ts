import { Module } from '@nestjs/common';

import { IAgentRegistryPort } from '../orchestrator/ports/agent-registry.port.js';
import { IAgentSkillsPort } from '../orchestrator/ports/agent-skills.port.js';
import { PathsModule } from '../paths/paths.module.js';

import { FileUserSkillStoreAdapter } from './adapters/file-user-skill-store.adapter.js';
import { IUserSkillStorePort } from './ports/user-skill-store.port.js';
import { AgentRegistryService } from './services/agent-registry.service.js';
import { AgentSkillsService } from './services/agent-skills.service.js';


@Module({
  imports: [PathsModule],
  providers: [
    AgentRegistryService,
    {
      provide: IAgentRegistryPort,
      useExisting: AgentRegistryService,
    },
    { provide: IUserSkillStorePort, useClass: FileUserSkillStoreAdapter },
    { provide: IAgentSkillsPort, useClass: AgentSkillsService },
  ],
  exports: [AgentRegistryService, IAgentRegistryPort, IAgentSkillsPort],
})
export class AgentDefinitionsModule {}
