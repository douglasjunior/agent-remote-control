import { describe, expect, it } from '@rstest/core';

import { ARTIFACT_STATUSES } from '../../artifacts/constants/artifact-catalog.constant.js';
import type { AgentDefinition } from '../models/agent-definition.model.js';

import { INITIAL_AGENT_DEFINITIONS } from './initial-agents.constant.js';


const byRole = new Map(INITIAL_AGENT_DEFINITIONS.map(def => [def.role, def]));
const executors = INITIAL_AGENT_DEFINITIONS.filter(def => def.role !== 'CEO');

function definitionOf(role: string): AgentDefinition {
  return byRole.get(role as AgentDefinition['role'])!;
}

function flowOf(role: string) {
  return definitionOf(role).delegation.statusFlow!;
}

describe('initial-agents.constant', () => {
  it('should contain definitions for CEO, GIT_OPS, PRODUCT_OWNER, TECH_LEAD, DEVELOPER, CODE_REVIEWER, QA and IT_SUPPORT roles', () => {
    const roles = INITIAL_AGENT_DEFINITIONS.map(def => def.role);
    expect(roles).toContain('CEO');
    expect(roles).toContain('GIT_OPS');
    expect(roles).toContain('TECH_LEAD');
    expect(roles).toContain('DEVELOPER');
    expect(roles).toContain('CODE_REVIEWER');
    expect(roles).toContain('PRODUCT_OWNER');
    expect(roles).toContain('QA');
    expect(roles).toContain('IT_SUPPORT');
    expect(INITIAL_AGENT_DEFINITIONS).toHaveLength(8);
  });

  describe('structure', () => {
    it('should have valid names, summaries, descriptions and system prompts for each agent', () => {
      for (const definition of INITIAL_AGENT_DEFINITIONS) {
        expect(definition.name).toBeTruthy();
        expect(definition.description).toBeTruthy();
        expect(definition.buildSystemPrompt([])).toBeTruthy();
      }
    });

    it('should give every agent a one-sentence summary shorter than its description', () => {
      for (const definition of INITIAL_AGENT_DEFINITIONS) {
        expect(definition.summary.trim()).not.toBe('');
        expect(definition.summary.length).toBeLessThan(definition.description.length);
        expect(definition.summary.endsWith('.')).toBe(true);
      }
    });

    it('should give every executor a re-entry note that opens the way the note builder does, and the CEO none', () => {
      for (const definition of executors) {
        expect(definition.reentryNote?.startsWith('[RE-ENTRY]\n')).toBe(true);
        expect(definition.reentryNote).toContain(`as the ${definition.name}`);
        expect(definition.systemPromptEveryTurn).toBeUndefined();
      }
      expect(definitionOf('CEO').reentryNote).toBeUndefined();
    });

    it('should send the CEO prompt with every turn and let only the CEO write skills', () => {
      expect(definitionOf('CEO').systemPromptEveryTurn).toBe(true);
      expect(INITIAL_AGENT_DEFINITIONS.filter(def => def.writesSkills).map(def => def.role)).toEqual(['CEO']);
    });

    it('should give every agent its access to the board', () => {
      expect(definitionOf('CEO').artifacts.scope).toBe('board');
      expect(definitionOf('PRODUCT_OWNER').artifacts.scope).toBe('tree');
      expect(definitionOf('TECH_LEAD').artifacts.scope).toBe('tree');
      for (const role of ['DEVELOPER', 'GIT_OPS', 'CODE_REVIEWER', 'QA'] as const) {
        expect(definitionOf(role).artifacts.scope).toBe('task');
      }
    });
  });

  describe('delegation contracts', () => {
    it('should require a project folder and a task for the agents that only work inside one', () => {
      expect(definitionOf('DEVELOPER').delegation).toMatchObject({ project: 'required', artifact: 'required' });
      expect(definitionOf('GIT_OPS').delegation).toEqual({ project: 'optional', sessionMode: 'overridable', artifact: 'optional' });
    });

    it('should leave the session of a role that always works on a task to the task, with no session mode to set', () => {
      const taskBound = INITIAL_AGENT_DEFINITIONS.filter(def => def.delegation.artifact === 'required');

      expect(taskBound.map(def => def.role)).toEqual(['DEVELOPER', 'CODE_REVIEWER', 'QA']);
      for (const definition of taskBound) {
        expect(definition.defaultSessionMode).toBeUndefined();
        expect(definition.delegation.sessionMode).toBeUndefined();
      }
    });

    it('should declare a default session mode only where it differs from resuming, which the registry falls back to', () => {
      expect(INITIAL_AGENT_DEFINITIONS.filter(def => def.defaultSessionMode === 'resume')).toEqual([]);
    });

    it('should review read-only the work of a task that has some', () => {
      expect(definitionOf('CODE_REVIEWER').delegation).toMatchObject({
        project: 'required',
        readOnly: true,
        artifact: 'required',
        needsReviewableWork: true,
      });
    });

    it('should test a reviewed task in practice, with work to inspect', () => {
      expect(definitionOf('QA').delegation).toMatchObject({ project: 'required', artifact: 'required', needsReviewableWork: true });
      expect(definitionOf('QA').artifacts).toEqual({ scope: 'task', sections: ['test_report'], fields: [] });
    });

    it('should run product discovery read-only, in or out of a project, before technical planning', () => {
      const owner = definitionOf('PRODUCT_OWNER');

      expect(owner.delegation).toMatchObject({ project: 'optional', sessionMode: 'overridable', readOnly: true, artifact: 'optional', asksUser: true });
      expect(owner.description).toContain('before the Tech Lead');
      expect(owner.description).toContain('interviews the user directly');
    });

    it('should let only the agents that run discovery, planning and environment work ask the user', () => {
      expect(INITIAL_AGENT_DEFINITIONS.filter(def => def.delegation.asksUser).map(def => def.role)).toEqual(['PRODUCT_OWNER', 'TECH_LEAD', 'IT_SUPPORT']);
    });

    it('should let the CEO delegate to the IT support agent only on the user\'s decision, with no board and no project required', () => {
      const itSupport = definitionOf('IT_SUPPORT');

      expect(itSupport.delegation).toEqual({ project: 'optional', sessionMode: 'overridable', asksUser: true, userInitiatedOnly: true });
      expect(itSupport.artifacts).toEqual({ scope: 'task', sections: [], fields: [] });
      expect(INITIAL_AGENT_DEFINITIONS.filter(def => def.delegation.userInitiatedOnly).map(def => def.role)).toEqual(['IT_SUPPORT']);
    });

    it('should name the artifact it takes whenever an agent is delegated work on the board', () => {
      for (const definition of executors.filter(def => def.delegation.statusFlow)) {
        expect(definition.delegation.artifact).toBe('required');
      }
    });
  });

  describe('refinements', () => {
    it('should let only the product owner and the tech lead settle a refinement, each its own', () => {
      expect(INITIAL_AGENT_DEFINITIONS.filter(def => def.delegation.refines).map(def => [def.role, def.delegation.refines])).toEqual([
        ['PRODUCT_OWNER', 'business'],
        ['TECH_LEAD', 'technical'],
      ]);
    });

    it('should give the refining agents the access that writes their refinement', () => {
      for (const role of ['PRODUCT_OWNER', 'TECH_LEAD']) {
        expect(definitionOf(role).artifacts.fields).toContain('refinement');
      }
    });
  });

  describe('status flows', () => {
    const statuses = ARTIFACT_STATUSES as readonly string[];

    it('should declare a flow for the agents that move a task through the pipeline, and no other', () => {
      expect(INITIAL_AGENT_DEFINITIONS.filter(def => def.delegation.statusFlow).map(def => def.role)).toEqual(['DEVELOPER', 'CODE_REVIEWER', 'QA']);
    });

    it('should name only statuses of the catalog', () => {
      for (const role of ['DEVELOPER', 'CODE_REVIEWER', 'QA']) {
        const { from, start, verdicts } = flowOf(role);

        for (const status of [...from, ...(start ? [start] : []), ...Object.values(verdicts)]) {
          expect(statuses).toContain(status);
        }
      }
    });

    it('should start the task only in a status the agent accepts', () => {
      for (const role of ['DEVELOPER', 'CODE_REVIEWER', 'QA']) {
        const { from, start } = flowOf(role);

        if (start) {
          expect(from).toContain(start);
        }
      }
    });

    it('should give every agent of the pipeline verdicts that are the words its prompt answers with', () => {
      expect(Object.keys(flowOf('DEVELOPER').verdicts).sort()).toEqual(['DONE', 'INCOMPLETE']);
      expect(Object.keys(flowOf('CODE_REVIEWER').verdicts).sort()).toEqual(['APPROVED', 'CHANGES_REQUESTED']);
      expect(Object.keys(flowOf('QA').verdicts).sort()).toEqual(['BLOCKED', 'FAILED', 'PASSED']);
      for (const role of ['DEVELOPER', 'CODE_REVIEWER', 'QA']) {
        const prompt = definitionOf(role).buildSystemPrompt([]);

        for (const verdict of Object.keys(flowOf(role).verdicts)) {
          expect(prompt).toContain(`\`${verdict}\``);
        }
      }
    });

    it('should hand the work the developer finishes to a status the reviewer accepts', () => {
      expect(flowOf('CODE_REVIEWER').from).toContain(flowOf('DEVELOPER').verdicts.DONE);
    });

    it('should hand the work the reviewer approves to a status QA accepts', () => {
      expect(flowOf('QA').from).toContain(flowOf('CODE_REVIEWER').verdicts.APPROVED);
    });

    it('should send every task that must change back to a status the developer accepts', () => {
      const developerFrom = flowOf('DEVELOPER').from;

      expect(developerFrom).toContain(flowOf('CODE_REVIEWER').verdicts.CHANGES_REQUESTED);
      expect(developerFrom).toContain(flowOf('QA').verdicts.FAILED);
    });

    it('should leave the task with the developer after an incomplete delivery, to be delegated again', () => {
      expect(flowOf('DEVELOPER').from).toContain(flowOf('DEVELOPER').verdicts.INCOMPLETE);
    });

    it('should leave the task with QA to go on after a block', () => {
      expect(flowOf('QA').from).toContain(flowOf('QA').verdicts.BLOCKED);
    });

    it('should move a passed task to a status of its own, out of the one QA takes, for the merge', () => {
      expect(flowOf('QA').verdicts.PASSED).toBe('tested');
      expect(flowOf('QA').from).not.toContain('tested');
    });
  });

  describe('descriptions', () => {
    it('should route the preparation of a test environment to QA', () => {
      const description = definitionOf('QA').description;

      expect(description).toContain('It prepares its own test environment, so delegate that preparation to it as part of the test');
      expect(description).toContain('It never commits or pushes any of it');
    });

    it('should route project documented commands and the pull request of a task to DEVELOPER and keep them away from GIT_OPS', () => {
      expect(definitionOf('DEVELOPER').description).toContain('runs the commands a project documents for itself');
      expect(definitionOf('DEVELOPER').description).toContain('pushed, and opened or updated as the pull request of that task');
      expect(definitionOf('GIT_OPS').description).toContain('It does not write code, run project scripts, or push and open the pull request of a task');
    });

    it('should describe GIT_OPS as the owner of the workspace manifest and of merging pull requests', () => {
      const description = definitionOf('GIT_OPS').description;

      expect(description).toContain('keeps the mapping from repository URL to project folder');
      expect(description).toContain('merges pull requests');
    });

    it('should describe CODE_REVIEWER as reviewing the work of a task without running the project', () => {
      const description = definitionOf('CODE_REVIEWER').description;

      expect(description).toContain('its open pull request, or its branch reviewed locally when there is none');
      expect(description).toContain('never runs the project or its tests');
    });

    it('should tell the CEO the verdicts each pipeline agent answers with', () => {
      expect(definitionOf('DEVELOPER').description).toContain('DONE');
      expect(definitionOf('CODE_REVIEWER').description).toContain('APPROVED or CHANGES_REQUESTED');
      expect(definitionOf('QA').description).toContain('PASSED, FAILED');
    });
  });
});
