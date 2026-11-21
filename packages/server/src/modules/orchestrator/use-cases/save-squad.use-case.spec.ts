import { AgentRegistryService } from '../../agent-definitions/services/agent-registry.service.js';
import type { SaveSquadInput } from '../models/squad.model.js';
import { AgentCapabilitiesService } from '../services/agent-capabilities.service.js';
import { AgentProfileResolverService } from '../services/agent-profile-resolver.service.js';
import { AgentProfilesService } from '../services/agent-profiles.service.js';
import { InMemorySquadStoreFake } from '../testing/in-memory-squad-store.fake.js';
import { StubAgentPortFactory } from '../testing/stub-agent-port-factory.js';
import { StubAgentSettingsStore } from '../testing/stub-agent-settings-store.js';
import { StubAgentPort } from '../testing/stub-agent.port.js';

import { SaveSquadUseCase } from './save-squad.use-case.js';


const input = (overrides: Partial<SaveSquadInput> = {}): SaveSquadInput => ({
  name: '  Backend team ',
  description: ' APIs ',
  isDefault: false,
  profiles: { DEVELOPER: { agentId: 'stub' }, CEO: { agentId: 'stub', modelId: 'fast', effortId: 'high' } },
  ...overrides,
});

describe('SaveSquadUseCase', () => {
  let factory: StubAgentPortFactory;
  let squads: InMemorySquadStoreFake;
  let useCase: SaveSquadUseCase;
  const registry = new AgentRegistryService();

  beforeEach(() => {
    factory = new StubAgentPortFactory(() => {
      const port = new StubAgentPort();
      port.modelsToReturn = { availableModels: [{ modelId: 'fast', name: 'fast', displayName: 'Fast Model' }], currentModelId: 'fast' };
      port.effortsByModel = { fast: { availableEfforts: [{ effortId: 'high', name: 'High' }], currentEffortId: 'high' } };
      return port;
    });
    squads = new InMemorySquadStoreFake();
    const capabilities = new AgentCapabilitiesService(factory);
    useCase = new SaveSquadUseCase(
      squads,
      new AgentProfileResolverService(capabilities),
      new AgentProfilesService(capabilities, new StubAgentSettingsStore(), registry, squads),
    );
  });

  it('should create a squad with the names taken from the lists, probing each agent once', async () => {
    const result = await useCase.execute(input());

    expect(result).toEqual({
      ok: true,
      squad: {
        id: 'squad-1',
        name: 'Backend team',
        description: 'APIs',
        isDefault: false,
        profiles: {
          CEO: { agentId: 'stub', agentName: 'Stub Agent', modelId: 'fast', modelName: 'Fast Model', effortId: 'high', effortName: 'High' },
          DEVELOPER: { agentId: 'stub', agentName: 'Stub Agent', modelId: null, modelName: null, effortId: null, effortName: null },
        },
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
    });
    expect(factory.createdAgentIds).toEqual(['stub', 'stub']);
    await expect(squads.get('squad-1')).resolves.toEqual(result.ok && result.squad);
  });

  it('should replace a squad, leaving out a blank description', async () => {
    await useCase.execute(input());

    const result = await useCase.execute(input({ id: 'squad-1', name: 'Platform', description: '  ', isDefault: true }));

    expect(result).toMatchObject({ ok: true, squad: { id: 'squad-1', name: 'Platform', isDefault: true } });
    expect(result.ok && result.squad).not.toHaveProperty('description');
  });

  it.each([
    ['a blank name', input({ name: '   ' }), 'A squad needs a name'],
    ['no profile', input({ profiles: {} }), 'A squad needs a profile for at least one role'],
    ['an unknown role', input({ profiles: { PIRATE: { agentId: 'stub' } } }), 'Unknown role'],
    ['an unknown agent', input({ profiles: { QA: { agentId: 'ghost' } } }), `${registry.getDisplayName('QA')}: Unknown agent`],
    ['an unknown model', input({ profiles: { QA: { agentId: 'stub', modelId: 'ghost' } } }), `${registry.getDisplayName('QA')}: Unknown model`],
    ['an effort without a model', input({ profiles: { QA: { agentId: 'stub', effortId: 'high' } } }), `${registry.getDisplayName('QA')}: An effort needs a model`],
    ['an unknown effort', input({ profiles: { QA: { agentId: 'stub', modelId: 'fast', effortId: 'ghost' } } }), `${registry.getDisplayName('QA')}: Unknown effort`],
    ['an unknown squad', input({ id: 'ghost' }), 'Unknown squad'],
  ])('should refuse %s without saving anything', async (_label, squad, error) => {
    await expect(useCase.execute(squad)).resolves.toEqual({ ok: false, error });

    await expect(squads.list()).resolves.toEqual([]);
  });

  it('should refuse a name another squad has in any letter case', async () => {
    await useCase.execute(input());

    await expect(useCase.execute(input({ name: 'BACKEND TEAM' }))).resolves.toEqual({ ok: false, error: 'Another squad is named "BACKEND TEAM"' });
  });
});
