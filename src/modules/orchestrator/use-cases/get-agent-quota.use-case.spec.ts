import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentQuota } from '../../agent/ports/agent.port.js';
import { StubAgentPortFactory } from '../testing/stub-agent-port-factory.js';
import { StubAgentPort } from '../testing/stub-agent.port.js';

import { GetAgentQuotaUseCase } from './get-agent-quota.use-case.js';


const quota: AgentQuota = { groups: [] };

function buildFactory(ports: Record<string, StubAgentPort>): StubAgentPortFactory {
  const factory = new StubAgentPortFactory(agentId => ports[agentId] ?? new StubAgentPort());
  factory.agents = [
    { agentId: 'agy', displayName: 'Antigravity' },
    { agentId: 'copilot', displayName: 'GitHub Copilot' },
    { agentId: 'codex', displayName: 'OpenAI Codex' },
  ];
  return factory;
}

describe('GetAgentQuotaUseCase', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should report the quota of every available agent in catalog order', async () => {
    const agy = new StubAgentPort();
    agy.quotaToReturn = quota;
    const factory = buildFactory({ agy });
    factory.unavailableAgentIds.add('codex');

    const reports = await new GetAgentQuotaUseCase(factory).execute();

    expect(reports).toEqual([
      { agent: { id: 'agy', name: 'Antigravity' }, status: 'ok', quota },
      { agent: { id: 'copilot', name: 'GitHub Copilot' }, status: 'unsupported' },
    ]);
    expect(factory.createdAgentIds).toEqual(['agy', 'copilot']);
  });

  it('should return an empty list when no agent is available', async () => {
    const factory = buildFactory({});
    for (const { agentId } of factory.agents) {
      factory.unavailableAgentIds.add(agentId);
    }

    await expect(new GetAgentQuotaUseCase(factory).execute()).resolves.toEqual([]);
    expect(factory.createdAgentIds).toEqual([]);
  });

  it('should mark a failing agent as failed without affecting the others', async () => {
    const agy = new StubAgentPort();
    agy.quotaToReturn = quota;
    const copilot = new StubAgentPort();
    copilot.getQuota = async () => {
      throw new Error('gh not authenticated');
    };
    const factory = buildFactory({ agy, copilot });

    const reports = await new GetAgentQuotaUseCase(factory).execute();

    expect(reports.map(report => [report.agent.id, report.status])).toEqual([
      ['agy', 'ok'],
      ['copilot', 'failed'],
      ['codex', 'unsupported'],
    ]);
  });

  it('should mark an agent that cannot be created as failed', async () => {
    const factory = new StubAgentPortFactory(() => {
      throw new Error('cannot build');
    });

    await expect(new GetAgentQuotaUseCase(factory).execute()).resolves.toEqual([{ agent: { id: 'stub', name: 'Stub Agent' }, status: 'failed' }]);
  });

  it('should query the agents in parallel', async () => {
    const started: string[] = [];
    const ports: Record<string, StubAgentPort> = {};
    for (const agentId of ['agy', 'copilot', 'codex']) {
      const port = new StubAgentPort();
      port.getQuota = () => {
        started.push(agentId);
        return new Promise(() => undefined);
      };
      ports[agentId] = port;
    }
    vi.useFakeTimers();

    const pending = new GetAgentQuotaUseCase(buildFactory(ports)).execute();

    expect(started).toEqual(['agy', 'copilot', 'codex']);
    await vi.advanceTimersByTimeAsync(15_000);
    await pending;
  });

  it('should mark a hung agent as failed after the timeout while the others answer', async () => {
    const agy = new StubAgentPort();
    agy.quotaToReturn = quota;
    const copilot = new StubAgentPort();
    copilot.getQuota = () => new Promise(() => undefined);
    const factory = buildFactory({ agy, copilot });
    factory.unavailableAgentIds.add('codex');
    vi.useFakeTimers();

    const pending = new GetAgentQuotaUseCase(factory).execute();
    await vi.advanceTimersByTimeAsync(14_999);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(await pending).toEqual([
      { agent: { id: 'agy', name: 'Antigravity' }, status: 'ok', quota },
      { agent: { id: 'copilot', name: 'GitHub Copilot' }, status: 'failed' },
    ]);
  });

  it('should not surface a rejection that arrives after the timeout as unhandled', async () => {
    const copilot = new StubAgentPort();
    let rejectLate: (reason: Error) => void = () => undefined;
    copilot.getQuota = () => new Promise((_, reject) => {
      rejectLate = reject;
    });
    const factory = buildFactory({ copilot });
    factory.agents = [{ agentId: 'copilot', displayName: 'GitHub Copilot' }];
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', record);
    vi.useFakeTimers();

    try {
      const pending = new GetAgentQuotaUseCase(factory).execute();
      await vi.advanceTimersByTimeAsync(15_000);
      await pending;
      rejectLate(new Error('connection closed'));
      vi.useRealTimers();
      await new Promise(resolve => setImmediate(resolve));
    } finally {
      process.off('unhandledRejection', record);
    }

    expect(unhandled).toEqual([]);
  });

  it('should disconnect every port after its query, even when it fails', async () => {
    const disconnected: string[] = [];
    const ports: Record<string, StubAgentPort> = {};
    for (const agentId of ['agy', 'copilot', 'codex']) {
      const port = new StubAgentPort();
      port.disconnect = async () => {
        disconnected.push(agentId);
      };
      ports[agentId] = port;
    }
    ports.copilot!.getQuota = async () => {
      throw new Error('boom');
    };

    await new GetAgentQuotaUseCase(buildFactory(ports)).execute();

    expect(disconnected.sort()).toEqual(['agy', 'codex', 'copilot']);
  });

  it('should ignore disconnect failures', async () => {
    const agy = new StubAgentPort();
    agy.quotaToReturn = quota;
    agy.disconnect = async () => {
      throw new Error('already gone');
    };
    const factory = buildFactory({ agy });
    factory.agents = [{ agentId: 'agy', displayName: 'Antigravity' }];

    await expect(new GetAgentQuotaUseCase(factory).execute()).resolves.toEqual([{ agent: { id: 'agy', name: 'Antigravity' }, status: 'ok', quota }]);
  });
});
