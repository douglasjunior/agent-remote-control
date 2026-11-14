import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { FROZEN_STATUS } from '../../artifacts/constants/artifact-catalog.constant.js';
import type { Artifact, ArtifactActor, ArtifactChanges, ArtifactOutcome } from '../../artifacts/models/artifact.model.js';
import { IArtifactsPort } from '../../artifacts/ports/artifacts.port.js';
import type { AgentRequest, AgentRequester } from '../models/agent-request.model.js';
import type { SkillActivity } from '../models/turn-activity.model.js';
import { type ArtifactAccess, type ArtifactField, IAgentRegistryPort } from '../ports/agent-registry.port.js';
import { IAgentSkillsPort } from '../ports/agent-skills.port.js';
import { ArtifactPromptFormatterService } from '../services/artifact-prompt-formatter.service.js';
import { escapeTagAttribute } from '../utils/protocol-tag.util.js';


type Result = {
  readonly request: string;
  readonly id?: string;
  readonly ref?: string;
  readonly name?: string;
  readonly failed?: boolean;
  /** Whether a skill write created the skill. */
  readonly created?: boolean;
  readonly body: string;
};

/** Fields a coordinating agent may change on an artifact another agent holds: they steer the work without touching its content. */
const BOARD_FIELDS_WHILE_HELD: readonly ArtifactField[] = ['status', 'refinement'];


/**
 * Carries out the requests of one agent response, in order, and writes their results for that same agent. Artifact
 * requests act on the board of the conversation and are checked against the agent's access: what it may read, which
 * fields and sections it may write, and the rule that an artifact another agent holds is not changed under it. Skill
 * requests read the skills of the agent's role and, for a role that writes skills, list and write them.
 */
@Injectable()
export class RunAgentRequestsUseCase {
  private readonly logger = new Logger(RunAgentRequestsUseCase.name);

  constructor(
    @Inject(IArtifactsPort) private readonly artifacts: IArtifactsPort,
    @Inject(IAgentRegistryPort) private readonly agentRegistry: IAgentRegistryPort,
    private readonly formatter: ArtifactPromptFormatterService,
    @Inject(IAgentSkillsPort) private readonly skills: IAgentSkillsPort,
  ) {}

  /** `onSkill` hears each skill read or written, for the channel to show it. */
  async execute(requests: readonly AgentRequest[], requester: AgentRequester, onSkill?: (activity: SkillActivity) => void): Promise<string> {
    const access = this.agentRegistry.getArtifactAccess(requester.role);
    const refs = new Map<string, string>();
    const results: Result[] = [];
    for (const request of requests) {
      const result = await this.run(request, requester, access, refs);
      results.push(result);
      if (request.kind === 'skill_read' || request.kind === 'skill_write') {
        onSkill?.(this.skillActivity(request, result));
      }
    }
    this.logger.log(`[Agent Requests] Conversation=${requester.conversationId}, Role=${requester.role}, Requests=${requests.length}, Failed=${results.filter(result => result.failed).length}`);
    return [
      '<request_results>',
      ...results.map(result => this.formatResult(result)),
      '</request_results>',
    ].join('\n');
  }

  private async run(request: AgentRequest, requester: AgentRequester, access: ArtifactAccess, refs: Map<string, string>): Promise<Result> {
    switch (request.kind) {
      case 'invalid':
        return { request: 'invalid', failed: true, body: `${request.reason} (in ${request.tag})` };
      case 'list':
        return this.list(request, requester, access, refs);
      case 'read':
        return this.read(request, requester, access);
      case 'create':
        return this.create(request, requester, access, refs);
      case 'update':
        return this.update(request, requester, access, refs);
      case 'skill_read':
        return this.readSkills(request, requester);
      case 'skill_list':
        return this.listSkills(requester);
      case 'skill_write':
        return this.writeSkill(request, requester);
      default:
        return this.comment(request, requester, access);
    }
  }

