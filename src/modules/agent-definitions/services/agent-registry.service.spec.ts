import { beforeEach, describe, expect, it } from 'vitest';

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
      expect(promptUpper).toContain('You are the CEO, the lead orchestrator of agent-remote-control.');
      expect(promptMixed).toBe(promptUpper);
    });

    it('should include root directory guideline for delegations in the CEO system prompt', () => {
      const prompt = service.getSystemPrompt('CEO');
      expect(prompt).toContain('top-level root directory of the project');
      expect(prompt).toContain('never nested paths or internal subfolders');
    });

    it('should give the CEO its team of every other registered agent', () => {
      service.registerDefinition({
        role: 'REVIEWER',
        name: 'Reviewer Agent',
        description: 'Reviews pull requests.',
        buildSystemPrompt: () => 'Reviewer prompt',
        delegation: {},
        turnReminder: 'Reviewer turn reminder',
      });

      const prompt = service.getSystemPrompt('CEO');

      expect(prompt).toContain('- DEVELOPER (Developer Agent):');
      expect(prompt).toContain('- REVIEWER (Reviewer Agent): Reviews pull requests.');
      expect(prompt).not.toContain('- CEO (');
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
        role: 'TESTER',
        name: 'Tester Agent',
        description: 'Testing specialist',
        buildSystemPrompt: () => 'You test things.',
        defaultModel: 'claude-3-5-sonnet',
        delegation: {},
        turnReminder: 'Tester turn reminder',
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

  describe('getDefaultSessionMode', () => {
    it('should return resume for DEVELOPER role in case-insensitive manner', () => {
      expect(service.getDefaultSessionMode('developer')).toBe('resume');
      expect(service.getDefaultSessionMode('DEVELOPER')).toBe('resume');
    });

    it('should return resume for TECH_LEAD role in case-insensitive manner', () => {
      expect(service.getDefaultSessionMode('tech_lead')).toBe('resume');
      expect(service.getDefaultSessionMode('TECH_LEAD')).toBe('resume');
    });

    it('should return new for CODE_REVIEWER role in case-insensitive manner', () => {
      expect(service.getDefaultSessionMode('code_reviewer')).toBe('new');
      expect(service.getDefaultSessionMode('CODE_REVIEWER')).toBe('new');
    });

    it('should return resume as fallback for unknown role or agent without explicit mode', () => {
      expect(service.getDefaultSessionMode('CEO')).toBe('resume');
      expect(service.getDefaultSessionMode('UNKNOWN_ROLE')).toBe('resume');
    });
  });

  describe('getDelegationContract', () => {
    it('should return the contract declared by the role in case-insensitive manner', () => {
      expect(service.getDelegationContract('developer')).toEqual({
        project: 'required',
        sessionMode: 'overridable',
      });
      expect(service.getDelegationContract('GIT_OPS')).toEqual({
        project: 'optional',
        sessionMode: 'overridable',
      });
    });

    it('should omit the session mode for a role that keeps it fixed', () => {
      expect(service.getDelegationContract('CODE_REVIEWER')).toEqual({ project: 'required' });
    });

    it('should return an empty contract for an unknown role', () => {
      expect(service.getDelegationContract('UNKNOWN_ROLE')).toEqual({});
    });
  });

  describe('getTurnReminder', () => {
    it('should return turn reminder for CEO role in case-insensitive manner', () => {
      const reminderUpper = service.getTurnReminder('CEO');
      const reminderLower = service.getTurnReminder('ceo');

      expect(reminderUpper).toBeDefined();
      expect(reminderLower).toBe(reminderUpper);
      expect(reminderUpper).toContain('strictly an orchestrator');
    });

    it('should return turn reminder for TECH_LEAD role in case-insensitive manner', () => {
      const reminderUpper = service.getTurnReminder('TECH_LEAD');
      const reminderLower = service.getTurnReminder('tech_lead');

      expect(reminderUpper).toBeDefined();
      expect(reminderLower).toBe(reminderUpper);
      expect(reminderUpper).toContain('Tech Lead and software architect');
    });

    it('should return turn reminder for DEVELOPER role in case-insensitive manner', () => {
      const reminderUpper = service.getTurnReminder('DEVELOPER');
      const reminderLower = service.getTurnReminder('developer');

      expect(reminderUpper).toBeDefined();
      expect(reminderLower).toBe(reminderUpper);
      expect(reminderUpper).toContain('conventions, architecture, linters, and documentation');
    });

    it('should return fallback turn reminder string for unknown role', () => {
      const fallback = service.getTurnReminder('NON_EXISTENT');
      expect(typeof fallback).toBe('string');
      expect(fallback).toContain('NON_EXISTENT');
      expect(fallback).toContain('<final_response>');
    });

    it('should return custom turn reminder for dynamically registered agent', () => {
      service.registerDefinition({
        role: 'CUSTOM',
        name: 'Custom Agent',
        description: 'Custom description',
        buildSystemPrompt: () => 'prompt',
        delegation: {},
        turnReminder: 'Custom turn reminder',
      });
      expect(service.getTurnReminder('custom')).toBe('Custom turn reminder');
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
        role: 'ARCHITECT',
        name: 'Solution Architect',
        description: 'Architectural governance',
        buildSystemPrompt: () => 'Architect prompt',
        delegation: {},
        turnReminder: 'Architect turn reminder',
      });

      const found = service.getDefinition('ARCHITECT');
      expect(found).toBeDefined();
      expect(found?.name).toBe('Solution Architect');
      expect(service.getSystemPrompt('ARCHITECT')).toBe('Architect prompt');
      expect(service.getTurnReminder('ARCHITECT')).toBe('Architect turn reminder');
    });

    it('should allow overriding an existing agent definition', () => {
      service.registerDefinition({
        role: 'DEVELOPER',
        name: 'Custom Developer',
        description: 'Overridden developer',
        buildSystemPrompt: () => 'Overridden prompt',
        delegation: {},
        turnReminder: 'Overridden turn reminder',
      });

      const found = service.getDefinition('DEVELOPER');
      expect(found?.name).toBe('Custom Developer');
      expect(service.getSystemPrompt('DEVELOPER')).toBe('Overridden prompt');
      expect(service.getTurnReminder('DEVELOPER')).toBe('Overridden turn reminder');
    });
  });
});
