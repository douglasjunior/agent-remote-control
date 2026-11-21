import { describe, expect, it } from '@rstest/core';

import type { AgentActivity } from '../../agent/ports/agent.port.js';

import { StubAgentPort } from './stub-agent.port.js';


describe('StubAgentPort', () => {
  it('should record steering prompts and answer with the configured result', async () => {
    const stub = new StubAgentPort();
    stub.supportsSteering = true;

    await expect(stub.sendSteeringPrompt('Steer instruction')).resolves.toBe('injected');
    stub.steeringResult = 'not_running';
    await expect(stub.sendSteeringPrompt('Second instruction')).resolves.toBe('not_running');

    expect(stub.steeringPrompts).toEqual(['Steer instruction', 'Second instruction']);
  });

  it('should send nothing to an agent without steering', async () => {
    const stub = new StubAgentPort();

    await expect(stub.sendSteeringPrompt('Steer instruction')).resolves.toBe('unsupported');
    expect(stub.steeringPrompts).toEqual([]);
  });

  it('should support activity listeners', () => {
    const stub = new StubAgentPort();

    const received: AgentActivity[] = [];
    const unsubscribe = stub.onActivity(act => received.push(act));

    const activity: AgentActivity = {
      kind: 'thought',
      id: 'thought-1',
      text: 'thinking',
    };
    stub.emitActivity(activity);
    expect(received).toEqual([activity]);

    unsubscribe();
    unsubscribe();
    stub.emitActivity({ kind: 'cancelled', id: 'cancel-1' });
    expect(received).toHaveLength(1);
  });

  it('should support closeSession, disconnect, and models probing', async () => {
    const stub = new StubAgentPort();
    await stub.connect();
    await stub.createSession('/cwd');

    expect(stub.connected).toBe(true);
    expect(stub.currentSessionId).toBe('session-1');

    await stub.closeSession();
    expect(stub.currentSessionId).toBeUndefined();

    await stub.cancel();
    expect(stub.cancelCalls).toBe(1);

    await stub.disconnect();
    expect(stub.connected).toBe(false);

    expect(stub.getAvailableModels()).toBeNull();
    expect(await stub.getAvailableEffortsForModel('model-1')).toBeNull();
  });

  it('should yield the configured updates when there is no mock response', async () => {
    const stub = new StubAgentPort();
    stub.updatesToYield = [{ kind: 'text', text: 'chunk' }];

    const updates: unknown[] = [];
    for await (const update of stub.prompt('hi')) {
      updates.push(update);
    }

    expect(updates).toEqual([{ kind: 'text', text: 'chunk' }]);
  });

  it('should fail the prompt with the configured error', async () => {
    const stub = new StubAgentPort();
    stub.errorToThrowOnPrompt = new Error('prompt failed');

    await expect(stub.prompt('hi').next()).rejects.toThrow('prompt failed');
  });
});
