import { Inject, Injectable } from '@nestjs/common';

import {
  ARTIFACT_STATUSES,
  ARTIFACT_TYPES,
  DEFAULT_REFINEMENT_STATES,
  FROZEN_STATUS,
  PULL_REQUEST_STATES,
  REFINEMENT_KINDS,
  REFINEMENT_STATES,
} from '../../artifacts/constants/artifact-catalog.constant.js';
import type { ArtifactSection, RefinementKind } from '../../artifacts/models/artifact.model.js';
import type { AgentToolCatalog, AgentToolDefinition, JsonSchema } from '../models/agent-tool.model.js';
import { type ArtifactAccess, type ArtifactField, IAgentRegistryPort } from '../ports/agent-registry.port.js';
import { IAgentSkillsPort } from '../ports/agent-skills.port.js';


/** Codex shows the model only the first line of the instructions, so it says on its own what the server is for. */
const INSTRUCTIONS_FIRST_LINE = 'The board of this conversation and the skills of your team are reached through the tools of this server, and the skills your role may read are listed below.';

/** The agent that creates an artifact writes its overview, whatever sections its role writes afterwards. */
const CREATOR_SECTION: ArtifactSection = 'overview';

const string = (description?: string): JsonSchema => ({ type: 'string', ...(description ? { description } : {}) });
const stringList = (description: string, values?: readonly string[]): JsonSchema => ({
  type: 'array',
  description,
  items: { type: 'string', ...(values ? { enum: values } : {}) },
});
const object = (properties: Readonly<Record<string, JsonSchema>>, required: readonly string[] = []): JsonSchema => ({
  type: 'object',
  properties,
  ...(required.length > 0 ? { required } : {}),
});

/**
 * The tools a role gets, one per agent request it may make, with the input its access allows: the statuses, the
 * sections and fields it writes, and reading a whole feature only for a role that reads trees. The skill catalog
 * goes in the instructions, since most agent CLIs never show a tool description to the model.
 */
@Injectable()
export class AgentToolCatalogService {
  constructor(
    @Inject(IAgentRegistryPort) private readonly agentRegistry: IAgentRegistryPort,
    @Inject(IAgentSkillsPort) private readonly skills: IAgentSkillsPort,
  ) {}

  async catalog(role: string): Promise<AgentToolCatalog> {
    return { instructions: await this.instructions(role), tools: this.tools(role) };
  }

  tools(role: string): AgentToolDefinition[] {
    const access = this.agentRegistry.getArtifactAccess(role);
    const writesSkills = this.skills.writesSkills(role);
    return [
      this.listTool(access),
      this.readTool(access),
      ...(access.create ? [this.createTool(access)] : []),
      ...(access.sections.length > 0 || access.fields.length > 0 ? [this.updateTool(access)] : []),
      this.commentTool(),
      this.skillReadTool(),
      ...(writesSkills ? [this.skillListTool(), this.skillWriteTool()] : []),
    ];
  }

  async instructions(role: string): Promise<string> {
    const skills = await this.skills.list(role);
    const catalog = skills.length > 0
      ? skills.map(skill => `- ${skill.name}: ${skill.description}`)
      : ['Your role has no skills.'];
    return [INSTRUCTIONS_FIRST_LINE, '', 'Skills (read one in full with skill_read before the work it describes):', ...catalog].join('\n');
  }

  private listTool(access: ArtifactAccess): AgentToolDefinition {
    const tasksOnly = access.scope === 'task';
    return {
      name: 'artifact_list',
      description: `Lists the ${tasksOnly ? 'tasks' : 'artifacts'} on the board of this conversation, one line each. Without status, only the open ones (neither done nor cancelled).`,
      inputSchema: object({
        ...(tasksOnly ? {} : { type: stringList('Types to list.', ARTIFACT_TYPES) }),
        status: stringList('Statuses to list; "all" lists every status.', [...ARTIFACT_STATUSES, 'all']),
        parent: string('Lists only the direct children of this artifact id; "none" lists only the roots.'),
        project: string('Lists only the artifacts of this project folder.'),
      }),
    };
  }

  private readTool(access: ArtifactAccess): AgentToolDefinition {
    const readsTrees = access.scope === 'tree';
    return {
      name: 'artifact_read',
      description: 'Reads artifacts in full by id: fields, sections, pull requests, comments and history.',
      inputSchema: object({
        ids: stringList('Ids of the artifacts to read, such as T-1.'),
        ...(readsTrees ? { tree: { type: 'boolean', description: 'true reads a feature with all its tasks.' } } : {}),
      }, ['ids']),
    };
  }

