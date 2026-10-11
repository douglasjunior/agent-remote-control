import { Inject, Injectable } from '@nestjs/common';

import { IAgentPortFactory } from '../../agent/ports/agent-port-factory.port.js';
import type { AgentQuotaReport } from '../models/agent-quota-report.model.js';
import { IAgentSettingsStorePort } from '../ports/agent-settings-store.port.js';
import { AgentCapabilitiesService } from '../services/agent-capabilities.service.js';


@Injectable()
export class GetAgentQuotaUseCase {
  constructor(
    private readonly capabilities: AgentCapabilitiesService,
    @Inject(IAgentPortFactory)
    private readonly agentPortFactory: IAgentPortFactory,
    @Inject(IAgentSettingsStorePort)
    private readonly settingsStore: IAgentSettingsStorePort,
  ) {}

  async execute(conversationId: string): Promise<AgentQuotaReport> {
    const agent = this.capabilities.resolveAgent(await this.settingsStore.load(conversationId));
    const quota = await this.agentPortFactory.create(agent.id).getQuota();
    return { agent, quota };
  }
}
