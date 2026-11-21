import { describe, expect, it } from '@rstest/core';

import { AgentRegistryService } from '../../agent-definitions/services/agent-registry.service.js';
import { StubAgentSkillsPort } from '../testing/stub-agent-skills.port.js';

import { AgentToolCatalogService } from './agent-tool-catalog.service.js';


const STATUSES_BUT_FROZEN = ['backlog', 'ready', 'in_progress', 'in_review', 'changes_requested', 'approved', 'in_testing', 'tested', 'done', 'blocked', 'cancelled'];

function setup() {
  const skills = new StubAgentSkillsPort();
  skills.writers = ['CEO'];
  skills.skills = {
    DEVELOPER: [
      { name: 'git-flow', description: 'How branches are named.', content: '' },
      { name: 'web-testing', description: 'Testing a web app.', content: '' },
    ],
  };
  return { catalog: new AgentToolCatalogService(new AgentRegistryService(), skills), skills };
}

const toolOf = (catalog: AgentToolCatalogService, role: string, name: string) => catalog.tools(role).find(tool => tool.name === name);
const propertiesOf = (catalog: AgentToolCatalogService, role: string, name: string) =>
  Object.keys((toolOf(catalog, role, name)?.inputSchema as { properties: object }).properties);

describe('AgentToolCatalogService', () => {
  it('should give each role the tools its access allows', () => {
    const { catalog } = setup();
    const names = (role: string) => catalog.tools(role).map(tool => tool.name);

    expect(names('CEO')).toEqual(['artifact_list', 'artifact_read', 'artifact_create', 'artifact_update', 'artifact_comment', 'skill_read', 'skill_list', 'skill_write']);
    expect(names('PRODUCT_OWNER')).toEqual(['artifact_list', 'artifact_read', 'artifact_create', 'artifact_update', 'artifact_comment', 'skill_read']);
    expect(names('DEVELOPER')).toEqual(['artifact_list', 'artifact_read', 'artifact_update', 'artifact_comment', 'skill_read']);
    expect(names('CODE_REVIEWER')).toEqual(['artifact_list', 'artifact_read', 'artifact_update', 'artifact_comment', 'skill_read']);
    expect(names('IT_SUPPORT')).toEqual(['artifact_list', 'artifact_read', 'artifact_comment', 'skill_read']);
  });

  it('should build the CEO update from the fields and the one section it writes, without the frozen status', () => {
    const { catalog } = setup();

    expect(propertiesOf(catalog, 'CEO', 'artifact_update')).toEqual(['id', 'title', 'status', 'parent', 'project', 'depends_on', 'business_refinement', 'design_refinement', 'technical_refinement', 'sections', 'note']);
    expect(toolOf(catalog, 'CEO', 'artifact_update')?.inputSchema).toMatchObject({
      required: ['id'],
      properties: {
        status: { type: 'string', enum: STATUSES_BUT_FROZEN },
        design_refinement: { type: 'string', enum: ['pending', 'done', 'skipped'] },
        sections: { type: 'array', items: { properties: { name: { enum: ['overview'] }, mode: { enum: ['replace', 'append'] } }, required: ['name', 'content'] } },
      },
    });
  });

  it('should let a developer change only its branch, pull requests and implementation notes', () => {
    const { catalog } = setup();

    expect(propertiesOf(catalog, 'DEVELOPER', 'artifact_update')).toEqual(['id', 'branch', 'pull_requests', 'sections', 'note']);
    expect(toolOf(catalog, 'DEVELOPER', 'artifact_update')?.inputSchema).toMatchObject({
      properties: {
        sections: { items: { properties: { name: { enum: ['implementation_notes'] } } } },
        pull_requests: { items: { properties: { state: { enum: ['open', 'merged', 'closed'] } }, required: ['url'] } },
      },
    });
  });

  it('should let a reviewer write only its review findings', () => {
    const { catalog } = setup();

    expect(propertiesOf(catalog, 'CODE_REVIEWER', 'artifact_update')).toEqual(['id', 'sections', 'note']);
    expect(toolOf(catalog, 'CODE_REVIEWER', 'artifact_update')?.inputSchema).toMatchObject({
      properties: { sections: { items: { properties: { name: { enum: ['review_findings'] } } } } },
    });
  });

  it('should offer the type filter and whole trees only to the roles allowed', () => {
    const { catalog } = setup();

    expect(propertiesOf(catalog, 'CEO', 'artifact_list')).toEqual(['type', 'status', 'parent', 'project']);
    expect(propertiesOf(catalog, 'DEVELOPER', 'artifact_list')).toEqual(['status', 'parent', 'project']);
    expect(toolOf(catalog, 'DEVELOPER', 'artifact_list')?.description).toContain('Lists the tasks');
    expect(propertiesOf(catalog, 'TECH_LEAD', 'artifact_read')).toEqual(['ids', 'tree']);
    expect(propertiesOf(catalog, 'CEO', 'artifact_read')).toEqual(['ids']);
  });

  it('should let a creator write its overview and the sections and refinements of its role', () => {
    const { catalog } = setup();

    expect(toolOf(catalog, 'TECH_LEAD', 'artifact_create')?.inputSchema).toMatchObject({
      required: ['type', 'title'],
      properties: {
        type: { enum: ['feature', 'task'] },
        business_refinement: { enum: ['pending', 'done', 'skipped'], description: 'Left out: pending.' },
        design_refinement: { enum: ['pending', 'done', 'skipped'], description: 'Left out: skipped.' },
        technical_refinement: { enum: ['pending', 'done', 'skipped'], description: 'Left out: pending.' },
        sections: { items: { properties: { name: { enum: ['overview', 'technical_solution', 'test_cases', 'acceptance_criteria', 'flows', 'glossary', 'pending_decisions', 'open_questions'] } } } },
      },
    });
    expect(propertiesOf(catalog, 'CEO', 'artifact_create')).not.toContain('ref');
    expect(JSON.stringify(toolOf(catalog, 'CEO', 'artifact_update')?.inputSchema)).not.toContain('Left out');
  });

  it('should name the roles a skill may be written for', () => {
    const { catalog } = setup();

    expect(toolOf(catalog, 'CEO', 'skill_write')?.inputSchema).toMatchObject({
      required: ['name', 'description', 'roles', 'content'],
      properties: { roles: { items: { enum: new AgentRegistryService().listRoles() } } },
    });
  });

  it('should open the instructions with a line that stands alone and list the skills of the role after it', async () => {
    const { catalog } = setup();

    const instructions = await catalog.instructions('DEVELOPER');

    expect(instructions.split('\n')).toEqual([
      'The board of this conversation and the skills of your team are reached through the tools of this server, and the skills your role may read are listed below.',
      '',
      'Skills (read one in full with skill_read before the work it describes):',
      '- git-flow: How branches are named.',
      '- web-testing: Testing a web app.',
    ]);
  });

  it('should say when the role has no skills and return the tools with the instructions', async () => {
    const { catalog } = setup();

    const result = await catalog.catalog('QA');

    expect(result.instructions.endsWith('Your role has no skills.')).toBe(true);
    expect(result.tools).toEqual(catalog.tools('QA'));
  });
});
