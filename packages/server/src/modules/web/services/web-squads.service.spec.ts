import { buildStubProfile } from '../../orchestrator/testing/stub-agent-settings-store.js';
import { createWebHarness } from '../testing/web-harness.js';

import { WebSquadsService } from './web-squads.service.js';


describe('WebSquadsService', () => {
  it('should list the squads as the protocol carries them', async () => {
    const { configuration, registry } = createWebHarness();
    configuration.squads = [
      {
        id: 's1',
        name: 'Backend team',
        description: 'APIs',
        isDefault: false,
        profiles: [
          { role: 'CEO', roleName: 'CEO', profile: buildStubProfile('claude', { agentName: 'Claude', modelId: 'opus', modelName: 'Opus' }), agentAvailable: false },
          { role: 'QA', roleName: 'QA' },
        ],
        createdAt: 'a',
        updatedAt: 'b',
      },
    ];

    await expect(new WebSquadsService(configuration, registry).list()).resolves.toEqual([
      {
        id: 's1',
        name: 'Backend team',
        description: 'APIs',
        isDefault: false,
        profiles: [
          { role: 'CEO', roleName: 'CEO', agent: { id: 'claude', name: 'Claude', available: false }, model: { id: 'opus', name: 'Opus' } },
          { role: 'QA', roleName: 'QA' },
        ],
        createdAt: 'a',
        updatedAt: 'b',
      },
    ]);
  });
});
