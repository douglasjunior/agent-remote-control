import { Test, type TestingModule } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { AntigravityPortFactoryAdapter } from './adapters/antigravity-port-factory.adapter.js';
import { NodeFileSystemAdapter } from './adapters/node-file-system.adapter.js';
import { NodeProcessRunnerAdapter } from './adapters/node-process-runner.adapter.js';
import { AgentModule } from './agent.module.js';
import { IAgentPortFactory } from './ports/agent-port-factory.port.js';
import { IFileSystemPort } from './ports/file-system.port.js';
import { IProcessRunnerPort } from './ports/process-runner.port.js';


describe('AgentModule', () => {
  it('should compile the module and resolve all port providers', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AgentModule],
    }).compile();

    const agentFactory = module.get<IAgentPortFactory>(IAgentPortFactory);
    const processRunner = module.get<IProcessRunnerPort>(IProcessRunnerPort);
    const fileSystem = module.get<IFileSystemPort>(IFileSystemPort);

    expect(agentFactory).toBeInstanceOf(AntigravityPortFactoryAdapter);
    expect(processRunner).toBeInstanceOf(NodeProcessRunnerAdapter);
    expect(fileSystem).toBeInstanceOf(NodeFileSystemAdapter);
  });
});
