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
import { CodexAdapter } from './codex.adapter.js';
import { CopilotAdapter } from './copilot.adapter.js';
import { CURSOR_BINARIES, CursorAdapter } from './cursor.adapter.js';


type AgentProvider = AgentProviderInfo & {
  readonly binaries: readonly string[];
  readonly build: () => IAgentPort;
};

const FALLBACK_AGENT_ID = 'agy';

@Injectable()
export class AcpAgentPortFactoryAdapter implements IAgentPortFactory {
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
        binaries: ['agy'],
        build: () => new AntigravityAdapter(this.fileSystem, this.processRunner),
      },
      {
        agentId: 'claude',
        displayName: 'Claude Code',
        binaries: ['claude'],
        build: () => new ClaudeCodeAdapter(this.fileSystem, this.processRunner),
      },
      {
        agentId: 'copilot',
        displayName: 'GitHub Copilot',
        binaries: ['copilot'],
        build: () => new CopilotAdapter(this.processRunner),
      },
      {
        agentId: 'codex',
        displayName: 'OpenAI Codex',
        binaries: ['codex'],
        build: () => new CodexAdapter(this.fileSystem, this.processRunner),
      },
      {
        agentId: 'cursor',
        displayName: 'Cursor',
        binaries: CURSOR_BINARIES,
        build: () => new CursorAdapter(this.fileSystem, this.processRunner),
      },
    ];
  }

  /** Falls back to the first available agent so a fresh conversation starts on one that can run. */
  get defaultAgentId(): string {
    if (this.isAgentAvailable(FALLBACK_AGENT_ID)) {
      return FALLBACK_AGENT_ID;
    }
    return this.listAvailableAgents()[0]?.agentId ?? FALLBACK_AGENT_ID;
  }

  listAgents(): readonly AgentProviderInfo[] {
    return this.providers.map(provider => this.toInfo(provider));
  }

  /** Evaluated on every call, so an agent installed while the application runs appears without a restart. */
  listAvailableAgents(): readonly AgentProviderInfo[] {
    return this.providers
      .filter(provider => this.hasBinaryInPath(provider))
      .map(provider => this.toInfo(provider));
  }

  isAgentAvailable(agentId: string): boolean {
    const provider = this.providers.find(candidate => candidate.agentId === agentId);
    return provider !== undefined && this.hasBinaryInPath(provider);
  }

  create(agentId: string): IAgentPort {
    const provider = this.providers.find(candidate => candidate.agentId === agentId);
    if (!provider) {
      const available = this.providers.map(candidate => candidate.agentId).join(', ');
      throw new Error(`Unknown agent "${agentId}". Available agents: ${available}.`);
    }
    return provider.build();
  }

  private hasBinaryInPath(provider: AgentProvider): boolean {
    return provider.binaries.some(binary => this.fileSystem.isInPath(binary));
  }

  private toInfo({ agentId, displayName }: AgentProvider): AgentProviderInfo {
    return { agentId, displayName };
  }
}
