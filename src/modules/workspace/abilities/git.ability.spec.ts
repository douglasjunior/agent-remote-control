import { describe, expect, it } from 'vitest';
import { GIT_ABILITY } from './git.ability.js';

describe('git.ability', () => {
  it('should include conventional commit rules in pt-BR', () => {
    expect(GIT_ABILITY).toContain('Conventional Commits');
    expect(GIT_ABILITY).toContain('pt-BR');
    expect(GIT_ABILITY).toContain('50 characters');
  });

  it('should include git safety guidelines', () => {
    expect(GIT_ABILITY).toContain('force push');
    expect(GIT_ABILITY).toContain('git status');
  });
});
