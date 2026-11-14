import { Injectable } from '@nestjs/common';

import {
  ARTIFACT_SECTIONS,
  ARTIFACT_STATUSES,
  ARTIFACT_TYPES,
  PULL_REQUEST_STATES,
  REFINEMENT_STATES,
} from '../../artifacts/constants/artifact-catalog.constant.js';
import type {
  ArtifactRefinement,
  ArtifactSection,
  PullRequestInput,
  PullRequestState,
  RefinementState,
  SectionChange,
} from '../../artifacts/models/artifact.model.js';
import type { AgentRequest } from '../models/agent-request.model.js';
import { type CodeSpan, findCodeSpans, isInCode, parseTagAttributes, readTagBody, type TagAttributes } from '../utils/protocol-tag.util.js';


/** `rest` is the response without its requests, which still carries whatever else the agent wrote. */
export type ParsedAgentRequests =
  | { readonly kind: 'none' }
  | { readonly kind: 'requests'; readonly requests: readonly AgentRequest[]; readonly rest: string };

const REQUEST_TAG = /<(\/?)(artifact_list|artifact_read|artifact_create|artifact_update|artifact_comment|skill_read|skill_list|skill_write)\b([^>]*)>/gi;
const CHILD_TAG = /<(\/?)(section|pull_request)\b([^>]*)>/gi;
const DELEGATE_BLOCK = /<delegate\b[^>]*>[\s\S]*?<\/delegate>/gi;
const ARTIFACT_ID = /^[a-z]-\d+$/i;
const NONE = 'none';

const ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  artifact_list: ['type', 'status', 'parent', 'project'],
  artifact_read: ['id', 'tree'],
  artifact_create: ['ref', 'type', 'title', 'parent', 'project', 'depends_on', 'business_refinement', 'technical_refinement'],
  artifact_update: ['id', 'title', 'status', 'parent', 'project', 'depends_on', 'business_refinement', 'technical_refinement', 'branch', 'note'],
  artifact_comment: ['id'],
  skill_read: ['name'],
  skill_list: [],
  skill_write: ['name', 'roles', 'description'],
};
const BODY_TAGS: readonly string[] = ['artifact_create', 'artifact_update', 'artifact_comment', 'skill_write'];

type Fail = { readonly fail: string };

/**
 * Reads the requests of an agent response: the artifact requests and the skill requests. Tags inside Markdown code are quoted markup, and tags inside a
 * `<delegate>` belong to the task written for another agent; neither is a request.
 */
@Injectable()
export class AgentRequestParserService {
  parse(response: string): ParsedAgentRequests {
    const ignored = [...findCodeSpans(response), ...this.delegateBlocks(response)];
    const tags = new RegExp(REQUEST_TAG.source, REQUEST_TAG.flags);
    const requests: AgentRequest[] = [];
    let rest = '';
    let cursor = 0;

    for (let tag = this.nextTag(tags, response, ignored); tag; tag = this.nextTag(tags, response, ignored)) {
      const [rawTag, closing, rawName, rawAttributes] = tag;
      const name = rawName!.toLowerCase();
      rest += response.slice(cursor, tag.index);
      cursor = tag.index + rawTag.length;
      if (closing) {
        requests.push(this.invalid(rawTag, `Found ${rawTag} without its opening <${name}> tag.`));
        continue;
      }
      const selfClosing = rawAttributes!.trimEnd().endsWith('/');
      const attributes = parseTagAttributes(rawTag, selfClosing ? rawAttributes!.trimEnd().slice(0, -1) : rawAttributes!, ATTRIBUTES[name]!);
      const contentStart = tag.index + rawTag.length;
      const body = selfClosing || !BODY_TAGS.includes(name)
        ? { content: '', end: contentStart + this.emptyClosingLength(response, name, contentStart, selfClosing) }
        : readTagBody(response, name, contentStart);
      if (typeof body === 'string') {
        requests.push(this.invalid(rawTag, body));
        cursor = response.length;
        break;
      }
      tags.lastIndex = body.end;
      cursor = body.end;
      requests.push(typeof attributes === 'string' ? this.invalid(rawTag, attributes) : this.toRequest(name, rawTag, attributes, body.content));
    }

    rest += response.slice(cursor);
    return requests.length === 0
      ? { kind: 'none' }
      : { kind: 'requests', requests, rest: rest.replace(/\n{3,}/g, '\n\n').trim() };
  }

