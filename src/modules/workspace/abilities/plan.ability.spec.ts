import { describe, expect, it } from 'vitest';
import { PLAN_ABILITY } from './plan.ability.js';

describe('plan.ability', () => {
  it('should include codebase inspection instructions', () => {
    expect(PLAN_ABILITY).toContain('Codebase Exploration');
    expect(PLAN_ABILITY).toContain('test suites');
  });

  it('should include planning before execution guidelines', () => {
    expect(PLAN_ABILITY).toContain('Plan Formulation');
    expect(PLAN_ABILITY).toContain('Execution & Verification');
  });
});
