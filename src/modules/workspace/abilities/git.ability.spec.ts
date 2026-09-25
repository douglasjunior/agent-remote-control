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

  it('should require SSH clones with non-interactive host key acceptance', () => {
    expect(GIT_ABILITY).toContain('SSH URL form, never HTTPS');
    expect(GIT_ABILITY).toContain('git@ssh.dev.azure.com:v3/');
    expect(GIT_ABILITY).toContain('StrictHostKeyChecking=accept-new');
  });

  it('should generate an RSA key pair and return only the public key to the user', () => {
    expect(GIT_ABILITY).toContain('ssh-keygen -t rsa -b 4096 -N ""');
    expect(GIT_ABILITY).toContain('full content of $HOME/.ssh/id_rsa.pub');
    expect(GIT_ABILITY).toContain('Never print, copy, or transmit the private key');
  });
});