  private toRequest(name: string, rawTag: string, attributes: TagAttributes, content: string): AgentRequest {
    const request = this.read(name, attributes, content);
    return 'fail' in request ? this.invalid(rawTag, request.fail) : request;
  }

  private read(name: string, attributes: TagAttributes, content: string): AgentRequest | Fail {
    switch (name) {
      case 'artifact_list':
        return this.readList(attributes);
      case 'artifact_read':
        return this.readRead(attributes);
      case 'artifact_create':
        return this.readCreate(attributes, content);
      case 'artifact_update':
        return this.readUpdate(attributes, content);
      case 'skill_read':
        return this.readSkill(attributes);
      case 'skill_list':
        return { kind: 'skill_list' };
      case 'skill_write':
        return this.readSkillWrite(attributes, content);
      default:
        return this.readComment(attributes, content);
    }
  }

  private readList(attributes: TagAttributes): AgentRequest | Fail {
    const types = this.listOf(attributes.get('type'), ARTIFACT_TYPES, 'type');
    const rawStatus = attributes.get('status');
    const statuses = rawStatus?.toLowerCase() === 'all' ? 'all' : this.listOf(rawStatus, ARTIFACT_STATUSES, 'status');
    if (types && 'fail' in types) {
      return types;
    }
    if (statuses && typeof statuses !== 'string' && 'fail' in statuses) {
      return statuses;
    }
    const parent = attributes.get('parent');
    const project = attributes.get('project');
    return {
      kind: 'list',
      ...(types ? { types: types.values } : {}),
      ...(statuses ? { statuses: typeof statuses === 'string' ? statuses : statuses.values } : {}),
      ...(parent !== undefined ? { parent: this.reference(parent) } : {}),
      ...(project ? { project } : {}),
    };
  }

  private readRead(attributes: TagAttributes): AgentRequest | Fail {
    const ids = this.ids(attributes.get('id'));
    if (ids.length === 0) {
      return { fail: 'Name the artifact to read, as in <artifact_read id="T-1"/>.' };
    }
    const tree = attributes.get('tree')?.toLowerCase();
    if (tree !== undefined && tree !== 'true' && tree !== 'false') {
      return { fail: 'The tree attribute is "true" or "false".' };
    }
    return { kind: 'read', ids, tree: tree === 'true' };
  }

  private readCreate(attributes: TagAttributes, content: string): AgentRequest | Fail {
    const type = this.oneOf(attributes.get('type')?.toLowerCase(), ARTIFACT_TYPES);
    if (!type) {
      return { fail: `<artifact_create> needs a type: ${ARTIFACT_TYPES.join(', ')}.` };
    }
    const title = attributes.get('title');
    if (!title) {
      return { fail: '<artifact_create> needs a title attribute.' };
    }
    const children = this.readChildren(content, false);
    if ('fail' in children) {
      return children;
    }
    const fields = this.readCommonFields(attributes);
    if ('fail' in fields) {
      return fields;
    }
    const ref = attributes.get('ref');
    return { kind: 'create', ...(ref ? { ref } : {}), type, title, ...fields, sections: children.sections };
  }

  private readUpdate(attributes: TagAttributes, content: string): AgentRequest | Fail {
    const id = this.ids(attributes.get('id'))[0];
    if (!id) {
      return { fail: '<artifact_update> needs the id of the artifact, as in <artifact_update id="T-1">.' };
    }
    const rawStatus = attributes.get('status')?.toLowerCase();
    const status = this.oneOf(rawStatus, ARTIFACT_STATUSES);
    if (rawStatus !== undefined && !status) {
      return { fail: `Unknown status "${rawStatus}". Use one of: ${ARTIFACT_STATUSES.join(', ')}.` };
    }
    const children = this.readChildren(content, true);
    if ('fail' in children) {
      return children;
    }
    const fields = this.readCommonFields(attributes);
    if ('fail' in fields) {
      return fields;
    }
    const title = attributes.get('title');
    const branch = attributes.get('branch');
    const note = attributes.get('note');
    return {
      kind: 'update',
      id,
      ...(title ? { title } : {}),
      ...(status ? { status } : {}),
      ...fields,
      ...(branch !== undefined ? { branch: branch.toLowerCase() === NONE || branch === '' ? null : branch } : {}),
      ...(note ? { note } : {}),
      sections: children.sections,
      pullRequests: children.pullRequests,
    };
  }

