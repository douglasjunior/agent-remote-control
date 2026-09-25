import { describe, expect, it } from 'vitest';
import { DefaultAgentRegistryAdapter } from './default-agent-registry.adapter.js';

describe('DefaultAgentRegistryAdapter', () => {
  it('should return undefined for system prompt when no role is given', () => {
    const adapter = new DefaultAgentRegistryAdapter();
    expect(adapter.getSystemPrompt()).toBeUndefined();
    expect(adapter.getSystemPrompt('')).toBeUndefined();
  });

  it('should return predefined prompt for CEO and DEVELOPER roles', () => {
    const adapter = new DefaultAgentRegistryAdapter();

    expect(adapter.getSystemPrompt('CEO')).toContain('executive agent');
    expect(adapter.getSystemPrompt('developer')).toContain('software engineer');
  });

  it('should return generic fallback prompt for unknown roles', () => {
    const adapter = new DefaultAgentRegistryAdapter();

    const prompt = adapter.getSystemPrompt('ARCHITECT');
    expect(prompt).toBe(
      'You are an AI assistant acting in the role of ARCHITECT.',
    );
  });

  it('should return undefined for default model when role is not provided or unconfigured', () => {
    const adapter = new DefaultAgentRegistryAdapter();

    expect(adapter.getDefaultModel()).toBeUndefined();
    expect(adapter.getDefaultModel('DEVELOPER')).toBeUndefined();
  });

  it('should allow registering custom role prompts and models', () => {
    const adapter = new DefaultAgentRegistryAdapter();
    adapter.registerRole('TESTER', 'Tester prompt', 'test-model-v1');
    adapter.registerRole('ONLY_PROMPT', 'Only prompt');
    adapter.registerRole('ONLY_MODEL', undefined, 'only-model');

    expect(adapter.getSystemPrompt('TESTER')).toBe('Tester prompt');
    expect(adapter.getDefaultModel('TESTER')).toBe('test-model-v1');
    expect(adapter.getSystemPrompt('ONLY_PROMPT')).toBe('Only prompt');
    expect(adapter.getDefaultModel('ONLY_PROMPT')).toBeUndefined();
    expect(adapter.getSystemPrompt('ONLY_MODEL')).toBe(
      'You are an AI assistant acting in the role of ONLY_MODEL.',
    );
    expect(adapter.getDefaultModel('ONLY_MODEL')).toBe('only-model');
    expect(adapter.getDefaultModel('OTHER')).toBeUndefined();
  });
});
