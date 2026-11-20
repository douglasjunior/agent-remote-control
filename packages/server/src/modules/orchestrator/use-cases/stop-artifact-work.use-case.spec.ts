import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core';

import type { ArtifactActor } from '../../artifacts/models/artifact.model.js';
import type { ArtifactsService } from '../../artifacts/services/artifacts.service.js';
import { buildArtifact } from '../../artifacts/testing/artifact.fixture.js';
import { createArtifactsService } from '../../artifacts/testing/artifacts-service.fixture.js';
import type { ActiveDelegation } from '../models/active-delegation.model.js';
import { buildStoppedWorkPrompt } from '../prompts/stopped-work.prompt.js';
import { AgentToolSessionsService } from '../services/agent-tool-sessions.service.js';
import { AgentToolsConfigService } from '../services/agent-tools-config.service.js';
import { ConversationRuntimeService } from '../services/conversation-runtime.service.js';
import { StubAgentPortFactory } from '../testing/stub-agent-port-factory.js';
import { StubAgentPort } from '../testing/stub-agent.port.js';

import { StopArtifactWorkUseCase } from './stop-artifact-work.use-case.js';


const CONVERSATION = 'conv-1';
const USER: ArtifactActor = { kind: 'user', channel: 'web' };
const CEO: ArtifactActor = { kind: 'agent', role: 'CEO', roleName: 'CEO' };

describe('StopArtifactWorkUseCase', () => {
  let artifacts: ArtifactsService;
  let runtime: ConversationRuntimeService;
  let useCase: StopArtifactWorkUseCase;
  let stops: string[];

  const register = (delegationId: string) => {
    const delegation = {
      delegationId,
      role: 'DEVELOPER',
      stop: async (reason: string) => {
        stops.push(reason);
      },
    } as unknown as ActiveDelegation;
    runtime.registerDelegation(CONVERSATION, delegation);
  };

  /** Lets the listener, which runs without being awaited, finish its work. */
  const settle = () => rs.advanceTimersByTimeAsync(0);

  beforeEach(async () => {
    rs.useFakeTimers();
    ({ service: artifacts } = createArtifactsService({
      conversationId: CONVERSATION,
      initial: [buildArtifact({ id: 'T-1', status: 'in_progress' })],
    }));
    runtime = new ConversationRuntimeService(new StubAgentPortFactory(() => new StubAgentPort()), new AgentToolSessionsService(new AgentToolsConfigService()), 60_000);
    stops = [];
    useCase = new StopArtifactWorkUseCase(artifacts, runtime);
    useCase.onModuleInit();
    await artifacts.assign(CONVERSATION, 'T-1', { role: 'DEVELOPER', roleName: 'Developer Agent', delegationId: 'd-1' });
    register('d-1');
  });

  afterEach(() => {
    useCase.onModuleDestroy();
    rs.useRealTimers();
  });

  it.each(['done', 'blocked', 'cancelled'] as const)('should stop the agent holding the artifact when the user moves it to %s', async (status) => {
    await artifacts.update(CONVERSATION, 'T-1', { status }, USER);
    await settle();

    expect(stops).toEqual([buildStoppedWorkPrompt('T-1', status, 'shop')]);
  });

  it('should leave the agent working when the user moves the artifact to a status that keeps the work going', async () => {
    await artifacts.update(CONVERSATION, 'T-1', { status: 'in_review' }, USER);
    await settle();

    expect(stops).toEqual([]);
  });

  it('should leave the agent working when the CEO moves the artifact', async () => {
    await artifacts.update(CONVERSATION, 'T-1', { status: 'cancelled' }, CEO);
    await settle();

    expect(stops).toEqual([]);
  });

  it('should leave the agent working when the user changes something other than the status', async () => {
    await artifacts.update(CONVERSATION, 'T-1', { title: 'Renamed' }, USER);
    await settle();

    expect(stops).toEqual([]);
  });

  it('should do nothing when no agent holds the artifact', async () => {
    await artifacts.release(CONVERSATION, 'T-1', 'd-1', 'finished');
    await artifacts.update(CONVERSATION, 'T-1', { status: 'cancelled' }, USER);
    await settle();

    expect(stops).toEqual([]);
  });

  it('should do nothing when the delegation holding the artifact is no longer running', async () => {
    const artifact = buildArtifact({
      id: 'T-2',
      assignee: { role: 'DEVELOPER', roleName: 'Developer Agent', delegationId: 'gone', since: '2026-01-01T00:00:00.000Z' },
      history: [{ id: 'e', at: '2026-01-01T01:00:00.000Z', actor: USER, kind: 'updated', summary: 'Status', changes: [{ field: 'status', from: 'in_progress', to: 'cancelled' }] }],
    });

    await expect(useCase.execute(CONVERSATION, artifact)).resolves.toBe(false);
  });

  it('should log a stop that fails without breaking the board', async () => {
    runtime.unregisterDelegation(CONVERSATION, runtime.getActiveDelegations(CONVERSATION)[0]!);
    runtime.registerDelegation(CONVERSATION, {
      delegationId: 'd-1',
      role: 'DEVELOPER',
      stop: () => Promise.reject(new Error('agent gone')),
    } as unknown as ActiveDelegation);

    const outcome = await artifacts.update(CONVERSATION, 'T-1', { status: 'cancelled' }, USER);
    await settle();

    expect(outcome.ok).toBe(true);
  });

  it('should ignore deleted artifacts', async () => {
    await artifacts.release(CONVERSATION, 'T-1', 'd-1', 'finished');
    await artifacts.remove(CONVERSATION, 'T-1', USER);
    await settle();

    expect(stops).toEqual([]);
  });
});
