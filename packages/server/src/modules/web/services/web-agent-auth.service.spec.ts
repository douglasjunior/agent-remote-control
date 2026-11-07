import { Logger } from '@nestjs/common';

import { StubAgentAuthPort } from '../../agent/testing/stub-agent-auth.port.js';
import { FakeClientConnection } from '../testing/fake-client-connection.js';

import { AUTH_STATUS_CACHE_TTL_MS, WebAgentAuthService } from './web-agent-auth.service.js';
import { WebConnectionRegistryService } from './web-connection-registry.service.js';


const NOW = new Date('2026-01-01T00:00:00.000Z');
const info = (status: 'authenticated' | 'unauthenticated') => ({
  agentId: 'claude',
  displayName: 'Claude Code',
  status,
});

describe('WebAgentAuthService', () => {
  let agentAuth: StubAgentAuthPort;
  let registry: WebConnectionRegistryService;
  let requester: FakeClientConnection;
  let other: FakeClientConnection;
  let service: WebAgentAuthService;

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    agentAuth = new StubAgentAuthPort();
    agentAuth.infos = [info('unauthenticated')];
    registry = new WebConnectionRegistryService();
    requester = new FakeClientConnection('requester');
    other = new FakeClientConnection('other');
    registry.register(requester);
    registry.register(other);
    service = new WebAgentAuthService(agentAuth, registry);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('read', () => {
    it('returns the agents with the time they were fetched', async () => {
      await expect(service.read()).resolves.toEqual({
        agents: [info('unauthenticated')],
        fetchedAt: NOW.toISOString(),
      });
    });

    it('reuses the result until it expires', async () => {
      await service.read();
      agentAuth.infos = [info('authenticated')];

      vi.advanceTimersByTime(AUTH_STATUS_CACHE_TTL_MS - 1);
      await expect(service.read()).resolves.toMatchObject({ agents: [info('unauthenticated')] });

      vi.advanceTimersByTime(1);
      await expect(service.read()).resolves.toMatchObject({ agents: [info('authenticated')] });
    });

    it('queries again on a refresh while the result is still valid', async () => {
      await service.read();
      agentAuth.infos = [info('authenticated')];

      await expect(service.read(true)).resolves.toMatchObject({ agents: [info('authenticated')] });
    });

    it('shares the query in progress', async () => {
      const list = vi.spyOn(agentAuth, 'listAuthInfo');

      const [first, second] = await Promise.all([service.read(), service.read(true)]);

      expect(list).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
    });

    it('does not keep a failure', async () => {
      agentAuth.statusError = new Error('probe down');
      await expect(service.read()).rejects.toThrow('probe down');

      agentAuth.statusError = null;
      await expect(service.read()).resolves.toMatchObject({ agents: [info('unauthenticated')] });
    });
  });

  describe('login', () => {
    it('starts the login of the agent', () => {
      service.login(requester, 'claude');

      expect(agentAuth.started).toEqual(['claude']);
    });

    it('sends every progress event to every open connection', () => {
      service.login(requester, 'claude');

      agentAuth.emit('claude', { kind: 'url', url: 'https://claude.com/oauth' });
      agentAuth.emit('claude', { kind: 'prompt', hint: 'Paste code here >' });

      for (const connection of [requester, other]) {
        expect(connection.sent).toEqual([
          { type: 'auth.login', agentId: 'claude', event: { kind: 'url', url: 'https://claude.com/oauth' } },
          { type: 'auth.login', agentId: 'claude', event: { kind: 'prompt', hint: 'Paste code here >' } },
        ]);
      }
    });

    it('publishes the new state to every connection once a login completed', async () => {
      await service.read();
      agentAuth.infos = [info('authenticated')];
      service.login(requester, 'claude');

      agentAuth.emit('claude', { kind: 'completed' });
      await vi.advanceTimersByTimeAsync(0);

      for (const connection of [requester, other]) {
        expect(connection.sent.at(-1)).toEqual({
          type: 'auth.status',
          agents: [info('authenticated')],
          fetchedAt: NOW.toISOString(),
        });
      }
    });

    it('does not publish a state after a login that failed', async () => {
      service.login(requester, 'claude');

      agentAuth.emit('claude', { kind: 'failed', reason: 'Invalid code.' });
      await vi.advanceTimersByTimeAsync(0);

      expect(requester.sent).toEqual([{ type: 'auth.login', agentId: 'claude', event: { kind: 'failed', reason: 'Invalid code.' } }]);
    });

    it('keeps quiet about a state that cannot be read after a completed login', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      service.login(requester, 'claude');
      agentAuth.statusError = new Error('probe down');

      agentAuth.emit('claude', { kind: 'completed' });
      await vi.advanceTimersByTimeAsync(0);

      expect(warn).toHaveBeenCalledWith('auth_status_failed: probe down');
      expect(requester.sent.map(event => event.type)).toEqual(['auth.login']);
    });

    it('tells only the requester when the login cannot start', () => {
      agentAuth.startError = new Error('Agent authentication is disabled.');

      service.login(requester, 'claude');

      expect(requester.sent).toEqual([
        {
          type: 'auth.login',
          agentId: 'claude',
          event: { kind: 'failed', reason: 'Agent authentication is disabled.' },
        },
      ]);
      expect(other.sent).toEqual([]);
    });

    it('reports a generic reason for a start failure that is not an error', () => {
      agentAuth.startError = 'boom' as unknown as Error;

      service.login(requester, 'claude');

      expect(requester.sent).toEqual([{ type: 'auth.login', agentId: 'claude', event: { kind: 'failed', reason: 'The login could not start.' } }]);
    });
  });

  describe('input and cancel', () => {
    it('passes a pasted code to the login and says whether it was accepted', () => {
      expect(service.submitInput('claude', 'abc#def')).toBe(true);
      agentAuth.inputAccepted = false;
      expect(service.submitInput('claude', 'abc#def')).toBe(false);
      expect(agentAuth.inputs).toEqual([
        { agentId: 'claude', text: 'abc#def' },
        { agentId: 'claude', text: 'abc#def' },
      ]);
    });

    it('cancels the login of the agent', () => {
      service.cancel('claude');

      expect(agentAuth.cancelled).toEqual(['claude']);
    });
  });
});