  private readSkill(attributes: TagAttributes): AgentRequest | Fail {
    const names = (attributes.get('name') ?? '').split(',').map(name => name.trim()).filter(Boolean);
    return names.length > 0 ? { kind: 'skill_read', names } : { fail: '<skill_read> needs the name of a skill, as in <skill_read name="playwright-web"/>.' };
  }

  private readSkillWrite(attributes: TagAttributes, content: string): AgentRequest | Fail {
    const name = attributes.get('name')?.trim() ?? '';
    const description = attributes.get('description')?.trim() ?? '';
    const roles = (attributes.get('roles') ?? '').split(',').map(role => role.trim().toUpperCase()).filter(Boolean);
    const text = content.trim();
    if (!name || !description || roles.length === 0) {
      return { fail: '<skill_write> needs a name, a description and the roles that read the skill, as in <skill_write name="electron-testing" roles="QA" description="...">.' };
    }
    return text ? { kind: 'skill_write', name, description, roles, content: text } : { fail: `<skill_write name="${name}"> has no content.` };
  }

  private readComment(attributes: TagAttributes, content: string): AgentRequest | Fail {
    const id = this.ids(attributes.get('id'))[0];
    if (!id) {
      return { fail: '<artifact_comment> needs the id of the artifact, as in <artifact_comment id="T-1">.' };
    }
    const text = content.trim();
    return text ? { kind: 'comment', id, text } : { fail: `<artifact_comment id="${id}"> has no text.` };
  }

  private readCommonFields(attributes: TagAttributes): Fail | {
    readonly parent?: string | null;
    readonly project?: string;
    readonly dependsOn?: readonly string[];
    readonly refinement?: Partial<ArtifactRefinement>;
  } {
    const refinement: { business?: RefinementState; technical?: RefinementState } = {};
    for (const side of ['business', 'technical'] as const) {
      const raw = attributes.get(`${side}_refinement`)?.toLowerCase();
      const state = this.oneOf(raw, REFINEMENT_STATES);
      if (raw !== undefined && !state) {
        return { fail: `The ${side}_refinement attribute is one of: ${REFINEMENT_STATES.join(', ')}.` };
      }
      if (state) {
        refinement[side] = state;
      }
    }
    const parent = attributes.get('parent');
    const project = attributes.get('project');
    const dependsOn = attributes.get('depends_on');
    return {
      ...(parent !== undefined ? { parent: this.reference(parent) } : {}),
      ...(project ? { project } : {}),
      ...(dependsOn !== undefined ? { dependsOn: dependsOn.toLowerCase() === NONE ? [] : this.ids(dependsOn) } : {}),
      ...(Object.keys(refinement).length > 0 ? { refinement } : {}),
    };
  }

  private readChildren(content: string, allowUpdates: boolean): Fail | { readonly sections: SectionChange[]; readonly pullRequests: PullRequestInput[] } {
    const sections: SectionChange[] = [];
    const pullRequests: PullRequestInput[] = [];
    const tags = new RegExp(CHILD_TAG.source, CHILD_TAG.flags);
    let outside = '';
    let cursor = 0;

    for (let tag = tags.exec(content); tag; tag = tags.exec(content)) {
      const [rawTag, closing, rawName, rawAttributes] = tag;
      const name = rawName!.toLowerCase();
      outside += content.slice(cursor, tag.index);
      if (closing) {
        return { fail: `Found ${rawTag} without its opening <${name}> tag.` };
      }
      if (name === 'pull_request') {
        const pullRequest = this.readPullRequest(rawTag, rawAttributes!, allowUpdates);
        if ('fail' in pullRequest) {
          return pullRequest;
        }
        pullRequests.push(pullRequest);
        cursor = tag.index + rawTag.length;
        continue;
      }
      const attributes = parseTagAttributes(rawTag, rawAttributes!, allowUpdates ? ['name', 'mode'] : ['name']);
      if (typeof attributes === 'string') {
        return { fail: attributes };
      }
      const section = this.oneOf(attributes.get('name')?.toLowerCase(), ARTIFACT_SECTIONS);
      if (!section) {
        return { fail: `Every <section> needs a name among: ${ARTIFACT_SECTIONS.join(', ')}.` };
      }
      const mode = attributes.get('mode')?.toLowerCase() ?? 'replace';
      if (mode !== 'replace' && mode !== 'append') {
        return { fail: 'The mode of a <section> is "replace" or "append".' };
      }
      const body = readTagBody(content, 'section', tag.index + rawTag.length);
      if (typeof body === 'string') {
        return { fail: body };
      }
      sections.push({ section: section as ArtifactSection, content: body.content, mode });
      cursor = body.end;
      tags.lastIndex = body.end;
    }
    outside += content.slice(cursor);
    return outside.trim()
      ? { fail: 'Text outside a <section> is not kept. Put each piece of content inside the <section name="..."> it belongs to, and set fields such as branch, status or title as attributes of the tag itself.' }
      : { sections, pullRequests };
  }

