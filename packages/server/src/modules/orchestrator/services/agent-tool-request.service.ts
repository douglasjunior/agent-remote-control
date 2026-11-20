import { Injectable } from '@nestjs/common';

import {
  ARTIFACT_SECTIONS,
  ARTIFACT_STATUSES,
  ARTIFACT_TYPES,
  PULL_REQUEST_STATES,
  REFINEMENT_STATES,
} from '../../artifacts/constants/artifact-catalog.constant.js';
import type { ArtifactRefinement, PullRequestInput, SectionChange } from '../../artifacts/models/artifact.model.js';
import type { AgentToolName } from '../constants/agent-tools.constant.js';
import type { AgentRequest } from '../models/agent-request.model.js';
import { isNoneValue, normalizeArtifactId, readArtifactReference } from '../utils/artifact-reference.util.js';


type Args = Readonly<Record<string, unknown>>;

/** A tool input that cannot become a request, with the reason the agent reads. */
class InvalidArgument extends Error {}

/**
 * Turns the arguments of a tool call into the request its tag would make, so both run through the same code under the
 * same access. Arguments the tool does not take are ignored; a list is read from an array or a comma-separated string.
 */
@Injectable()
export class AgentToolRequestService {
  toRequest(name: AgentToolName, args: Args): AgentRequest {
    try {
      return this.read(name, args);
    } catch (error) {
      return { kind: 'invalid', tag: name, reason: (error as InvalidArgument).message };
    }
  }

  private read(name: AgentToolName, args: Args): AgentRequest {
    switch (name) {
      case 'artifact_list':
        return this.list(args);
      case 'artifact_read':
        return this.readArtifacts(args);
      case 'artifact_create':
        return this.create(args);
      case 'artifact_update':
        return this.update(args);
      case 'artifact_comment':
        return { kind: 'comment', id: this.id(args), text: this.required(args, 'text').trim() };
      case 'skill_read':
        return this.skillRead(args);
      case 'skill_list':
        return { kind: 'skill_list' };
      default:
        return this.skillWrite(args);
    }
  }

  private list(args: Args): AgentRequest {
    const types = this.strings(args, 'type');
    const statuses = this.strings(args, 'status')?.map(status => status.toLowerCase());
    const parent = this.optional(args, 'parent');
    const project = this.optional(args, 'project');
    return {
      kind: 'list',
      ...(types ? { types: types.map(type => this.oneOf(type.toLowerCase(), ARTIFACT_TYPES, 'type')) } : {}),
      ...(statuses ? { statuses: statuses.includes('all') ? 'all' : statuses.map(status => this.oneOf(status, ARTIFACT_STATUSES, 'status')) } : {}),
      ...(parent !== undefined ? { parent: readArtifactReference(parent) } : {}),
      ...(project ? { project } : {}),
    };
  }

  private readArtifacts(args: Args): AgentRequest {
    const ids = this.ids(args, 'ids');
    if (!ids?.length) {
      throw new InvalidArgument('Name the artifacts to read in ids, as in ["T-1"].');
    }
    const tree = args.tree;
    if (tree !== undefined && typeof tree !== 'boolean' && tree !== 'true' && tree !== 'false') {
      throw new InvalidArgument('tree is true or false.');
    }
    return { kind: 'read', ids, tree: tree === true || tree === 'true' };
  }

  private create(args: Args): AgentRequest {
    const type = this.oneOf(this.required(args, 'type').toLowerCase(), ARTIFACT_TYPES, 'type');
    return {
      kind: 'create',
      type,
      title: this.required(args, 'title'),
      ...this.commonFields(args),
      sections: this.sections(args, false),
    };
  }

  private update(args: Args): AgentRequest {
    const status = this.optional(args, 'status')?.toLowerCase();
    const title = this.optional(args, 'title');
    const branch = this.optional(args, 'branch');
    const note = this.optional(args, 'note');
    return {
      kind: 'update',
      id: this.id(args),
      ...(title ? { title } : {}),
      ...(status ? { status: this.oneOf(status, ARTIFACT_STATUSES, 'status') } : {}),
      ...this.commonFields(args),
      ...(branch !== undefined ? { branch: isNoneValue(branch) ? null : branch } : {}),
      ...(note ? { note } : {}),
      sections: this.sections(args, true),
      pullRequests: this.pullRequests(args),
    };
  }

  private skillRead(args: Args): AgentRequest {
    const names = this.strings(args, 'names');
    if (!names?.length) {
      throw new InvalidArgument('Name the skills to read in names, as in ["playwright-web"].');
    }
    return { kind: 'skill_read', names };
  }

