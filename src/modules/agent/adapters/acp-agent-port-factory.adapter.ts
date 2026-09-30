import { Inject, Injectable } from '@nestjs/common';

import type {
  AgentProviderInfo,
  IAgentPortFactory,
} from '../ports/agent-port-factory.port.js';
import type { IAgentPort } from '../ports/agent.port.js';
import { IFileSystemPort } from '../ports/file-system.port.js';
import { IProcessRunnerPort } from '../ports/process-runner.port.js';

import { AntigravityAdapter } from './antigravity.adapter.js';
import { ClaudeCodeAdapter } from './claude-code.adapter.js';


type AgentProvider = AgentProviderInfo & { readonly build: () => IAgentPort };

@Injectable()
export class AcpAgentPortFactoryAdapter implements IAgentPortFactory {
  readonly defaultAgentId = 'agy';
  private readonly providers: readonly AgentProvider[];

  constructor(
    @Inject(IFileSystemPort)
    private readonly fileSystem: IFileSystemPort,
    @Inject(IProcessRunnerPort)
    private readonly processRunner: IProcessRunnerPort,
  ) {
    this.providers = [
      {
        agentId: 'agy',
        displayName: 'Antigravity',
        build: () => new AntigravityAdapter(this.fileSystem, this.processRunner),
      },
      {
        agentId: 'claude',
        displayName: 'Claude Code',
        build: () => new ClaudeCodeAdapter(this.fileSystem, this.processRunner),
      },
    ];
  }

  listAgents(): readonly AgentProviderInfo[] {
    return this.providers.map(({ agentId, displayName }) => ({ agentId, displayName }));
  }

  create(agentId: string): IAgentPort {
    const provider = this.providers.find(candidate => candidate.agentId === agentId);
    if (!provider) {
      const available = this.providers.map(candidate => candidate.agentId).join(', ');
      throw new Error(`Unknown agent "${agentId}". Available agents: ${available}.`);
    }
    return provider.build();
  }
}
