import { Module } from '@nestjs/common';

import { AcpAgentPortFactoryAdapter } from './adapters/acp-agent-port-factory.adapter.js';
import { CliAgentAuthAdapter } from './adapters/cli-agent-auth.adapter.js';
import { NodeFileSystemAdapter } from './adapters/node-file-system.adapter.js';
import { NodeProcessRunnerAdapter } from './adapters/node-process-runner.adapter.js';
import { IAgentAuthPort } from './ports/agent-auth.port.js';
import { IAgentPortFactory } from './ports/agent-port-factory.port.js';
import { IFileSystemPort } from './ports/file-system.port.js';
import { IProcessRunnerPort } from './ports/process-runner.port.js';
import { AgentAuthConfigService } from './services/agent-auth-config.service.js';


@Module({
  providers: [
    AgentAuthConfigService,
    {
      provide: IAgentAuthPort,
      useClass: CliAgentAuthAdapter,
    },
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
  exports: [IAgentAuthPort, IAgentPortFactory, IProcessRunnerPort, IFileSystemPort],
})
export class AgentModule {}
