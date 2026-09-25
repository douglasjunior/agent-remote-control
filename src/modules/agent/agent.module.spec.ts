import { Test, type TestingModule } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { AntigravityAdapter } from './adapters/antigravity.adapter.js';
import { NodeFileSystemAdapter } from './adapters/node-file-system.adapter.js';
import { NodeProcessRunnerAdapter } from './adapters/node-process-runner.adapter.js';
import { AgentModule } from './agent.module.js';
import { IAgentPort } from './ports/agent.port.js';
import { IFileSystemPort } from './ports/file-system.port.js';
import { IProcessRunnerPort } from './ports/process-runner.port.js';


describe('AgentModule', () => {
  it('should compile the module and resolve all port providers', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AgentModule],
    }).compile();

    const agent = module.get<IAgentPort>(IAgentPort);
    const processRunner = module.get<IProcessRunnerPort>(IProcessRunnerPort);
    const fileSystem = module.get<IFileSystemPort>(IFileSystemPort);

    expect(agent).toBeInstanceOf(AntigravityAdapter);
    expect(processRunner).toBeInstanceOf(NodeProcessRunnerAdapter);
    expect(fileSystem).toBeInstanceOf(NodeFileSystemAdapter);
  });
});
