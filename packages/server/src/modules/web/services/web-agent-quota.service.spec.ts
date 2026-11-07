import type { AgentQuotaReport } from '../../orchestrator/models/agent-quota-report.model.js';
import { StubAgentTurnPort } from '../../orchestrator/testing/stub-agent-turn.port.js';

import { QUOTA_CACHE_TTL_MS, WebAgentQuotaService } from './web-agent-quota.service.js';


const NOW = new Date('2026-01-01T00:00:00.000Z');
const report = (name: string): AgentQuotaReport => ({ agent: { id: name, name }, status: 'unsupported' });

describe('WebAgentQuotaService', () => {
  let agentTurn: StubAgentTurnPort;
  let service: WebAgentQuotaService;

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    agentTurn = new StubAgentTurnPort();
    agentTurn.quotaReports = [report('first')];
    service = new WebAgentQuotaService(agentTurn);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the reports with the time they were fetched', async () => {
    await expect(service.read()).resolves.toEqual({ reports: [report('first')], fetchedAt: NOW.toISOString() });
  });

  it('reuses the result until it expires', async () => {
    await service.read();
    agentTurn.quotaReports = [report('second')];

    vi.advanceTimersByTime(QUOTA_CACHE_TTL_MS - 1);
    await expect(service.read()).resolves.toMatchObject({ reports: [report('first')], fetchedAt: NOW.toISOString() });

    vi.advanceTimersByTime(1);
    await expect(service.read()).resolves.toMatchObject({ reports: [report('second')] });
  });

  it('queries again on a refresh while the result is still valid', async () => {
    await service.read();
    agentTurn.quotaReports = [report('second')];

    await expect(service.read(true)).resolves.toMatchObject({ reports: [report('second')] });
  });

  it('shares the query in progress, a refresh included', async () => {
    const getQuota = vi.spyOn(agentTurn, 'getQuota');

    const [first, second] = await Promise.all([service.read(), service.read(true)]);

    expect(getQuota).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('does not keep a failure and queries again on the next read', async () => {
    agentTurn.throwOnQuota = true;
    await expect(service.read()).rejects.toThrow('quota down');

    agentTurn.throwOnQuota = false;
    await expect(service.read()).resolves.toMatchObject({ reports: [report('first')] });
  });
});