  private skillWrite(args: Args): AgentRequest {
    const name = this.optional(args, 'name')?.trim() ?? '';
    const description = this.optional(args, 'description')?.trim() ?? '';
    const roles = (this.strings(args, 'roles') ?? []).map(role => role.toUpperCase());
    const content = this.optional(args, 'content')?.trim() ?? '';
    if (!name || !description || roles.length === 0 || !content) {
      throw new InvalidArgument('skill_write needs a name, a description, the roles that read the skill and its content.');
    }
    return { kind: 'skill_write', name, description, roles, content };
  }

  private commonFields(args: Args): {
    readonly parent?: string | null;
    readonly project?: string;
    readonly dependsOn?: readonly string[];
    readonly refinement?: Partial<ArtifactRefinement>;
  } {
    const parent = this.optional(args, 'parent');
    const project = this.optional(args, 'project');
    const dependsOn = this.ids(args, 'depends_on');
    const refinement: { business?: ArtifactRefinement['business']; technical?: ArtifactRefinement['technical'] } = {};
    for (const side of ['business', 'technical'] as const) {
      const state = this.optional(args, `${side}_refinement`)?.toLowerCase();
      if (state !== undefined) {
        refinement[side] = this.oneOf(state, REFINEMENT_STATES, `${side}_refinement`);
      }
    }
    return {
      ...(parent !== undefined ? { parent: readArtifactReference(parent) } : {}),
      ...(project ? { project } : {}),
      ...(dependsOn ? { dependsOn: dependsOn.filter(id => !isNoneValue(id)) } : {}),
      ...(Object.keys(refinement).length > 0 ? { refinement } : {}),
    };
  }

  private sections(args: Args, withMode: boolean): SectionChange[] {
    return this.objects(args, 'sections').map((item) => {
      const section = this.oneOf(this.required(item, 'name').toLowerCase(), ARTIFACT_SECTIONS, 'section');
      const content = this.optional(item, 'content') ?? '';
      const mode = withMode ? this.optional(item, 'mode')?.toLowerCase() ?? 'replace' : 'replace';
      return { section, content, mode: this.oneOf(mode, ['replace', 'append'] as const, 'section mode') };
    });
  }

  private pullRequests(args: Args): PullRequestInput[] {
    return this.objects(args, 'pull_requests').map((item) => {
      const title = this.optional(item, 'title');
      const state = this.optional(item, 'state')?.toLowerCase();
      return {
        url: this.required(item, 'url'),
        ...(title ? { title } : {}),
        ...(state ? { state: this.oneOf(state, PULL_REQUEST_STATES, 'pull request state') } : {}),
      };
    });
  }

  private id(args: Args): string {
    return normalizeArtifactId(this.required(args, 'id').trim());
  }

  private ids(args: Args, key: string): string[] | undefined {
    return this.strings(args, key)?.map(normalizeArtifactId);
  }

  private required(args: Args, key: string): string {
    const value = this.optional(args, key);
    if (!value?.trim()) {
      throw new InvalidArgument(`${key} is required.`);
    }
    return value;
  }

  private optional(args: Args, key: string): string | undefined {
    const value = args[key];
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== 'string') {
      throw new InvalidArgument(`${key} is a string.`);
    }
    return value;
  }

  /** An array of strings, or a comma-separated string, trimmed and without empty entries. */
  private strings(args: Args, key: string): string[] | undefined {
    const value = args[key];
    if (value === undefined || value === null) {
      return undefined;
    }
    const items = typeof value === 'string' ? value.split(',') : value;
    if (!Array.isArray(items) || items.some(item => typeof item !== 'string')) {
      throw new InvalidArgument(`${key} is a list of strings.`);
    }
    return (items as string[]).map(item => item.trim()).filter(Boolean);
  }

  private objects(args: Args, key: string): Args[] {
    const value = args[key];
    if (value === undefined || value === null) {
      return [];
    }
    if (!Array.isArray(value) || value.some(item => typeof item !== 'object' || item === null || Array.isArray(item))) {
      throw new InvalidArgument(`${key} is a list of objects.`);
    }
    return value as Args[];
  }

  private oneOf<T extends string>(value: string, allowed: readonly T[], label: string): T {
    const match = allowed.find(candidate => candidate === value);
    if (!match) {
      throw new InvalidArgument(`Unknown ${label} "${value}". Use one of: ${allowed.join(', ')}.`);
    }
    return match;
  }
}
