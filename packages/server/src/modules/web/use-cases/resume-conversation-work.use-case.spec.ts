import { describe, expect, it } from 'vitest';

import { createWebHarness } from '../testing/web-harness.js';

import { ResumeConversationWorkUseCase } from './resume-conversation-work.use-case.js';


const work = { id: 'w', role: 'DEVELOPER', roleName: 'Developer', projectName: null, summary: 'Build' };

function setup() {
  const harness = createWebHarness();
  harness.store.seed('web-1');
  const useCase = new ResumeConversationWorkUseCase(harness.agentTurn, harness.workspace, harness.events, harness.turns);
  return { ...harness, useCase, types: () => (harness.store.histories.get('web-1') ?? []).map(entry => entry.type) };
}

describe('ResumeConversationWorkUseCase', () => {
  it('does nothing for work that is not interrupted', async () => {
    const { useCase, agentTurn, types } = setup();

    await useCase.execute('web-1', 'w');

    expect(agentTurn.resumedWorkIds).toEqual([]);
    expect(types()).toEqual([]);
  });

  it('runs the work as a turn, tells the clients it left the list and returns to idle', async () => {
    const { useCase, agentTurn, observer, types, events } = setup();
    agentTurn.interruptedWork = [work];

    await useCase.execute('web-1', 'w');

    expect(agentTurn.resumedWorkIds).toEqual(['w']);
    expect(agentTurn.lastRequest).toMatchObject({ conversationId: 'web-1', agentRole: 'CEO' });
    expect(types()).toEqual(['agent_response']);
    expect(observer.sent).toContainEqual({ type: 'conversation.interrupted', conversationId: 'web-1', interrupted: [] });
    expect(events.stateOf('web-1')).toBe('idle');
  });

  it('reports a failure as a notice and returns to idle', async () => {
    const { useCase, agentTurn, types, events } = setup();
    agentTurn.interruptedWork = [work];
    agentTurn.turnError = new Error('boom');

    await useCase.execute('web-1', 'w');

    expect(types()).toEqual(['notice']);
    expect(events.stateOf('web-1')).toBe('idle');
  });

  it('delivers answers as a turn', async () => {
    const { useCase, agentTurn, types, events } = setup();
    const restoredWork = { workId: 'w', answers: [] };

    await useCase.deliverAnswers('web-1', restoredWork);

    expect(agentTurn.deliveredAnswers).toEqual([restoredWork]);
    expect(agentTurn.lastRequest).toMatchObject({ conversationId: 'web-1', agentRole: 'CEO' });
    expect(types()).toEqual(['agent_response']);
    expect(events.stateOf('web-1')).toBe('idle');
  });
});