  private createTool(access: ArtifactAccess): AgentToolDefinition {
    const sections = [...new Set([CREATOR_SECTION, ...access.sections])];
    return {
      name: 'artifact_create',
      description: 'Creates a feature or a task on the board. Returns the id of the new artifact.',
      inputSchema: object({
        type: { type: 'string', enum: ARTIFACT_TYPES },
        title: string(),
        parent: string('The feature a task belongs to.'),
        project: string('The project folder a task works in; one of its feature\'s, and left out only when the feature has a single project.'),
        projects: stringList('The project folders a feature links, at least one.'),
        depends_on: stringList('Ids of the artifacts this one waits on.'),
        ...this.refinementProperties(access, kind => `Left out: ${DEFAULT_REFINEMENT_STATES[kind]}.`),
        sections: this.sectionsSchema(sections, false),
      }, ['type', 'title']),
    };
  }

  private updateTool(access: ArtifactAccess): AgentToolDefinition {
    const writes = (field: ArtifactField) => access.fields.includes(field);
    return {
      name: 'artifact_update',
      description: 'Changes an artifact: the fields given and each section given, replaced or appended. Returns its status after the change.',
      inputSchema: object({
        id: string('Id of the artifact, such as T-1.'),
        ...(writes('title') ? { title: string() } : {}),
        ...(writes('status') ? { status: { type: 'string', enum: ARTIFACT_STATUSES.filter(status => status !== FROZEN_STATUS) } } : {}),
        ...(writes('parent') ? { parent: string('The feature a task belongs to; "none" clears it.') } : {}),
        ...(writes('project') ? { project: string('Moves a task to another project folder of its feature.') } : {}),
        ...(writes('project') ? { projects: stringList('The project folders of a feature, in place of the current ones; one its tasks work in stays.') } : {}),
        ...(writes('depends_on') ? { depends_on: stringList('Ids of the artifacts this one waits on, in place of the current ones; empty clears them.') } : {}),
        ...this.refinementProperties(access),
        ...(writes('branch') ? { branch: string('The branch of the work; "none" clears it.') } : {}),
        ...(writes('pull_requests') ? { pull_requests: this.pullRequestsSchema() } : {}),
        ...(access.sections.length > 0 ? { sections: this.sectionsSchema(access.sections, true) } : {}),
        note: string('Why the change was made, kept in the history.'),
      }, ['id']),
    };
  }

  private commentTool(): AgentToolDefinition {
    return {
      name: 'artifact_comment',
      description: 'Adds a comment to an artifact. Returns its status.',
      inputSchema: object({ id: string('Id of the artifact, such as T-1.'), text: string() }, ['id', 'text']),
    };
  }

  private skillReadTool(): AgentToolDefinition {
    return {
      name: 'skill_read',
      description: 'Reads skills in full by name. Returns their content.',
      inputSchema: object({ names: stringList('Names of the skills to read.') }, ['names']),
    };
  }

  private skillListTool(): AgentToolDefinition {
    return {
      name: 'skill_list',
      description: 'Lists every skill with whether it is built-in, the roles that read it and its description.',
      inputSchema: object({}),
    };
  }

  private skillWriteTool(): AgentToolDefinition {
    return {
      name: 'skill_write',
      description: 'Creates or replaces a user skill for the given roles. Returns whether it was created or updated.',
      inputSchema: object({
        name: string('Kebab-case name of the skill.'),
        description: string('When an agent should read the skill.'),
        roles: stringList('Roles that read the skill.', this.agentRegistry.listRoles()),
        content: string('The whole skill, in Markdown.'),
      }, ['name', 'description', 'roles', 'content']),
    };
  }

  private refinementProperties(access: ArtifactAccess, describe?: (kind: RefinementKind) => string): Record<string, JsonSchema> {
    return access.fields.includes('refinement')
      ? Object.fromEntries(REFINEMENT_KINDS.map(kind => [`${kind}_refinement`, { type: 'string', enum: REFINEMENT_STATES, ...(describe && { description: describe(kind) }) }]))
      : {};
  }

  private sectionsSchema(sections: readonly ArtifactSection[], withMode: boolean): JsonSchema {
    return {
      type: 'array',
      description: withMode ? 'Sections to write; empty content in replace mode clears one.' : 'Sections to write.',
      items: object({
        name: { type: 'string', enum: sections },
        content: string('Markdown.'),
        ...(withMode ? { mode: { type: 'string', enum: ['replace', 'append'], description: 'replace by default; append adds after a blank line.' } } : {}),
      }, ['name', 'content']),
    };
  }

  private pullRequestsSchema(): JsonSchema {
    return {
      type: 'array',
      description: 'Pull requests to link, or to update when one with the same URL is linked.',
      items: object({
        url: string(),
        title: string(),
        repository: string('Path of the git repository inside the task\'s project folder; "." (the default) is the folder itself.'),
        state: { type: 'string', enum: PULL_REQUEST_STATES },
      }, ['url']),
    };
  }
}
