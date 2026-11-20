import { Logger } from '@nestjs/common';
import { describe, expect, it, rs } from '@rstest/core';

import { AgentRegistryService } from '../../agent-definitions/services/agent-registry.service.js';
import { ARTIFACT_AT, buildArtifact } from '../../artifacts/testing/artifact.fixture.js';
import { createArtifactsService } from '../../artifacts/testing/artifacts-service.fixture.js';
import { ConversationLogContextService } from '../../logging/services/conversation-log-context.service.js';
import type { AgentRequester } from '../models/agent-request.model.js';
import type { SkillActivity } from '../models/turn-activity.model.js';
import { AgentRequestParserService } from '../services/agent-request-parser.service.js';
import { AgentToolRequestService } from '../services/agent-tool-request.service.js';
import { ArtifactPromptFormatterService } from '../services/artifact-prompt-formatter.service.js';
import { createServedToolSessions, credentialOf } from '../testing/agent-tool-sessions.fixture.js';
import { StubAgentSkillsPort } from '../testing/stub-agent-skills.port.js';
import { StubAgentPort } from '../testing/stub-agent.port.js';

import { RunAgentRequestsUseCase } from './run-agent-requests.use-case.js';
import { RunAgentToolUseCase } from './run-agent-tool.use-case.js';


const CONVERSATION = 'c1';
const held = { role: 'QA', roleName: 'QA Agent', delegationId: 'qa-1', since: ARTIFACT_AT };

function setup() {
  const artifacts = createArtifactsService({
    conversationId: CONVERSATION,
    initial: [
      buildArtifact({ id: 'F-1', type: 'feature', title: 'Checkout' }),
      buildArtifact({ id: 'T-1', title: 'API', parentId: 'F-1', assignee: held }),
      buildArtifact({ id: 'T-2', title: 'Cart', parentId: 'F-1', status: 'done' }),
      buildArtifact({ id: 'T-3', title: 'Docs' }),
    ],
  });
  const skills = new StubAgentSkillsPort();
  skills.skills = { DEVELOPER: [{ name: 'git-flow', description: 'Branches.', content: 'Branch from main.' }] };
  skills.listing = [{ name: 'git-flow', description: 'Branches.', roles: ['DEVELOPER'], builtIn: true }];
  skills.writers = ['CEO'];
  const requests = new RunAgentRequestsUseCase(artifacts.service, new AgentRegistryService(), new ArtifactPromptFormatterService(), skills, new AgentRequestParserService());
  const toolSessions = createServedToolSessions();
  const useCase = new RunAgentToolUseCase(toolSessions, new AgentToolRequestService(), requests, new ConversationLogContextService());
  const open = (requester: AgentRequester, onSkill?: (activity: SkillActivity) => void) => {
    const port = new StubAgentPort();
    port.supportsHttpMcp = true;
    return { port, credential: credentialOf(toolSessions.open(port, { requester, ...(onSkill ? { onSkill } : {}) })) };
  };
  return { useCase, requests, artifacts, skills, toolSessions, open };
}

/** The board without the times and ids each write stamps, which differ between two runs of the same change. */
const boardOf = async ({ artifacts }: ReturnType<typeof setup>) => JSON.parse(
  JSON.stringify(await artifacts.service.list(CONVERSATION, { statuses: 'all' }))
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, 'time')
    .replace(/[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}/g, 'uuid'),
);

const as = (role: string, extra: Partial<AgentRequester> = {}): AgentRequester => ({ role, roleName: role, conversationId: CONVERSATION, ...extra });
const developer = as('DEVELOPER', { delegationId: 'dev-1', artifactId: 'T-3' });
const reviewer = as('CODE_REVIEWER', { delegationId: 'rev-1', artifactId: 'T-3' });