  private skillActivity(request: Extract<AgentRequest, { kind: 'skill_read' | 'skill_write' }>, result: Result): SkillActivity {
    const base = { kind: 'skill' as const, id: randomUUID() };
    const outcome = result.failed ? { status: 'failed' as const, error: result.body } : { status: 'completed' as const };
    return request.kind === 'skill_read'
      ? { ...base, action: 'read', names: request.names, ...outcome }
      : { ...base, action: 'write', names: [request.name], ...outcome, ...(result.created !== undefined ? { created: result.created } : {}) };
  }

  private async readSkills({ names }: Extract<AgentRequest, { kind: 'skill_read' }>, { role }: AgentRequester): Promise<Result> {
    const name = names.join(',');
    const bodies: string[] = [];
    for (const requested of names) {
      const skill = await this.skills.read(role, requested);
      if (!skill) {
        const available = (await this.skills.list(role)).map(summary => summary.name);
        const known = available.length > 0 ? `Your skills are: ${available.join(', ')}.` : 'Your role has no skills.';
        return { request: 'skill_read', name, failed: true, body: `Unknown skill "${requested}". ${known}` };
      }
      bodies.push(`# Skill: ${skill.name}\n\n${skill.content}`);
    }
    return { request: 'skill_read', name, body: bodies.join('\n\n---\n\n') };
  }

  private async listSkills({ role }: AgentRequester): Promise<Result> {
    if (!this.skills.writesSkills(role)) {
      return { request: 'skill_list', failed: true, body: 'Listing the skills of every role is reserved to the agents that write skills.' };
    }
    const skills = await this.skills.listAll();
    const lines = skills.map(skill => `- ${skill.name} (${skill.builtIn ? 'built-in' : 'user'}; roles: ${skill.roles.join(', ')}): ${skill.description}`);
    return { request: 'skill_list', body: lines.length > 0 ? lines.join('\n') : 'There are no skills.' };
  }

  private async writeSkill({ name, description, roles, content }: Extract<AgentRequest, { kind: 'skill_write' }>, { role }: AgentRequester): Promise<Result> {
    const result = await this.skills.write(role, { name, description, roles, content });
    if (!result.ok) {
      return { request: 'skill_write', name, failed: true, body: result.error };
    }
    const action = result.created ? 'Created' : 'Updated';
    return { request: 'skill_write', name, created: result.created, body: `${action} skill "${name}" for ${roles.join(', ')}. Agents of those roles see it in their skill catalog from their next session, and its content applies the next time it is read.` };
  }

  private async list(request: Extract<AgentRequest, { kind: 'list' }>, { conversationId }: AgentRequester, access: ArtifactAccess, refs: Map<string, string>): Promise<Result> {
    const types = access.scope === 'task' ? ['task' as const] : request.types;
    const parentId = request.parent === undefined || request.parent === null ? request.parent : this.resolve(request.parent, refs);
    const listed = await this.artifacts.list(conversationId, {
      ...(types ? { types } : {}),
      ...(request.statuses ? { statuses: request.statuses } : {}),
      ...(parentId !== undefined ? { parentId } : {}),
      ...(request.project ? { projectName: request.project } : {}),
    });
    const all = await this.artifacts.list(conversationId, { statuses: 'all' });
    return { request: 'list', body: this.formatter.list(listed, all) };
  }

  private async read(request: Extract<AgentRequest, { kind: 'read' }>, { conversationId }: AgentRequester, access: ArtifactAccess): Promise<Result> {
    if (request.tree && access.scope !== 'tree') {
      return { request: 'read', id: request.ids.join(','), failed: true, body: 'Reading a whole feature with its tasks is reserved to the agents that manage the board. Read the artifacts one at a time.' };
    }
    const all = await this.artifacts.list(conversationId, { statuses: 'all' });
    const bodies: string[] = [];
    for (const id of request.ids) {
      const artifact = all.find(candidate => candidate.id === id);
      const refusal = !artifact ? `Unknown artifact "${id}".` : this.readRefusal(artifact, access);
      if (refusal) {
        return { request: 'read', id: request.ids.join(','), failed: true, body: refusal };
      }
      bodies.push(this.formatter.detail(artifact!, all, request.tree));
    }
    return { request: 'read', id: request.ids.join(','), body: bodies.join('\n\n---\n\n') };
  }

