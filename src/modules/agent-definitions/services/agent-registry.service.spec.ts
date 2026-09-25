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

    it('should return specialized system prompt for CEO role in case-insensitive manner', () => {
      const promptUpper = service.getSystemPrompt('CEO');
      const promptMixed = service.getSystemPrompt('Ceo');

      expect(promptUpper).toBeDefined();
      expect(promptUpper).toContain('CEO and Executive Router Agent');
      expect(promptMixed).toBe(promptUpper);
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
        systemPrompt: 'You test things.',
        defaultModel: 'claude-3-5-sonnet',
      });

      expect(service.getDefaultModel('tester')).toBe('claude-3-5-sonnet');
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
        systemPrompt: 'Architect prompt',
      });

      const found = service.getDefinition('ARCHITECT');
      expect(found).toBeDefined();
      expect(found?.name).toBe('Solution Architect');
      expect(service.getSystemPrompt('ARCHITECT')).toBe('Architect prompt');
    });

    it('should allow overriding an existing agent definition', () => {
      service.registerDefinition({
        role: 'DEVELOPER',
        name: 'Custom Developer',
        description: 'Overridden developer',
        systemPrompt: 'Overridden prompt',
      });

      const found = service.getDefinition('DEVELOPER');
      expect(found?.name).toBe('Custom Developer');
      expect(service.getSystemPrompt('DEVELOPER')).toBe('Overridden prompt');
    });
  });
});
