import { Module } from '@nestjs/common';

import { AntigravityAdapter } from './adapters/antigravity.adapter.js';
import { NodeFileSystemAdapter } from './adapters/node-file-system.adapter.js';
import { NodeProcessRunnerAdapter } from './adapters/node-process-runner.adapter.js';
import { IAgentPort } from './ports/agent.port.js';
import { IFileSystemPort } from './ports/file-system.port.js';
import { IProcessRunnerPort } from './ports/process-runner.port.js';

@Module({
  providers: [
    {
      provide: IAgentPort,
      useClass: AntigravityAdapter,
    },
    {
      provide: IProcessRunnerPort,
      useClass: NodeProcessRunnerAdapter,
    },
    {
      provide: IFileSystemPort,
      useClass: NodeFileSystemAdapter,
    },
  ],
  exports: [IAgentPort, IProcessRunnerPort, IFileSystemPort],
})
export class AgentModule {}