  private async create(request: Extract<AgentRequest, { kind: 'create' }>, requester: AgentRequester, access: ArtifactAccess, refs: Map<string, string>): Promise<Result> {
    const ref = request.ref;
    const fail = (body: string): Result => ({ request: 'create', ...(ref ? { ref } : {}), failed: true, body });
    if (!access.create) {
      return fail('You cannot create artifacts.');
    }
    const forbidden = request.sections.map(change => change.section).filter(section => !access.sections.includes(section));
    if (forbidden.length > 0) {
      return fail(`You cannot write the sections ${forbidden.join(', ')}.`);
    }
    if (request.refinement && !access.fields.includes('refinement')) {
      return fail('You cannot set the refinement states.');
    }
    const outcome = await this.artifacts.create(requester.conversationId, {
      type: request.type,
      title: request.title,
      ...(request.parent !== undefined ? { parentId: request.parent === null ? null : this.resolve(request.parent, refs) } : {}),
      ...(request.project ? { projectName: request.project } : {}),
      ...(request.dependsOn ? { dependsOn: request.dependsOn.map(id => this.resolve(id, refs)) } : {}),
      ...(request.refinement ? { refinement: request.refinement } : {}),
      sections: Object.fromEntries(request.sections.map(change => [change.section, change.content])),
    }, this.actorOf(requester));
    if (!outcome.ok) {
      return fail(outcome.error);
    }
    if (ref) {
      refs.set(ref, outcome.artifact.id);
    }
    return { request: 'create', id: outcome.artifact.id, ...(ref ? { ref } : {}), body: `Created ${outcome.artifact.type} ${outcome.artifact.id} "${outcome.artifact.title}" in project ${outcome.artifact.projectName}, status ${outcome.artifact.status}.` };
  }

  private async update(request: Extract<AgentRequest, { kind: 'update' }>, requester: AgentRequester, access: ArtifactAccess, refs: Map<string, string>): Promise<Result> {
    const id = this.resolve(request.id, refs);
    const fail = (body: string): Result => ({ request: 'update', id, failed: true, body });
    const artifact = await this.artifacts.get(requester.conversationId, id);
    if (!artifact) {
      return fail(`Unknown artifact "${id}".`);
    }
    const fields = this.fieldsOf(request);
    const refusal = this.frozenRefusal(artifact, request)
      ?? this.writeRefusal(artifact, requester, access, fields, request.sections.length > 0)
      ?? this.forbiddenWrites(request, access, fields);
    if (refusal) {
      return fail(refusal);
    }
    const changes: ArtifactChanges = {
      ...(request.title !== undefined ? { title: request.title } : {}),
      ...(request.status !== undefined ? { status: request.status } : {}),
      ...(request.parent !== undefined ? { parentId: request.parent === null ? null : this.resolve(request.parent, refs) } : {}),
      ...(request.project ? { projectName: request.project } : {}),
      ...(request.dependsOn !== undefined ? { dependsOn: request.dependsOn.map(dependency => this.resolve(dependency, refs)) } : {}),
      ...(request.refinement ? { refinement: request.refinement } : {}),
      ...(request.branch !== undefined ? { branch: request.branch } : {}),
      ...(request.note ? { note: request.note } : {}),
      sections: request.sections,
      pullRequests: request.pullRequests,
    };
    return this.outcomeResult('update', id, await this.artifacts.update(requester.conversationId, id, changes, this.actorOf(requester)), 'Updated');
  }

  private async comment(request: Extract<AgentRequest, { kind: 'comment' }>, requester: AgentRequester, access: ArtifactAccess): Promise<Result> {
    const artifact = await this.artifacts.get(requester.conversationId, request.id);
    const refusal = !artifact ? `Unknown artifact "${request.id}".` : this.readRefusal(artifact, access);
    if (refusal) {
      return { request: 'comment', id: request.id, failed: true, body: refusal };
    }
    return this.outcomeResult('comment', request.id, await this.artifacts.comment(requester.conversationId, request.id, request.text, this.actorOf(requester)), 'Commented on');
  }

