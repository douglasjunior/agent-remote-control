import { describe, expect, it } from '@rstest/core';

import type { ActiveDelegation } from './active-delegation.model.js';
import { DelegationControl } from './delegation-control.model.js';


describe('ActiveDelegation', () => {
  it('should represent an active delegation structure', () => {
    const delegation: ActiveDelegation = {
      delegationId: 'd-1',
      role: 'DEVELOPER',
      roleName: 'Developer Agent',
      agentInfo: { roleName: 'Developer Agent', agentName: 'stub' },
      projectName: 'my-app',
      artifactId: null,
      summary: 'Summary',
      taskSpec: 'Build login',
      cwd: '/mock/my-app',
      startedAt: 1000,
      agentPort: {} as any,
      turn: {} as any,
      control: new DelegationControl({ runId: 'd-1', summary: 'Summary', contextSince: '2026-01-01T00:00:00.000Z' }),
      stop: async () => undefined,
    };

    expect(delegation.role).toBe('DEVELOPER');
    expect(delegation.projectName).toBe('my-app');
  });
});
