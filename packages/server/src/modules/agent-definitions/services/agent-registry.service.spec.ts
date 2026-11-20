import { beforeEach, describe, expect, it } from '@rstest/core';

import type { AgentRole } from '../models/agent-role.type.js';

import { AgentRegistryService } from './agent-registry.service.js';


describe('AgentRegistryService', () => {
  let service: AgentRegistryService;

  beforeEach(() => {
    service = new AgentRegistryService();
  });

  describe('getSystemPrompt', () => {
    it('should return specialized system prompt for DEVELOPER role in case-insensitive manner', () => {
      const promptUpper = service.getSystemPrompt('DEVELOPER');
      const promptLower = service.getSystemPrompt('developer');

      expect(promptUpper).toBeDefined();
      expect(promptUpper).toContain('Developer Agent');
      expect(promptLower).toBe(promptUpper);
    });

    it('should return specialized system prompt for TECH_LEAD role in case-insensitive manner', () => {
      const promptUpper = service.getSystemPrompt('TECH_LEAD');
      const promptLower = service.getSystemPrompt('tech_lead');

      expect(promptUpper).toBeDefined();
      expect(promptUpper).toContain('Tech Lead Agent');
      expect(promptLower).toBe(promptUpper);
    });

    it('should return specialized system prompt for CEO role in case-insensitive manner', () => {
      const promptUpper = service.getSystemPrompt('CEO');
      const promptMixed = service.getSystemPrompt('Ceo');

      expect(promptUpper).toBeDefined();
      expect(promptUpper).toContain('You are the CEO');
      expect(promptMixed).toBe(promptUpper);
    });

    it('should point the CEO to its delegation skill for the project folder and the other attributes', () => {
      expect(service.getSystemPrompt('CEO')).toContain('in the `delegation-protocol` skill');
    });

    it('should give the CEO its team of every other registered agent', () => {
      service.registerDefinition({
        role: 'REVIEWER' as AgentRole,
        name: 'Reviewer Agent',
        summary: 'Summary.',
        description: 'Reviews pull requests.',
        buildSystemPrompt: () => 'Reviewer prompt',
        delegation: {},
        artifacts: { scope: 'task', sections: [], fields: [] },
        reentryNote: 'Reviewer re-entry note',
      });

      const prompt = service.getSystemPrompt('CEO');

      expect(prompt).toContain('- DEVELOPER: ');
      expect(prompt).toContain('- REVIEWER: Summary. Delegated with neither.');
      expect(prompt).not.toContain('- CEO: ');
    });

    it('should return fallback prompt when role is unknown', () => {
      const prompt = service.getSystemPrompt('QA_ENGINEER');
      expect(prompt).toBe(
        'You are an AI assistant acting in the role of QA_ENGINEER.',
      );
    });
  });

  describe('getDefaultModel', () => {
    it('should return undefined when agent has no default model configured', () => {
      expect(service.getDefaultModel('DEVELOPER')).toBeUndefined();
    });

    it('should return default model when configured for a registered agent', () => {
      service.registerDefinition({
        role: 'TESTER' as AgentRole,
        name: 'Tester Agent',
        summary: 'Summary.',
        description: 'Testing specialist',
        buildSystemPrompt: () => 'You test things.',
        defaultModel: 'claude-3-5-sonnet',
        delegation: {},
        artifacts: { scope: 'task', sections: [], fields: [] },
        reentryNote: 'Tester re-entry note',
      });

      expect(service.getDefaultModel('tester')).toBe('claude-3-5-sonnet');
    });
  });

  describe('getDisplayName', () => {
    it('should return the definition name for a registered role', () => {
      expect(service.getDisplayName('ceo')).toBe('CEO');
      expect(service.getDisplayName('DEVELOPER')).toBe('Developer Agent');
      expect(service.getDisplayName('TECH_LEAD')).toBe('Tech Lead Agent');
    });

    it('should fall back to the role for an unknown agent', () => {
      expect(service.getDisplayName('AUDITOR')).toBe('AUDITOR');
    });
  });

  describe('hasRole', () => {
    it('should report whether a role is registered, ignoring case', () => {
      expect(service.hasRole('developer')).toBe(true);
      expect(service.hasRole('tech_lead')).toBe(true);
      expect(service.hasRole('AUDITOR')).toBe(false);
    });
  });

  describe('listRoles', () => {
    it('should list every registered role in definition order', () => {
      expect(service.listRoles()).toEqual(service.getAllDefinitions().map(definition => definition.role));
      expect(service.listRoles()).toContain('CEO');
    });
  });

  describe('getDefaultSessionMode', () => {
    it('should return resume for DEVELOPER role in case-insensitive manner', () => {
      expect(service.getDefaultSessionMode('developer')).toBe('resume');
      expect(service.getDefaultSessionMode('DEVELOPER')).toBe('resume');
    });

    it('should return resume for TECH_LEAD role in case-insensitive manner', () => {
      expect(service.getDefaultSessionMode('tech_lead')).toBe('resume');
      expect(service.getDefaultSessionMode('TECH_LEAD')).toBe('resume');
    });

    it('should return the mode a definition declares', () => {
      service.registerDefinition({
        role: 'FRESH' as AgentRole,
        name: 'Fresh Agent',
        summary: 'Summary.',
        description: 'Starts over every time.',
        buildSystemPrompt: () => 'prompt',
        defaultSessionMode: 'new',
        delegation: {},
        artifacts: { scope: 'task', sections: [], fields: [] },
      });

      expect(service.getDefaultSessionMode('fresh')).toBe('new');
    });

    it('should return resume as fallback for unknown role or agent without explicit mode', () => {
      expect(service.getDefaultSessionMode('CEO')).toBe('resume');
      expect(service.getDefaultSessionMode('UNKNOWN_ROLE')).toBe('resume');
    });
  });

  describe('getDelegationContract', () => {
    it('should return the contract declared by the role in case-insensitive manner', () => {
      expect(service.getDelegationContract('developer')).toMatchObject({
        project: 'required',
        artifact: 'required',
      });
      expect(service.getDelegationContract('GIT_OPS')).toEqual({
        project: 'optional',
        sessionMode: 'overridable',
        artifact: 'optional',
      });
      expect(service.getDelegationContract('TECH_LEAD')).toMatchObject({ refines: 'technical' });
    });

    it('should have the code reviewer review the pull request of a task', () => {
      expect(service.getDelegationContract('CODE_REVIEWER')).toMatchObject({
        project: 'required',
        readOnly: true,
        artifact: 'required',
        needsReviewableWork: true,
        statusFlow: { from: ['in_review'] },
      });
    });

    it('should return an empty contract for an unknown role', () => {
      expect(service.getDelegationContract('UNKNOWN_ROLE')).toEqual({});
    });
  });

  describe('isSystemPromptEveryTurn', () => {
    it('should report the CEO as receiving its system prompt every turn', () => {
      expect(service.isSystemPromptEveryTurn('ceo')).toBe(true);
      expect(service.isSystemPromptEveryTurn('DEVELOPER')).toBe(false);
      expect(service.isSystemPromptEveryTurn('UNKNOWN_ROLE')).toBe(false);
    });
  });

  describe('getArtifactAccess', () => {
    it('should give each role its access to the board, and an unknown role read-only tasks', () => {
      expect(service.getArtifactAccess('ceo').scope).toBe('board');
      expect(service.getArtifactAccess('PRODUCT_OWNER')).toMatchObject({ scope: 'tree', create: true });
      expect(service.getArtifactAccess('TECH_LEAD').sections).toContain('technical_solution');
      expect(service.getArtifactAccess('DEVELOPER')).toEqual({ scope: 'task', sections: ['implementation_notes'], fields: ['branch', 'pull_requests'] });
      expect(service.getArtifactAccess('GIT_OPS').fields).toContain('pull_requests');
      expect(service.getArtifactAccess('UNKNOWN_ROLE')).toEqual({ scope: 'task', sections: [], fields: [] });
    });
  });

  describe('getTeam', () => {
    it('should give every definition but the role\'s own, and every one for an unknown role', () => {
      const all = service.getAllDefinitions().map(definition => definition.role);

      expect(service.getTeam('ceo').map(definition => definition.role)).toEqual(all.filter(role => role !== 'CEO'));
      expect(service.getTeam('UNKNOWN').map(definition => definition.role)).toEqual(all);
    });
  });

  describe('getReentryNote', () => {
    it('should return an empty note for a role without one', () => {
      expect(service.getReentryNote('CEO')).toBe('');
    });

    it('should return the re-entry note of TECH_LEAD in case-insensitive manner', () => {
      const noteUpper = service.getReentryNote('TECH_LEAD');

      expect(service.getReentryNote('tech_lead')).toBe(noteUpper);
      expect(noteUpper.startsWith('[RE-ENTRY]')).toBe(true);
      expect(noteUpper).toContain('as the Tech Lead Agent');
    });

    it('should return the re-entry note of DEVELOPER in case-insensitive manner', () => {
      const noteUpper = service.getReentryNote('DEVELOPER');

      expect(service.getReentryNote('developer')).toBe(noteUpper);
      expect(noteUpper).toContain('as the Developer Agent');
      expect(noteUpper).toContain('DONE or INCOMPLETE');
    });

    it('should return fallback note string for unknown role', () => {
      const fallback = service.getReentryNote('NON_EXISTENT');

      expect(fallback).toContain('NON_EXISTENT');
      expect(fallback).toContain('<final_response>');
    });

    it('should return the re-entry note of a dynamically registered agent', () => {
      service.registerDefinition({
        role: 'CUSTOM' as AgentRole,
        name: 'Custom Agent',
        summary: 'Summary.',
        description: 'Custom description',
        buildSystemPrompt: () => 'prompt',
        delegation: {},
        artifacts: { scope: 'task', sections: [], fields: [] },
        reentryNote: 'Custom re-entry note',
      });
      expect(service.getReentryNote('custom')).toBe('Custom re-entry note');
    });
  });

  describe('getDefinition and getAllDefinitions', () => {
    it('should return definition by role name', () => {
      const def = service.getDefinition('DEVELOPER');
      expect(def).toBeDefined();
      expect(def?.role).toBe('DEVELOPER');
    });

    it('should return undefined when definition is not found', () => {
      expect(service.getDefinition('NON_EXISTENT')).toBeUndefined();
    });

    it('should return all registered definitions', () => {
      const all = service.getAllDefinitions();
      expect(all.length).toBeGreaterThanOrEqual(2);
      const roles = all.map(d => d.role);
      expect(roles).toContain('CEO');
      expect(roles).toContain('DEVELOPER');
    });
  });

  describe('registerDefinition', () => {
    it('should allow registering a new agent definition', () => {
      service.registerDefinition({
        role: 'ARCHITECT' as AgentRole,
        name: 'Solution Architect',
        summary: 'Summary.',
        description: 'Architectural governance',
        buildSystemPrompt: () => 'Architect prompt',
        delegation: {},
        artifacts: { scope: 'task', sections: [], fields: [] },
        reentryNote: 'Architect re-entry note',
      });

      const found = service.getDefinition('ARCHITECT');
      expect(found).toBeDefined();
      expect(found?.name).toBe('Solution Architect');
      expect(service.getSystemPrompt('ARCHITECT')).toBe('Architect prompt');
      expect(service.getReentryNote('ARCHITECT')).toBe('Architect re-entry note');
    });

    it('should allow overriding an existing agent definition', () => {
      service.registerDefinition({
        role: 'DEVELOPER',
        name: 'Custom Developer',
        summary: 'Summary.',
        description: 'Overridden developer',
        buildSystemPrompt: () => 'Overridden prompt',
        delegation: {},
        artifacts: { scope: 'task', sections: [], fields: [] },
        reentryNote: 'Overridden re-entry note',
      });

      const found = service.getDefinition('DEVELOPER');
      expect(found?.name).toBe('Custom Developer');
      expect(service.getSystemPrompt('DEVELOPER')).toBe('Overridden prompt');
      expect(service.getReentryNote('DEVELOPER')).toBe('Overridden re-entry note');
    });
  });
});