  private outcomeResult(request: string, id: string, outcome: ArtifactOutcome, verb: string): Result {
    return outcome.ok
      ? { request, id, body: `${verb} ${id}; its status is ${outcome.artifact.status}.` }
      : { request, id, failed: true, body: outcome.error };
  }

  private readRefusal(artifact: Artifact, access: ArtifactAccess): string | undefined {
    return access.scope === 'task' && artifact.type !== 'task'
      ? `${artifact.id} is a ${artifact.type}; you work on tasks only.`
      : undefined;
  }

  /** The server freezes a task that loops between agents, and only the user takes it out. */
  private frozenRefusal(artifact: Artifact, request: Extract<AgentRequest, { kind: 'update' }>): string | undefined {
    if (request.status === FROZEN_STATUS) {
      return 'Only the server freezes an artifact. Set blocked to hold it yourself.';
    }
    return artifact.status === FROZEN_STATUS && request.status !== undefined
      ? `${artifact.id} is frozen after too many delegations, and only the user takes it out. Tell the user what is going wrong with it.`
      : undefined;
  }

  private writeRefusal(
    artifact: Artifact,
    requester: AgentRequester,
    access: ArtifactAccess,
    fields: readonly string[],
    writesSections: boolean,
  ): string | undefined {
    if (access.scope === 'task' && artifact.id !== requester.artifactId) {
      return requester.artifactId
        ? `You may change only ${requester.artifactId}, the artifact you were delegated.`
        : 'You may change only the artifact you were delegated, and this task delegated none.';
    }
    const holder = artifact.assignee;
    if (!holder || holder.delegationId === requester.delegationId) {
      return undefined;
    }
    const steersOnly = access.scope === 'board' && !writesSections && fields.every(field => BOARD_FIELDS_WHILE_HELD.includes(field as ArtifactField));
    return steersOnly
      ? undefined
      : `${artifact.id} is with ${holder.roleName} (${holder.role}) right now, and an artifact is changed only by the agent holding it. Comment on it instead, or wait until it is released.`;
  }

  private forbiddenWrites(request: Extract<AgentRequest, { kind: 'update' }>, access: ArtifactAccess, fields: readonly string[]): string | undefined {
    const forbiddenFields = fields.filter(field => !access.fields.includes(field as ArtifactField));
    if (forbiddenFields.length > 0) {
      return `You cannot change ${forbiddenFields.join(', ')}.`;
    }
    const forbiddenSections = request.sections.map(change => change.section).filter(section => !access.sections.includes(section));
    return forbiddenSections.length > 0 ? `You cannot write the sections ${forbiddenSections.join(', ')}.` : undefined;
  }

  private fieldsOf(request: Extract<AgentRequest, { kind: 'update' }>): ArtifactField[] {
    const fields: ArtifactField[] = [];
    const present: readonly [boolean, ArtifactField][] = [
      [request.title !== undefined, 'title'],
      [request.status !== undefined, 'status'],
      [request.parent !== undefined, 'parent'],
      [request.project !== undefined, 'project'],
      [request.dependsOn !== undefined, 'depends_on'],
      [request.refinement !== undefined, 'refinement'],
      [request.branch !== undefined, 'branch'],
      [request.pullRequests.length > 0, 'pull_requests'],
    ];
    for (const [given, field] of present) {
      if (given) {
        fields.push(field);
      }
    }
    return fields;
  }

  /** A `ref` names an artifact created earlier in the same response. */
  private resolve(idOrRef: string, refs: ReadonlyMap<string, string>): string {
    return refs.get(idOrRef) ?? idOrRef;
  }

  private actorOf({ role, roleName }: AgentRequester): ArtifactActor {
    return { kind: 'agent', role, roleName };
  }

  private formatResult({ request, id, ref, name, failed, body }: Result): string {
    const attributes = [
      `request="${request}"`,
      ...(id ? [`id="${escapeTagAttribute(id)}"`] : []),
      ...(ref ? [`ref="${escapeTagAttribute(ref)}"`] : []),
      ...(name ? [`name="${escapeTagAttribute(name)}"`] : []),
      `status="${failed ? 'error' : 'ok'}"`,
    ].join(' ');
    return `<request_result ${attributes}>\n${body}\n</request_result>`;
  }
}