describe('RunAgentToolUseCase', () => {
  it.each([
    ['the open artifacts', as('CEO'), 'artifact_list', {}, '<artifact_list/>', false],
    ['every task in any status', as('CEO'), 'artifact_list', { type: ['task'], status: ['all'] }, '<artifact_list type="task" status="all"/>', false],
    ['the roots of a project', as('CEO'), 'artifact_list', { parent: 'none', project: 'shop', status: 'ready,done' }, '<artifact_list parent="none" project="shop" status="ready,done"/>', false],
    ['tasks only, for a role that works on tasks', developer, 'artifact_list', { type: ['feature'] }, '<artifact_list type="feature"/>', false],
    ['an artifact in full', developer, 'artifact_read', { ids: ['t-3'] }, '<artifact_read id="T-3"/>', false],
    ['a feature with its tasks', as('PRODUCT_OWNER'), 'artifact_read', { ids: 'F-1', tree: true }, '<artifact_read id="F-1" tree="true"/>', false],
    ['a feature, refused to a role that works on tasks', developer, 'artifact_read', { ids: ['F-1'] }, '<artifact_read id="F-1"/>', true],
    ['a tree, refused to a role that reads one artifact at a time', as('CEO'), 'artifact_read', { ids: ['F-1'], tree: 'true' }, '<artifact_read id="F-1" tree="true"/>', true],
    [
      'a creation with its overview and refinement',
      as('CEO'),
      'artifact_create',
      { type: 'Task', title: 'Login', parent: 'f-1', depends_on: ['T-1'], business_refinement: 'done', sections: [{ name: 'overview', content: 'Sign in.' }] },
      '<artifact_create type="task" title="Login" parent="F-1" depends_on="T-1" business_refinement="done"><section name="overview">Sign in.</section></artifact_create>',
      false,
    ],
    ['a creation, refused to a role that does not create', developer, 'artifact_create', { type: 'task', title: 'Login', project: 'shop' }, '<artifact_create type="task" title="Login" project="shop"/>', true],
    ['a creation in a section the role does not write', as('CEO'), 'artifact_create', { type: 'task', title: 'Login', project: 'shop', sections: [{ name: 'scope', content: 'x' }] }, '<artifact_create type="task" title="Login" project="shop"><section name="scope">x</section></artifact_create>', true],
    [
      'an update of the delegated task',
      developer,
      'artifact_update',
      { id: 'T-3', branch: 'feat/docs', note: 'Started.', sections: [{ name: 'implementation_notes', content: 'Done.', mode: 'append' }], pull_requests: [{ url: 'https://example.test/pr/1', state: 'open' }] },
      '<artifact_update id="T-3" branch="feat/docs" note="Started."><section name="implementation_notes" mode="append">Done.</section><pull_request url="https://example.test/pr/1" state="open"/></artifact_update>',
      false,
    ],
    ['a section the reviewer does not write', reviewer, 'artifact_update', { id: 'T-3', sections: [{ name: 'implementation_notes', content: 'x' }] }, '<artifact_update id="T-3"><section name="implementation_notes">x</section></artifact_update>', true],
    ['a field the reviewer does not change', reviewer, 'artifact_update', { id: 'T-3', branch: 'none' }, '<artifact_update id="T-3" branch="none"/>', true],
    ['another task than the delegated one', developer, 'artifact_update', { id: 'T-2', branch: 'x' }, '<artifact_update id="T-2" branch="x"/>', true],
    ['a task another agent holds', as('CEO'), 'artifact_update', { id: 'T-1', title: 'New' }, '<artifact_update id="T-1" title="New"/>', true],
    ['the frozen status', as('CEO'), 'artifact_update', { id: 'T-3', status: 'frozen' }, '<artifact_update id="T-3" status="frozen"/>', true],
    ['a status and a cleared dependency list', as('CEO'), 'artifact_update', { id: 'T-3', status: 'BLOCKED', depends_on: [], parent: 'none', technical_refinement: 'pending' }, '<artifact_update id="T-3" status="blocked" depends_on="none" parent="none" technical_refinement="pending"/>', false],
    ['a comment', reviewer, 'artifact_comment', { id: 't-1', text: ' Looks fine. ' }, '<artifact_comment id="T-1">Looks fine.</artifact_comment>', false],
    ['a comment on an unknown artifact', reviewer, 'artifact_comment', { id: 'T-9', text: 'x' }, '<artifact_comment id="T-9">x</artifact_comment>', true],
    ['a skill of the role', developer, 'skill_read', { names: ['git-flow'] }, '<skill_read name="git-flow"/>', false],
    ['an unknown skill', developer, 'skill_read', { names: 'git-flow, other' }, '<skill_read name="git-flow,other"/>', true],
    ['the skills of every role', as('CEO'), 'skill_list', {}, '<skill_list/>', false],
    ['the skill list, refused to a role that does not write skills', developer, 'skill_list', {}, '<skill_list/>', true],
    ['a skill write', as('CEO'), 'skill_write', { name: 'deploy', description: 'Deploys.', roles: ['qa', 'developer'], content: ' Run it. ' }, '<skill_write name="deploy" roles="QA,DEVELOPER" description="Deploys.">Run it.</skill_write>', false],
  ])('should carry out %s exactly as the tag does', async (_label, requester, tool, args, tag, fails) => {
    const viaTag = setup();
    const viaTool = setup();
    const parsed = new AgentRequestParserService().parse(tag);
    if (parsed.kind !== 'requests') {
      throw new Error(`Not a request: ${tag}`);
    }

    const expected = await viaTag.requests.executeOne(parsed.requests[0]!, requester);
    const result = await viaTool.useCase.execute(viaTool.open(requester).credential, tool, args);

    expect(expected.failed).toBe(fails);
    expect(result).toEqual({ status: 'done', text: expected.body, isError: fails });
    expect(await boardOf(viaTool)).toEqual(await boardOf(viaTag));
    expect(viaTool.skills.written).toEqual(viaTag.skills.written);
  });

  it('should read a skill in the variant of the tools interface, which a tag reads on the tags interface', async () => {
    const viaTool = setup();
    const viaTag = setup();
    const parsed = new AgentRequestParserService().parse('<skill_read name="git-flow"/>');

    await viaTool.useCase.execute(viaTool.open(developer).credential, 'skill_read', { names: ['git-flow'] });
    await viaTag.requests.executeOne(parsed.kind === 'requests' ? parsed.requests[0]! : { kind: 'skill_list' }, developer);

    expect(viaTool.skills.readInterfaces).toEqual(['tools']);
    expect(viaTag.skills.readInterfaces).toEqual(['tags']);
  });

  it('should refuse a skill write to a role that does not write skills', async () => {
    const { useCase, open, skills } = setup();
    skills.writeResult = { ok: false, error: 'Writing skills is reserved to the agents that write skills.' };

    const result = await useCase.execute(open(developer).credential, 'skill_write', { name: 'a', description: 'b', roles: ['QA'], content: 'c' });

    expect(result).toEqual({ status: 'done', text: 'Writing skills is reserved to the agents that write skills.', isError: true });
  });

  it('should ignore the arguments a tool does not take', async () => {
    const { useCase, open } = setup();

    const result = await useCase.execute(open(developer).credential, 'artifact_read', { ids: ['T-3'], toolSummary: 'Reading the task', extra: { nested: true } });

    expect(result).toMatchObject({ status: 'done', isError: false });
  });

  it.each([
    ['artifact_read', {}, 'Name the artifacts to read in ids, as in ["T-1"]. (in artifact_read)'],
    ['artifact_read', { ids: ['T-3'], tree: 'yes' }, 'tree is true or false. (in artifact_read)'],
    ['artifact_read', { ids: [3] }, 'ids is a list of strings. (in artifact_read)'],
    ['artifact_update', { status: 'done' }, 'id is required. (in artifact_update)'],
    ['artifact_update', { id: 7 }, 'id is a string. (in artifact_update)'],
    ['artifact_update', { id: 'T-3', status: 'finished' }, 'Unknown status "finished". Use one of: backlog, ready, in_progress, in_review, changes_requested, approved, in_testing, tested, done, blocked, frozen, cancelled. (in artifact_update)'],
    ['artifact_update', { id: 'T-3', sections: { overview: 'x' } }, 'sections is a list of objects. (in artifact_update)'],
    ['artifact_update', { id: 'T-3', sections: [{ name: 'overview', content: 'x', mode: 'prepend' }] }, 'Unknown section mode "prepend". Use one of: replace, append. (in artifact_update)'],
    ['artifact_update', { id: 'T-3', pull_requests: [{ title: 'x' }] }, 'url is required. (in artifact_update)'],
    ['artifact_update', { id: 'T-3', pull_requests: [{ url: 'u', state: 'draft' }] }, 'Unknown pull request state "draft". Use one of: open, merged, closed. (in artifact_update)'],
    ['artifact_create', { type: 'epic', title: 'x' }, 'Unknown type "epic". Use one of: feature, task. (in artifact_create)'],
    ['artifact_create', { type: 'task', title: 'x', business_refinement: 'later' }, 'Unknown business_refinement "later". Use one of: pending, done, skipped. (in artifact_create)'],
    ['artifact_list', { status: ['open'] }, 'Unknown status "open". Use one of: backlog, ready, in_progress, in_review, changes_requested, approved, in_testing, tested, done, blocked, frozen, cancelled. (in artifact_list)'],
    ['artifact_comment', { id: 'T-3', text: '  ' }, 'text is required. (in artifact_comment)'],
    ['skill_read', { names: [] }, 'Name the skills to read in names, as in ["playwright-web"]. (in skill_read)'],
    ['skill_write', { name: 'a', roles: ['QA'], content: 'c' }, 'skill_write needs a name, a description, the roles that read the skill and its content. (in skill_write)'],
  ])('should refuse a %s call with arguments it cannot read: %j', async (tool, args, text) => {
    const { useCase, open } = setup();

    const result = await useCase.execute(open(as('CEO')).credential, tool, args);

    expect(result).toEqual({ status: 'done', text, isError: true });
  });

  it('should send each skill read and write to the channel as a skill activity', async () => {
    const { useCase, open } = setup();
    const onSkill = rs.fn();
    const { credential } = open(developer, onSkill);

    await useCase.execute(credential, 'skill_read', { names: ['git-flow'] });

    expect(onSkill).toHaveBeenCalledWith({ kind: 'skill', id: expect.any(String), action: 'read', names: ['git-flow'], status: 'completed' });
  });

  it('should refuse a credential that is not open, including one whose agent stopped working', async () => {
    const { useCase, open, toolSessions } = setup();
    const { port, credential } = open(developer);
    toolSessions.close(port);

    await expect(useCase.execute(credential, 'artifact_list', {})).resolves.toEqual({ status: 'closed' });
    await expect(useCase.execute('guess', 'artifact_list', {})).resolves.toEqual({ status: 'closed' });
  });

  it('should answer a tool that does not exist as unknown', async () => {
    const { useCase, open } = setup();

    await expect(useCase.execute(open(developer).credential, 'artifact_delete', {})).resolves.toEqual({ status: 'unknown_tool' });
  });

  it('should log each call and each failure in the conversation it belongs to', async () => {
    const { useCase, open } = setup();
    const logs: string[] = [];
    const contexts: (string | undefined)[] = [];
    const logContext = new ConversationLogContextService();
    rs.spyOn(Logger.prototype, 'log').mockImplementation((message: unknown) => {
      logs.push(String(message));
      contexts.push(logContext.current());
    });
    const warn = rs.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await useCase.execute(open(developer).credential, 'artifact_update', { id: 'T-9' });

    expect(logs).toContain('[Agent Tool Call] Conversation=c1, Role=DEVELOPER, Tool=artifact_update, Failed=true');
    expect(warn).toHaveBeenCalledWith('[Agent Request Failed] Role=DEVELOPER, Request=update, Id=T-9, Reason="Unknown artifact "T-9"."');
    rs.restoreAllMocks();
  });
});
