import { Module } from '@nestjs/common';

import { AcpAgentPortFactoryAdapter } from './adapters/acp-agent-port-factory.adapter.js';
import { NodeFileSystemAdapter } from './adapters/node-file-system.adapter.js';
import { NodeProcessRunnerAdapter } from './adapters/node-process-runner.adapter.js';
import { IAgentPortFactory } from './ports/agent-port-factory.port.js';
import { IFileSystemPort } from './ports/file-system.port.js';
import { IProcessRunnerPort } from './ports/process-runner.port.js';


@Module({
  providers: [
    {
      provide: IAgentPortFactory,
      useClass: AcpAgentPortFactoryAdapter,
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
  exports: [IAgentPortFactory, IProcessRunnerPort, IFileSystemPort],
})
export class AgentModule {}
