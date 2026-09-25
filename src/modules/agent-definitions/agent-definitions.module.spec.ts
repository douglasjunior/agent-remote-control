import { Test, type TestingModule } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { IAgentRegistryPort } from '../orchestrator/ports/agent-registry.port.js';

import { AgentDefinitionsModule } from './agent-definitions.module.js';
import { AgentRegistryService } from './services/agent-registry.service.js';


describe('AgentDefinitionsModule', () => {
  it('should compile the module and resolve agent registry providers', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AgentDefinitionsModule],
    }).compile();

    const service = module.get<AgentRegistryService>(AgentRegistryService);
    const registryPort = module.get<IAgentRegistryPort>(IAgentRegistryPort);

    expect(service).toBeInstanceOf(AgentRegistryService);
    expect(registryPort).toBeInstanceOf(AgentRegistryService);
  });
});
