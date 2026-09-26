import { describe, expect, it } from 'vitest';

import type { ActiveDelegation } from './active-delegation.model.js';


describe('ActiveDelegation', () => {
  it('should represent an active delegation structure', () => {
    const delegation: ActiveDelegation = {
      role: 'DEVELOPER',
      roleName: 'Developer Agent',
      projectName: 'my-app',
      taskSpec: 'Build login',
      cwd: '/mock/my-app',
      startedAt: 1000,
      agentPort: {} as any,
      turn: {} as any,
      steer: async () => undefined,
    };

    expect(delegation.role).toBe('DEVELOPER');
    expect(delegation.projectName).toBe('my-app');
  });
});
