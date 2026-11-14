import { describe, expect, it } from 'vitest';

import { AgentRegistryService } from '../../agent-definitions/services/agent-registry.service.js';
import { ARTIFACT_AT, buildArtifact } from '../../artifacts/testing/artifact.fixture.js';
import { createArtifactsService } from '../../artifacts/testing/artifacts-service.fixture.js';
import type { AgentRequest, AgentRequester } from '../models/agent-request.model.js';
import { ArtifactPromptFormatterService } from '../services/artifact-prompt-formatter.service.js';
import { StubAgentSkillsPort } from '../testing/stub-agent-skills.port.js';

import { RunAgentRequestsUseCase } from './run-agent-requests.use-case.js';


const CONVERSATION = 'c1';
const held = { role: 'DEVELOPER', roleName: 'Developer Agent', delegationId: 'dev-1', since: ARTIFACT_AT };

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
  const useCase = new RunAgentRequestsUseCase(artifacts.service, new AgentRegistryService(), new ArtifactPromptFormatterService(), new StubAgentSkillsPort());
  return { useCase, artifacts };
}

function setupSkills() {
  const skills = new StubAgentSkillsPort();
  const artifacts = createArtifactsService({ conversationId: CONVERSATION });
  const useCase = new RunAgentRequestsUseCase(artifacts.service, new AgentRegistryService(), new ArtifactPromptFormatterService(), skills);
  return { useCase, skills };
}

const as = (role: string, extra: Partial<AgentRequester> = {}): AgentRequester => ({ role, roleName: role, conversationId: CONVERSATION, ...extra });
const update = (id: string, changes: Partial<Extract<AgentRequest, { kind: 'update' }>> = {}): AgentRequest => ({ kind: 'update', id, sections: [], pullRequests: [], ...changes });

