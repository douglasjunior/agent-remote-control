import { createWebHarness } from '../testing/web-harness.js';

import { ListAgentOptionsUseCase } from './list-agent-options.use-case.js';


describe('ListAgentOptionsUseCase', () => {
  const setup = () => new ListAgentOptionsUseCase(createWebHarness().configuration);

  it('lists the available agents', () => {
    expect(setup().agents()).toEqual([{ id: 'codex', name: 'Codex' }]);
  });

  it('lists the models and efforts of an available agent', async () => {
    const useCase = setup();

    await expect(useCase.models('codex')).resolves.toEqual([{ id: 'gpt', name: 'GPT', description: 'Fast' }]);
    await expect(useCase.efforts('codex', 'gpt')).resolves.toEqual([{ id: 'high', name: 'High' }]);
  });

  it('refuses an agent that is not available instead of probing it', async () => {
    const { configuration } = createWebHarness();
    const useCase = new ListAgentOptionsUseCase(configuration);

    await expect(useCase.models('ghost')).resolves.toBeNull();
    await expect(useCase.efforts('ghost', 'gpt')).resolves.toBeNull();
    expect(configuration.probedAgents).toEqual([]);
  });
});
