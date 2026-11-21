import { StubAgentPortFactory } from '../testing/stub-agent-port-factory.js';
import { StubAgentPort } from '../testing/stub-agent.port.js';

import { AgentCapabilitiesService } from './agent-capabilities.service.js';
import { AgentProfileResolverService } from './agent-profile-resolver.service.js';


describe('AgentProfileResolverService', () => {
  let factory: StubAgentPortFactory;
  let resolver: AgentProfileResolverService;

  beforeEach(() => {
    factory = new StubAgentPortFactory(() => {
      const port = new StubAgentPort();
      port.modelsToReturn = { availableModels: [{ modelId: 'fast', name: 'fast', displayName: 'Fast Model' }], currentModelId: 'fast' };
      port.effortsByModel = { fast: { availableEfforts: [{ effortId: 'high', name: 'High' }], currentEffortId: 'high' } };
      return port;
    });
    resolver = new AgentProfileResolverService(new AgentCapabilitiesService(factory));
  });

  it('should take the names from the lists', async () => {
    await expect(resolver.resolve({ agentId: 'stub', modelId: 'fast', effortId: 'high' })).resolves.toEqual({
      ok: true,
      profile: { agentId: 'stub', agentName: 'Stub Agent', modelId: 'fast', modelName: 'Fast Model', effortId: 'high', effortName: 'High' },
    });
  });

  it('should ask each list once for the profiles that share it', async () => {
    const lists = new Map();

    await resolver.resolve({ agentId: 'stub', modelId: 'fast', effortId: 'high' }, lists);
    await resolver.resolve({ agentId: 'stub', modelId: 'fast', effortId: 'high' }, lists);

    expect(factory.createdAgentIds).toEqual(['stub', 'stub']);
  });

  it.each([
    ['an agent that is not installed', { agentId: 'ghost' }, 'Unknown agent'],
    ['an unknown model', { agentId: 'stub', modelId: 'ghost' }, 'Unknown model'],
    ['an effort without a model', { agentId: 'stub', effortId: 'high' }, 'An effort needs a model'],
    ['an unknown effort', { agentId: 'stub', modelId: 'fast', effortId: 'ghost' }, 'Unknown effort'],
  ])('should refuse %s', async (_label, choice, error) => {
    await expect(resolver.resolve(choice)).resolves.toEqual({ ok: false, error });
  });
});
