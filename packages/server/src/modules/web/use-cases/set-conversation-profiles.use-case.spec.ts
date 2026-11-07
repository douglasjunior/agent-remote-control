import { createWebHarness } from '../testing/web-harness.js';

import { GetConversationProfilesUseCase } from './get-conversation-profiles.use-case.js';
import { SetConversationProfilesUseCase } from './set-conversation-profiles.use-case.js';


function setup() {
  const harness = createWebHarness();
  const useCase = new SetConversationProfilesUseCase(
    harness.configuration,
    new GetConversationProfilesUseCase(harness.configuration),
    harness.events,
  );
  return { ...harness, useCase };
}

describe('SetConversationProfilesUseCase', () => {
  it('configures through the orchestrator and broadcasts the resulting profiles', async () => {
    const { useCase, configuration, observer } = setup();
    configuration.store.byConversation.set('web-1', { profiles: {}, updatedAt: '2026-01-01T00:00:00Z' });

    const result = await useCase.execute({ conversationId: 'web-1', roles: ['CEO'], agentId: 'codex', modelId: 'gpt' });

    expect(result).toEqual({ ok: true });
    expect(configuration.configureCalls).toEqual([{ conversationId: 'web-1', roles: ['CEO'], agentId: 'codex', modelId: 'gpt' }]);
    expect(observer.sent).toEqual([{ type: 'profiles', conversationId: 'web-1', configured: true, profiles: expect.any(Array) }]);
  });

  it('returns the refusal and broadcasts nothing', async () => {
    const { useCase, configuration, observer } = setup();
    configuration.configureResult = { ok: false, error: 'Unknown agent' };

    await expect(useCase.execute({ conversationId: 'web-1', agentId: 'ghost' })).resolves.toEqual({
      ok: false,
      error: 'Unknown agent',
    });

    expect(observer.sent).toEqual([]);
  });
});