  private readPullRequest(rawTag: string, rawAttributes: string, allowed: boolean): PullRequestInput | Fail {
    if (!allowed) {
      return { fail: 'Pull requests are linked with <artifact_update>, once the artifact exists.' };
    }
    const selfClosing = rawAttributes.trimEnd().endsWith('/');
    if (!selfClosing) {
      return { fail: 'Write a pull request as a self-closing tag: <pull_request url="..." state="open"/>.' };
    }
    const attributes = parseTagAttributes(rawTag, rawAttributes.trimEnd().slice(0, -1), ['url', 'title', 'state']);
    if (typeof attributes === 'string') {
      return { fail: attributes };
    }
    const url = attributes.get('url');
    if (!url) {
      return { fail: 'Every <pull_request> needs its url.' };
    }
    const rawState = attributes.get('state')?.toLowerCase();
    const state = this.oneOf(rawState, PULL_REQUEST_STATES);
    if (rawState !== undefined && !state) {
      return { fail: `The state of a <pull_request> is one of: ${PULL_REQUEST_STATES.join(', ')}.` };
    }
    const title = attributes.get('title');
    return { url, ...(title ? { title } : {}), ...(state ? { state: state as PullRequestState } : {}) };
  }

  private listOf<T extends string>(raw: string | undefined, allowed: readonly T[], label: string): Fail | { readonly values: T[] } | undefined {
    if (raw === undefined) {
      return undefined;
    }
    const values = raw.split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
    const unknown = values.find(value => !allowed.includes(value as T));
    return unknown || values.length === 0
      ? { fail: `Unknown ${label} "${unknown ?? raw}". Use a comma-separated list of: ${allowed.join(', ')}.` }
      : { values: values as T[] };
  }

  private oneOf<T extends string>(raw: string | undefined, allowed: readonly T[]): T | undefined {
    return allowed.find(value => value === raw);
  }

  private ids(raw: string | undefined): string[] {
    return (raw ?? '').split(',').map(value => value.trim()).filter(Boolean).map(value => this.normalizeId(value));
  }

  private reference(raw: string): string | null {
    return raw.toLowerCase() === NONE || raw === '' ? null : this.normalizeId(raw);
  }

  /** Ids are written as `T-1`; a ref of the same response keeps its spelling. */
  private normalizeId(value: string): string {
    return ARTIFACT_ID.test(value) ? value.toUpperCase() : value;
  }

  /** `<artifact_read id="T-1"></artifact_read>` reads like the self-closing form. */
  private emptyClosingLength(response: string, name: string, contentStart: number, selfClosing: boolean): number {
    if (selfClosing) {
      return 0;
    }
    return new RegExp(String.raw`^\s*</${name}>`, 'i').exec(response.slice(contentStart))?.[0].length ?? 0;
  }

  private delegateBlocks(response: string): CodeSpan[] {
    return Array.from(response.matchAll(DELEGATE_BLOCK), match => [match.index, match.index + match[0].length] as const);
  }

  private nextTag(tags: RegExp, response: string, ignored: readonly CodeSpan[]): RegExpExecArray | null {
    let tag = tags.exec(response);
    while (tag && isInCode(tag.index, ignored)) {
      tag = tags.exec(response);
    }
    return tag;
  }

  private invalid(tag: string, reason: string): AgentRequest {
    return { kind: 'invalid', tag, reason };
  }
}
