import { Inject, Injectable, Logger } from '@nestjs/common';

import type { Artifact, ArtifactStatus } from '../../artifacts/models/artifact.model.js';
import { IArtifactsPort } from '../../artifacts/ports/artifacts.port.js';
import { statusSetByUserWhileHeld } from '../../artifacts/utils/artifact-status.util.js';
import { type DelegationStatusFlow, IAgentRegistryPort } from '../ports/agent-registry.port.js';


const SYSTEM_ACTOR = { kind: 'system' } as const;
const LEADING_DECORATION = /^[\s#*_`>]+/;
const VERDICT_LABEL = /^verdict\s*:/i;
const WORD_END = /^(?![A-Za-z0-9]|_[A-Za-z0-9])/;

/** Moves the status of the task a delegation works on: the start of the delegation and the verdict that opens the agent's final answer. */
@Injectable()
export class DelegationStatusService {
  private readonly logger = new Logger(DelegationStatusService.name);

  constructor(
    @Inject(IArtifactsPort) private readonly artifacts: IArtifactsPort,
    @Inject(IAgentRegistryPort) private readonly agentRegistry: IAgentRegistryPort,
  ) {}

  /** Why delegating `artifact` to `role` is out of order, or `undefined` when its status fits the role or the role takes no status flow. */
  refusal(role: string, artifact: Artifact): string | undefined {
    const flow = this.flowOf(role);
    if (!flow || artifact.type !== 'task' || flow.from.includes(artifact.status)) {
      return undefined;
    }
    const takes = flow.from.join(', ');
    const base = `${role} works on ${artifact.id} only while it is ${takes}, and it is ${artifact.status} right now.`;
    const owed = artifact.status === 'backlog' ? this.owedRefinements(artifact) : [];
    if (owed.length > 0) {
      return `${base} It still owes ${owed.join(' and ')}: the agent that settles it comes first, so delegate ${artifact.id} to it, or set the refinement to skipped when the user does not want it.`;
    }
    return `${base} That status waits for another step: delegate that step first. When the user does not want it, skip it by setting the status to ${flow.from[0]}, which ${role} takes.`;
  }

  /** Sets the status the role starts a task in, when it has one and the task is not in it. */
  async start(conversationId: string, artifactId: string, role: string): Promise<void> {
    const start = this.flowOf(role)?.start;
    const artifact = start ? await this.artifacts.get(conversationId, artifactId) : undefined;
    if (!start || artifact?.type !== 'task' || artifact.status === start) {
      return;
    }
    await this.setStatus(conversationId, artifactId, start, `Delegated to ${this.agentRegistry.getDisplayName(role)}`);
  }

  /**
   * Applies the status of the verdict that opens `response` and returns the verdict as the flow writes it; `undefined`
   * when the response has none, which changes nothing. A status the user set while the agent held the task stands.
   */
  async finish(conversationId: string, artifactId: string, role: string, response: string): Promise<string | undefined> {
    const flow = this.flowOf(role);
    const verdict = flow ? this.findVerdict(flow, response) : undefined;
    if (!flow || !verdict) {
      return undefined;
    }
    const artifact = await this.artifacts.get(conversationId, artifactId);
    const target = flow.verdicts[verdict]!;
    if (artifact?.type === 'task' && artifact.status !== target && !statusSetByUserWhileHeld(artifact)) {
      await this.setStatus(conversationId, artifactId, target, `${this.agentRegistry.getDisplayName(role)} answered ${verdict}`);
    }
    return verdict;
  }

  private flowOf(role: string): DelegationStatusFlow | undefined {
    return this.agentRegistry.getDelegationContract(role).statusFlow;
  }

  private async setStatus(conversationId: string, artifactId: string, status: ArtifactStatus, note: string): Promise<void> {
    const outcome = await this.artifacts.update(conversationId, artifactId, { status, note }, SYSTEM_ACTOR);
    if (!outcome.ok) {
      this.logger.warn(`Could not set ${artifactId} to ${status}: ${outcome.error}`);
    }
  }

  /** Each refinement the task still owes, with the roles that settle it. */
  private owedRefinements(artifact: Artifact): string[] {
    const owed = (['business', 'technical'] as const).filter(kind => artifact.refinement[kind] === 'pending');
    return owed.map((kind) => {
      const roles = this.agentRegistry.listRoles().filter(role => this.agentRegistry.getDelegationContract(role).refines === kind);
      return `the ${kind} refinement${roles.length > 0 ? ` (${roles.join(' or ')})` : ''}`;
    });
  }

  /** The key of `flow.verdicts` the first non-empty line starts with, as a whole word, once its Markdown decoration and `Verdict:` label are off. */
  private findVerdict(flow: DelegationStatusFlow, response: string): string | undefined {
    const firstLine = response.split('\n').find(line => line.trim() !== '') ?? '';
    const line = firstLine
      .replace(LEADING_DECORATION, '')
      .replace(VERDICT_LABEL, '')
      .replace(LEADING_DECORATION, '');
    return Object.keys(flow.verdicts).find((verdict) => {
      return line.slice(0, verdict.length).toLowerCase() === verdict.toLowerCase() && WORD_END.test(line.slice(verdict.length));
    });
  }
}