describe('RunAgentRequestsUseCase', () => {
  it('answers every request in order, inside one results block, sending the agent to its skills when one failed', async () => {
    const { useCase } = setup();

    const results = await useCase.execute([
      { kind: 'invalid', tag: '<artifact_read>', reason: 'Name the artifact.' },
      { kind: 'list' },
    ], as('CEO'));

    expect(results).toBe([
      '<request_results>',
      '<request_result request="invalid" status="error">\nName the artifact. (in <artifact_read>)\n</request_result>',
      '<request_result request="list" status="ok">',
      '- F-1 [feature] "Checkout" · status: ready · project: shop · refinement: business done, technical done',
      '- T-1 [task] "API" · status: ready · project: shop · parent: F-1 · refinement: business done, technical done · with: DEVELOPER',
      '- T-3 [task] "Docs" · status: ready · project: shop · refinement: business done, technical done',
      '</request_result>',
      '</request_results>',
      'Some requests failed, for the reasons above. Before writing them again, check their grammar in your skills (the [SKILLS] list of your instructions).',
    ].join('\n'));
    expect(await useCase.execute([{ kind: 'list' }], as('CEO'))).not.toContain('Some requests failed');
  });

  describe('list and read', () => {
    it('lists only tasks for an agent that works on tasks, with the filters of the request', async () => {
      const { useCase } = setup();

      const results = await useCase.execute([{ kind: 'list', types: ['feature'], statuses: 'all', parent: 'F-1', project: 'shop' }], as('DEVELOPER'));

      expect(results).toContain('- T-1 [task]');
      expect(results).toContain('- T-2 [task]');
      expect(results).not.toContain('F-1 [feature]');
    });

    it('lists the roots with parent none and resolves a ref of the same response', async () => {
      const { useCase } = setup();

      const results = await useCase.execute([
        { kind: 'create', ref: 'web', type: 'feature', title: 'Web', project: 'web', sections: [] },
        { kind: 'list', parent: null },
        { kind: 'list', parent: 'web' },
      ], as('PRODUCT_OWNER'));

      expect(results).toContain('<request_result request="create" id="F-2" ref="web" status="ok">\nCreated feature F-2 "Web" in project web, status backlog.');
      expect(results).toContain('- F-2 [feature] "Web"');
      expect(results).toContain('No artifact matches.');
    });

    it('reads several artifacts, a feature in full only for an agent that manages the board', async () => {
      const { useCase } = setup();

      const owner = await useCase.execute([{ kind: 'read', ids: ['F-1'], tree: true }], as('PRODUCT_OWNER'));
      const ceo = await useCase.execute([{ kind: 'read', ids: ['F-1', 'T-3'], tree: false }], as('CEO'));
      const ceoTree = await useCase.execute([{ kind: 'read', ids: ['F-1'], tree: true }], as('CEO'));

      expect(owner).toContain('# F-1 · Checkout');
      expect(owner).toContain('---\n\n# T-1 · API');
      expect(ceo).toContain('<request_result request="read" id="F-1,T-3" status="ok">');
      expect(ceo).toContain('- Children:');
      expect(ceoTree).toContain('Reading a whole feature with its tasks is reserved to the agents that manage the board.');
    });

    it.each([
      [{ kind: 'read', ids: ['T-9'], tree: false }, 'DEVELOPER', 'Unknown artifact "T-9".'],
      [{ kind: 'read', ids: ['T-3', 'F-1'], tree: false }, 'DEVELOPER', 'F-1 is a feature; you work on tasks only.'],
    ] as const)('refuses to read %j as %s', async (request, role, reason) => {
      const { useCase } = setup();

      expect(await useCase.execute([request], as(role))).toContain(`status="error">\n${reason}`);
    });
  });

  describe('create', () => {
    it('creates with the sections and refinements of the agent, resolving refs of earlier requests', async () => {
      const { useCase, artifacts } = setup();

      await useCase.execute([
        { kind: 'create', ref: 'feat', type: 'feature', title: 'Search', project: 'shop', sections: [{ section: 'overview', content: 'Find products.', mode: 'replace' }], refinement: { business: 'done' } },
        { kind: 'create', ref: 'index', type: 'task', title: 'Index', parent: 'feat', sections: [] },
        { kind: 'create', type: 'task', title: 'Ranking', parent: 'feat', dependsOn: ['index'], sections: [] },
        { kind: 'create', type: 'task', title: 'Loose', parent: null, project: 'web', dependsOn: ['T-3'], sections: [] },
      ], as('PRODUCT_OWNER'));

      expect(await artifacts.service.get(CONVERSATION, 'F-2')).toMatchObject({ sections: { overview: 'Find products.' }, refinement: { business: 'done', technical: 'pending' } });
      expect(await artifacts.service.get(CONVERSATION, 'T-4')).toMatchObject({ parentId: 'F-2', projectName: 'shop', history: [{ actor: { kind: 'agent', role: 'PRODUCT_OWNER' } }] });
      expect(await artifacts.service.get(CONVERSATION, 'T-5')).toMatchObject({ parentId: 'F-2', dependsOn: ['T-4'] });
      expect(await artifacts.service.get(CONVERSATION, 'T-6')).toMatchObject({ parentId: null, projectName: 'web', dependsOn: ['T-3'] });
    });

    it.each([
      [{ kind: 'create', type: 'task', title: 'X', project: 'shop', sections: [] }, 'DEVELOPER', 'You cannot create artifacts.'],
      [{ kind: 'create', type: 'task', title: 'X', project: 'shop', sections: [{ section: 'technical_solution', content: 'x', mode: 'replace' }] }, 'PRODUCT_OWNER', 'You cannot write the sections technical_solution.'],
      [{ kind: 'create', type: 'task', title: 'X', project: 'nowhere', sections: [] }, 'TECH_LEAD', 'Unknown project "nowhere". Use one of the project folders exactly as written: shop, web, my-app.'],
    ] as const)('refuses to create %j as %s', async (request, role, reason) => {
      const { useCase } = setup();

      expect(await useCase.execute([request], as(role))).toContain(`status="error">\n${reason}`);
    });

    it('refuses refinement states from an agent that cannot set them, keeping the ref in the result', async () => {
      const { artifacts } = setup();
      const registry = new AgentRegistryService();
      registry.registerDefinition({ ...registry.getDefinition('PRODUCT_OWNER')!, artifacts: { scope: 'tree', create: true, sections: [], fields: [] } });
      const restricted = new RunAgentRequestsUseCase(artifacts.service, registry, new ArtifactPromptFormatterService(), new StubAgentSkillsPort());

      const results = await restricted.execute([{ kind: 'create', ref: 'r', type: 'task', title: 'X', project: 'shop', refinement: { business: 'done' }, sections: [] }], as('PRODUCT_OWNER'));

      expect(results).toContain('<request_result request="create" ref="r" status="error">\nYou cannot set the refinement states.');
    });
  });

  describe('update and comment', () => {
    it('lets the agent holding a task write what its role writes', async () => {
      const { useCase, artifacts } = setup();

      const results = await useCase.execute([
        update('T-1', {
          branch: 'feat/t-1',
          note: 'Implemented',
          sections: [{ section: 'implementation_notes', content: 'Done.', mode: 'append' }],
        }),
      ], as('DEVELOPER', { delegationId: 'dev-1', artifactId: 'T-1' }));

      expect(results).toContain('<request_result request="update" id="T-1" status="ok">\nUpdated T-1; its status is ready.');
      expect(await artifacts.service.get(CONVERSATION, 'T-1')).toMatchObject({ branch: 'feat/t-1', sections: { implementation_notes: 'Done.' } });
    });

    it('lets the coordinator move the status and refinements of an artifact another agent holds', async () => {
      const { useCase, artifacts } = setup();

      await useCase.execute([update('T-1', { status: 'in_progress', refinement: { technical: 'done' } })], as('CEO'));

      expect(await artifacts.service.get(CONVERSATION, 'T-1')).toMatchObject({ status: 'in_progress' });
    });

    it('resolves refs of the same response in the dependencies of an update', async () => {
      const { useCase, artifacts } = setup();

      await useCase.execute([
        { kind: 'create', ref: 'api', type: 'task', title: 'API', parent: 'F-1', sections: [] },
        update('T-3', { parent: 'F-1' }),
        update('T-3', { dependsOn: ['api'] }),
      ], as('TECH_LEAD'));

      expect(await artifacts.service.get(CONVERSATION, 'T-3')).toMatchObject({ parentId: 'F-1', dependsOn: ['T-4'] });
    });

    it('resolves a ref of the same response in the id, parent and dependencies', async () => {
      const { useCase, artifacts } = setup();

      await useCase.execute([
        { kind: 'create', ref: 'new', type: 'feature', title: 'New', project: 'shop', sections: [] },
        update('T-3', { parent: 'new', dependsOn: [], title: 'Guides', project: 'shop' }),
        update('new', { title: 'Newer', parent: null }),
      ], as('TECH_LEAD'));

      expect(await artifacts.service.get(CONVERSATION, 'T-3')).toMatchObject({ parentId: 'F-2', title: 'Guides' });
      expect(await artifacts.service.get(CONVERSATION, 'F-2')).toMatchObject({ title: 'Newer' });
    });

    it.each([
      ['an unknown artifact', update('T-9', { status: 'done' }), as('CEO'), 'Unknown artifact "T-9".'],
      ['a task other than the delegated one', update('T-3', { branch: 'x' }), as('DEVELOPER', { artifactId: 'T-1' }), 'You may change only T-1, the artifact you were delegated.'],
      ['a task when none was delegated', update('T-3', { branch: 'x' }), as('GIT_OPS'), 'You may change only the artifact you were delegated, and this task delegated none.'],
      ['an artifact held by another agent', update('T-1', { title: 'x' }), as('TECH_LEAD'), 'T-1 is with Developer Agent (DEVELOPER) right now, and an artifact is changed only by the agent holding it. Comment on it instead, or wait until it is released.'],
      ['content of a held artifact by the coordinator', update('T-1', { status: 'done', sections: [{ section: 'overview', content: 'x', mode: 'append' }] }), as('CEO'), 'T-1 is with Developer Agent (DEVELOPER) right now'],
      ['a field outside the role', update('T-1', { status: 'done' }), as('DEVELOPER', { delegationId: 'dev-1', artifactId: 'T-1' }), 'You cannot change status.'],
      ['a section outside the role', update('T-3', { sections: [{ section: 'overview', content: 'x', mode: 'replace' }] }), as('TECH_LEAD'), 'You cannot write the sections overview.'],
      ['pull requests outside the role', update('T-3', { pullRequests: [{ url: 'https://x/pull/1' }] }), as('TECH_LEAD'), 'You cannot change pull_requests.'],
      ['an invalid change', update('T-3', { status: 'ready', parent: 'T-2' }), as('CEO'), 'A task goes under a feature, and T-2 is a task.'],
    ])('refuses %s', async (_name, request, requester, reason) => {
      const { useCase } = setup();

      expect(await useCase.execute([request], requester)).toContain(`status="error">\n${reason}`);
    });

    it('leaves freezing to the server and unfreezing to the user', async () => {
      const { useCase, artifacts } = setup();
      artifacts.store.artifactsOf(CONVERSATION).set('T-9', buildArtifact({ id: 'T-9', status: 'frozen' }));

      const results = await useCase.execute([update('T-3', { status: 'frozen' }), update('T-9', { status: 'ready' }), update('T-9', { title: 'Renamed' })], as('CEO'));

      expect(results).toContain('<request_result request="update" id="T-3" status="error">\nOnly the server freezes an artifact. Set blocked to hold it yourself.');
      expect(results).toContain('<request_result request="update" id="T-9" status="error">\nT-9 is frozen after too many delegations, and only the user takes it out.');
      expect(results).toContain('<request_result request="update" id="T-9" status="ok">');
      expect(await artifacts.service.get(CONVERSATION, 'T-9')).toMatchObject({ status: 'frozen', title: 'Renamed' });
    });

    it('comments on any artifact the agent reads', async () => {
      const { useCase, artifacts } = setup();

      const results = await useCase.execute([
        { kind: 'comment', id: 'T-1', text: 'APPROVED' },
        { kind: 'comment', id: 'F-1', text: 'No' },
        { kind: 'comment', id: 'T-9', text: 'No' },
      ], as('CODE_REVIEWER'));

      expect(results).toContain('<request_result request="comment" id="T-1" status="ok">\nCommented on T-1; its status is ready.');
      expect(results).toContain('<request_result request="comment" id="F-1" status="error">\nF-1 is a feature; you work on tasks only.');
      expect(results).toContain('<request_result request="comment" id="T-9" status="error">\nUnknown artifact "T-9".');
      expect((await artifacts.service.get(CONVERSATION, 'T-1'))?.history.at(-1)).toMatchObject({ kind: 'commented', text: 'APPROVED' });
    });
  });

  describe('skills', () => {
    it('returns the full content of the skills of the role', async () => {
      const { useCase, skills } = setupSkills();
      skills.skills = {
        QA: [
          { name: 'playwright-web', description: 'Web.', content: 'Open the browser.' },
          { name: 'api-testing', description: 'API.', content: 'Call the endpoints.' },
        ],
      };

      const onSkill = vi.fn();
      const results = await useCase.execute([{ kind: 'skill_read', names: ['playwright-web', 'api-testing'] }], as('QA'), onSkill);
      await useCase.execute([{ kind: 'list' }], as('QA'), onSkill);

      expect(onSkill).toHaveBeenCalledTimes(1);
      expect(onSkill).toHaveBeenCalledWith({ kind: 'skill', id: expect.any(String), action: 'read', names: ['playwright-web', 'api-testing'], status: 'completed' });

      expect(results).toBe([
        '<request_results>',
        '<request_result request="skill_read" name="playwright-web,api-testing" status="ok">',
        '# Skill: playwright-web\n\nOpen the browser.\n\n---\n\n# Skill: api-testing\n\nCall the endpoints.',
        '</request_result>',
        '</request_results>',
      ].join('\n'));
    });

    it('names the skills of the role when one is unknown', async () => {
      const { useCase, skills } = setupSkills();
      skills.skills = { QA: [{ name: 'playwright-web', description: 'Web.', content: 'Open the browser.' }] };

      const onSkill = vi.fn();
      const unknown = await useCase.execute([{ kind: 'skill_read', names: ['playwright-web', 'cypress'] }], as('QA'), onSkill);
      expect(onSkill).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error: 'Unknown skill "cypress". Your skills are: playwright-web.' }));
      const none = await useCase.execute([{ kind: 'skill_read', names: ['cypress'] }], as('CEO'));

      expect(unknown).toContain('<request_result request="skill_read" name="playwright-web,cypress" status="error">\nUnknown skill "cypress". Your skills are: playwright-web.');
      expect(none).toContain('Unknown skill "cypress". Your role has no skills.');
    });

    it('lists every skill with its roles for a role that writes skills, and refuses any other', async () => {
      const { useCase, skills } = setupSkills();
      skills.writers = ['CEO'];
      skills.listing = [
        { name: 'api-testing', description: 'API.', roles: ['QA'], builtIn: true },
        { name: 'electron-testing', description: 'Electron.', roles: ['QA', 'DEVELOPER'], builtIn: false },
      ];

      const listed = await useCase.execute([{ kind: 'skill_list' }], as('CEO'));
      skills.listing = [];
      const empty = await useCase.execute([{ kind: 'skill_list' }], as('CEO'));
      skills.writers = [];
      const refused = await useCase.execute([{ kind: 'skill_list' }], as('QA'));

      expect(listed).toContain('<request_result request="skill_list" status="ok">\n- api-testing (built-in; roles: QA): API.\n- electron-testing (user; roles: QA, DEVELOPER): Electron.\n</request_result>');
      expect(empty).toContain('There are no skills.');
      expect(refused).toContain('<request_result request="skill_list" status="error">\nListing the skills of every role is reserved to the agents that write skills.');
    });

    it('writes a skill and reports whether it was created, updated or refused', async () => {
      const { useCase, skills } = setupSkills();
      const write = { kind: 'skill_write' as const, name: 'electron-testing', description: 'Electron.', roles: ['QA'], content: '# Electron' };

      const onSkill = vi.fn();
      const created = await useCase.execute([write], as('CEO'), onSkill);
      skills.writeResult = { ok: true, created: false };
      const updated = await useCase.execute([write], as('CEO'), onSkill);
      skills.writeResult = { ok: false, error: 'You cannot write skills.' };
      const refused = await useCase.execute([write], as('QA'), onSkill);

      expect(onSkill.mock.calls.map(([activity]) => [activity.status, activity.created, activity.error])).toEqual([
        ['completed', true, undefined],
        ['completed', false, undefined],
        ['failed', undefined, 'You cannot write skills.'],
      ]);

      expect(skills.written[0]).toEqual({ name: 'electron-testing', description: 'Electron.', roles: ['QA'], content: '# Electron' });
      expect(created).toContain('<request_result request="skill_write" name="electron-testing" status="ok">\nCreated skill "electron-testing" for QA. Agents of those roles see it in their skill catalog from their next session');
      expect(updated).toContain('Updated skill "electron-testing" for QA.');
      expect(refused).toContain('<request_result request="skill_write" name="electron-testing" status="error">\nYou cannot write skills.');
    });
  });
});
