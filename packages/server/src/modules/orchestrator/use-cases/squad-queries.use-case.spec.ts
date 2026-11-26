import { AgentRegistryService } from '../../agent-definitions/services/agent-registry.service.js';
import type { Squad } from '../models/squad.model.js';
import { AgentCapabilitiesService } from '../services/agent-capabilities.service.js';
import { AgentProfilesService } from '../services/agent-profiles.service.js';
import { InMemorySquadStoreFake } from '../testing/in-memory-squad-store.fake.js';
import { StubAgentPortFactory } from '../testing/stub-agent-port-factory.js';
import { buildStubProfile, StubAgentSettingsStore } from '../testing/stub-agent-settings-store.js';

import { ApplySquadToConversationUseCase } from './apply-squad-to-conversation.use-case.js';
import { DeleteSquadUseCase } from './delete-squad.use-case.js';
import { ListSquadsUseCase } from './list-squads.use-case.js';


const SQUAD: Squad = {
  id: 's1',
  name: 'Backend team',
  isDefault: false,
  profiles: { DEVELOPER: buildStubProfile('gone'), CEO: buildStubProfile('stub') },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('squad use cases', () => {
  let factory: StubAgentPortFactory;
  let store: StubAgentSettingsStore;
  let squads: InMemorySquadStoreFake;
  let profiles: AgentProfilesService;
  const registry = new AgentRegistryService();

  beforeEach(() => {
    factory = new StubAgentPortFactory();
    factory.unavailableAgentIds.add('gone');
    store = new StubAgentSettingsStore();
    squads = new InMemorySquadStoreFake();
    profiles = new AgentProfilesService(new AgentCapabilitiesService(factory), store, registry, squads);
    squads.seed(SQUAD);
  });

  it('should list each squad with its profiles in the order of the team', async () => {
    const [squad] = await new ListSquadsUseCase(squads, profiles).execute();

    expect(squad).toEqual({
      ...SQUAD,
      profiles: [
        { role: 'CEO', roleName: registry.getDisplayName('CEO'), profile: SQUAD.profiles.CEO, agentAvailable: true },
        { role: 'DEVELOPER', roleName: registry.getDisplayName('DEVELOPER'), profile: SQUAD.profiles.DEVELOPER, agentAvailable: false },
      ],
    });
  });

  it('should delete a squad once, leaving the conversations that applied it as they are', async () => {
    const apply = new ApplySquadToConversationUseCase(squads, profiles);
    await apply.execute('conv', 's1');
    const deleteSquad = new DeleteSquadUseCase(squads);

    await expect(deleteSquad.execute('s1')).resolves.toBe(true);
    await expect(deleteSquad.execute('s1')).resolves.toBe(false);

    await expect(store.load('conv')).resolves.toMatchObject({ profiles: { CEO: SQUAD.profiles.CEO } });
  });

  it('should apply a squad whose agent is not installed, and refuse an unknown one', async () => {
    const apply = new ApplySquadToConversationUseCase(squads, profiles);

    await expect(apply.execute('conv', 's1')).resolves.toEqual({ ok: true });
    await expect(apply.execute('conv', 'ghost')).resolves.toEqual({ ok: false, error: 'Unknown squad' });

    await expect(store.load('conv')).resolves.toMatchObject({
      profiles: { DEVELOPER: { agentId: 'gone' } },
      appliedSquad: { id: 's1', name: 'Backend team' },
    });
    expect(store.saved).toHaveLength(1);
  });

  it('should leave a conversation as it is when the squad it applied changes', async () => {
    await new ApplySquadToConversationUseCase(squads, profiles).execute('conv', 's1');

    await squads.save({ ...SQUAD, profiles: { CEO: buildStubProfile('new') } });

    await expect(store.load('conv')).resolves.toMatchObject({ profiles: { CEO: { agentId: 'stub' } } });
  });
});
