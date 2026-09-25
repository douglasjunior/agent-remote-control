import { describe, expect, it } from 'vitest';
import { INITIAL_AGENT_DEFINITIONS } from './initial-agents.constant.js';

describe('initial-agents.constant', () => {
  it('should contain definitions for CEO and DEVELOPER roles', () => {
    const roles = INITIAL_AGENT_DEFINITIONS.map((def) => def.role);
    expect(roles).toContain('CEO');
    expect(roles).toContain('DEVELOPER');
    expect(INITIAL_AGENT_DEFINITIONS).toHaveLength(2);
  });

  it('should have valid names, descriptions, and system prompts for each agent', () => {
    for (const definition of INITIAL_AGENT_DEFINITIONS) {
      expect(definition.name).toBeTruthy();
      expect(definition.description).toBeTruthy();
      expect(definition.systemPrompt).toBeTruthy();
    }
  });
});
