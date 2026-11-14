import { Inject, Injectable } from '@nestjs/common';

import { IAgentPortFactory } from '../../agent/ports/agent-port-factory.port.js';
import { UNSET_LABEL } from '../constants/unset-label.constant.js';
import type { AgentSettings } from '../models/agent-settings.model.js';
import type { TurnAgentInfo } from '../models/turn-agent-info.model.js';
import type { TurnRequest } from '../models/turn-request.model.js';
import { IAgentRegistryPort } from '../ports/agent-registry.port.js';
import { IAgentSettingsStorePort } from '../ports/agent-settings-store.port.js';
import { resolveProfile } from '../utils/agent-profile.util.js';

import { ConversationRuntimeService } from './conversation-runtime.service.js';
import { UserQuestionQueueService } from './user-question-queue.service.js';


/** The `[TEAM_PROFILES]` block of the CEO prompt: each agent of the team, its profile and what it is doing. */
@Injectable()
export class TeamProfilesService {
  constructor(
    @Inject(IAgentPortFactory) private readonly agentPortFactory: IAgentPortFactory,
    @Inject(IAgentRegistryPort) private readonly agentRegistry: IAgentRegistryPort,
    @Inject(IAgentSettingsStorePort) private readonly settingsStore: IAgentSettingsStorePort,
    private readonly conversationRuntime: ConversationRuntimeService,
    private readonly questionQueue: UserQuestionQueueService,
  ) {}

  /** The signature ignores elapsed time, so only a change in a profile, in who is working, their task summary or their wait state resends the block. */
  async build(
    conversationKey: string,
    request: TurnRequest,
  ): Promise<{ readonly text: string; readonly signature: string }> {
    const delegations = this.conversationRuntime.getActiveDelegations(conversationKey);
    const settings = await this.settingsStore.load(request.conversationId);
    const lines: string[] = [];
    const signature: string[] = [];
    for (const role of this.agentRegistry.listRoles()) {
      if (role === request.agentRole) {
        continue;
      }
      const delegation = delegations.find(active => active.role === role);
      const { agentName, modelName, effortName } = delegation?.agentInfo ?? this.describeProfile(settings, role);
      const profile = `Agent: ${agentName}, Model: ${modelName ?? UNSET_LABEL}, Effort: ${effortName ?? UNSET_LABEL}`;
      if (!delegation) {
        lines.push(`- ${role}: ${profile}, Status: idle`);
        signature.push(`${role}\u0000${profile}\u0000idle`);
        continue;
      }
      const waiting = this.questionQueue.isWaiting(conversationKey, role, delegation.projectName) ? 'yes' : 'no';
      const artifact = delegation.artifactId ? `Artifact: ${delegation.artifactId}, ` : '';
      const work = `Project: ${delegation.projectName ?? 'none'}, ${artifact}Waiting for user: ${waiting}, Summary: "${delegation.summary}"`;
      lines.push(`- ${role}: ${profile}, Status: working, Running: ${this.formatElapsed(Date.now() - delegation.startedAt)}, ${work}`);
      signature.push(`${role}\u0000${profile}\u0000working\u0000${work}`);
    }
    return { text: `[TEAM_PROFILES]\n${lines.join('\n')}\n`, signature: signature.join('\u0001') };
  }

  private describeProfile(settings: AgentSettings | null, role: string): Omit<TurnAgentInfo, 'roleName'> {
    const profile = settings ? resolveProfile(settings, role) : undefined;
    if (!profile) {
      const { defaultAgentId } = this.agentPortFactory;
      return { agentName: this.agentPortFactory.listAgents().find(agent => agent.agentId === defaultAgentId)?.displayName ?? defaultAgentId };
    }
    return {
      agentName: profile.agentName,
      ...(profile.modelName ? { modelName: profile.modelName } : {}),
      ...(profile.effortName ? { effortName: profile.effortName } : {}),
    };
  }

  private formatElapsed(elapsedMs: number): string {
    const seconds = Math.floor(elapsedMs / 1000);
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`;
  }
}
