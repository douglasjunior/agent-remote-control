import { Inject, Injectable, Logger } from '@nestjs/common';

import { REFINEMENT_KINDS } from '../../artifacts/constants/artifact-catalog.constant.js';
import type { Artifact, ArtifactStatus } from '../../artifacts/models/artifact.model.js';
import { IArtifactsPort } from '../../artifacts/ports/artifacts.port.js';
import { type DelegationStatusFlow, IAgentRegistryPort } from '../ports/agent-registry.port.js';
import { formatWordList } from '../utils/word-list.util.js';


/** The verdict that opened an agent's final answer, as the flow writes it, and whether it moved the task on. */
export type DelegationVerdict = {
  readonly verdict: string;
  readonly closesStep: boolean;
};

const SYSTEM_ACTOR = { kind: 'system' } as const;
const LEADING_DECORATION = /^[\s#*_`>]+/;
const VERDICT_LABEL = /^verdict\s*:/i;
const CLOSING_DECORATION = /[\s*_`.:]+$/;

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
      return `${base} It still owes ${formatWordList(owed)}: the agent that settles it comes first, so delegate ${artifact.id} to it, or set the refinement to skipped when the user does not want it.`;
    }
    return `${base} That status waits for another step: delegate that step first. When the user does not want it, skip it by setting the status to ${flow.from[0]}, which ${role} takes.`;
  }

  /**
   * Moves the task to the status the role starts in, only from a status the role takes, and returns the status the
   * delegation works in: `undefined` when the role takes no status flow, the artifact is not a task, or the task sits
   * in a status the role does not take (restored work skips the validator, and the task may have moved meanwhile).
   */
  async start(conversationId: string, artifactId: string, role: string): Promise<ArtifactStatus | undefined> {
    const flow = this.flowOf(role);
    const artifact = flow ? await this.artifacts.get(conversationId, artifactId) : undefined;
    if (!flow || artifact?.type !== 'task') {
      return undefined;
    }
    if (!flow.from.includes(artifact.status)) {
      this.logger.log(`[Delegation Status Kept] ${artifactId} is ${artifact.status}, which ${role} does not take`);
      return undefined;
    }
    if (!flow.start || artifact.status === flow.start) {
      return artifact.status;
    }
    const started = await this.setStatus(conversationId, artifactId, flow.start, `Delegated to ${this.agentRegistry.getDisplayName(role)}`);
    return started ? flow.start : artifact.status;
  }

  /**
   * Reads the verdict that opens `response` and applies its status while the task is still in `workingStatus`, the
   * status `start` returned: a status someone else set while the agent worked stands. `undefined` when the response
   * opens with no verdict, which changes nothing. `closesStep` is whether the verdict moves the task out of the status
   * the delegation worked in; a verdict that keeps it there (more work, a block) does not.
   */
  async finish(
    conversationId: string,
    artifactId: string,
    role: string,
    response: string,
    workingStatus: ArtifactStatus | undefined,
  ): Promise<DelegationVerdict | undefined> {
    const flow = this.flowOf(role);
    const verdict = flow ? this.findVerdict(flow, response) : undefined;
    if (!flow || !verdict) {
      return undefined;
    }
    const target = flow.verdicts[verdict]!;
    const closesStep = workingStatus !== undefined && target !== workingStatus;
    const artifact = await this.artifacts.get(conversationId, artifactId);
    if (closesStep && artifact?.status === workingStatus) {
      await this.setStatus(conversationId, artifactId, target, `${this.agentRegistry.getDisplayName(role)} answered ${verdict}`);
    }
    return { verdict, closesStep };
  }

  private flowOf(role: string): DelegationStatusFlow | undefined {
    return this.agentRegistry.getDelegationContract(role).statusFlow;
  }

  private async setStatus(conversationId: string, artifactId: string, status: ArtifactStatus, note: string): Promise<boolean> {
    const outcome = await this.artifacts.update(conversationId, artifactId, { status, note }, SYSTEM_ACTOR);
    if (!outcome.ok) {
      this.logger.warn(`Could not set ${artifactId} to ${status}: ${outcome.error}`);
    }
    return outcome.ok;
  }

  /** Each refinement the task still owes, with the roles that settle it. */
  private owedRefinements(artifact: Artifact): string[] {
    const owed = REFINEMENT_KINDS.filter(kind => artifact.refinement[kind] === 'pending');
    return owed.map((kind) => {
      const roles = this.agentRegistry.listRoles().filter(role => this.agentRegistry.getDelegationContract(role).refines === kind);
      return `the ${kind} refinement${roles.length > 0 ? ` (${roles.join(' or ')})` : ''}`;
    });
  }

  /**
   * The key of `flow.verdicts` that is the whole first non-empty line, in the case the key is written in, once the
   * line's Markdown decoration, `Verdict:` label and closing punctuation are off. A line that goes on after the word,
   * or writes it in another case, is prose that happens to start with it ("Passed 4 of 6 tests").
   */
  private findVerdict(flow: DelegationStatusFlow, response: string): string | undefined {
    const firstLine = response.split('\n').find(line => line.trim() !== '') ?? '';
    const word = firstLine
      .replace(LEADING_DECORATION, '')
      .replace(VERDICT_LABEL, '')
      .replace(LEADING_DECORATION, '')
      .replace(CLOSING_DECORATION, '');
    return Object.keys(flow.verdicts).find(verdict => verdict === word);
  }
}
