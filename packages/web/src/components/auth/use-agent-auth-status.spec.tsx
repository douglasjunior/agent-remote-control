import type { ServerEvent } from '@agent-remote-control/protocol/server-event';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

import { ConnectionProvider } from '../../connection/connection-context.js';
import { FakeServerConnection } from '../../test/fake-server-connection.js';

import { AUTH_REFRESH_MS, useAgentAuthStatus } from './use-agent-auth-status.js';


const NOW = Date.parse('2026-01-01T00:00:00.000Z');
const agents = [{ agentId: 'claude', displayName: 'Claude Code', status: 'unauthenticated' as const }];

describe('useAgentAuthStatus', () => {
  let connection: FakeServerConnection;
  let visibility: DocumentVisibilityState;

  const requests = () => connection.sent.filter(command => command.type === 'auth.status');
  const setVisibility = (state: DocumentVisibilityState) => {
    visibility = state;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
  };
  const emitStatus = (fetchedAt = new Date(NOW).toISOString()) =>
    act(() => connection.emitEvent({ type: 'auth.status', agents, fetchedAt }));
  const emitLogin = (event: Extract<ServerEvent, { type: 'auth.login' }>) =>
    act(() => connection.emitEvent(event));
  const renderAuth = (onCompleted?: (agentId: string) => void, open = true) => {
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <ConnectionProvider connection={connection}>{children}</ConnectionProvider>
    );
    const view = renderHook(() => useAgentAuthStatus(onCompleted), { wrapper });
    if (open) {
      act(() => connection.emitStatus('open'));
    }
    return view;
  };

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    localStorage.clear();
    connection = new FakeServerConnection();
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('asks when the connection opens, and again after a reconnection', () => {
    renderAuth();
    expect(requests()).toEqual([{ type: 'auth.status' }]);

    act(() => connection.emitStatus('closed'));
    act(() => connection.emitStatus('open'));
    expect(requests()).toHaveLength(2);
  });

  it('asks nothing before the connection opens', () => {
    renderAuth(undefined, false);
    expect(requests()).toEqual([]);
  });

  it('keeps the agents the server reports', () => {
    const { result } = renderAuth();
    expect(result.current.agents).toBeNull();

    emitStatus();

    expect(result.current.agents).toEqual(agents);
  });

  it('asks every five minutes while the tab is visible', () => {
    renderAuth();

    act(() => vi.advanceTimersByTime(AUTH_REFRESH_MS));
    expect(requests()).toHaveLength(2);
  });

  it('skips the timer while the tab is hidden', () => {
    renderAuth();
    visibility = 'hidden';

    act(() => vi.advanceTimersByTime(AUTH_REFRESH_MS));

    expect(requests()).toHaveLength(1);
  });

  it('asks again when the tab becomes visible with a stale or missing answer', () => {
    renderAuth();
    setVisibility('hidden');
    setVisibility('visible');
    expect(requests()).toHaveLength(2);

    emitStatus(new Date(Date.now()).toISOString());
    setVisibility('hidden');
    setVisibility('visible');
    expect(requests()).toHaveLength(2);

    act(() => vi.advanceTimersByTime(AUTH_REFRESH_MS - 1));
    setVisibility('hidden');
    act(() => vi.advanceTimersByTime(1));
    setVisibility('visible');
    expect(requests()).toHaveLength(3);
  });

  it('stops asking once unmounted', () => {
    const { unmount } = renderAuth();
    unmount();

    act(() => vi.advanceTimersByTime(AUTH_REFRESH_MS));

    expect(requests()).toHaveLength(1);
  });

  it('ignores a failed check and keeps the last answer', () => {
    const { result } = renderAuth();
    emitStatus();

    act(() => connection.emitEvent({ type: 'auth.status.failed' }));

    expect(result.current.agents).toEqual(agents);
  });

  describe('login', () => {
    it('sends the login and shows it as starting', () => {
      const { result } = renderAuth();

      act(() => result.current.login('claude'));

      expect(connection.sent).toContainEqual({ type: 'auth.login', agentId: 'claude' });
      expect(result.current.loginStates.claude).toEqual({ kind: 'starting' });
    });

    it('follows the link, the prompt and a repeated link', () => {
      const { result } = renderAuth();

      emitLogin({ type: 'auth.login', agentId: 'claude', event: { kind: 'url', url: 'https://a.example/x' } });
      expect(result.current.loginStates.claude).toEqual({ kind: 'waiting', url: 'https://a.example/x', code: undefined });

      emitLogin({ type: 'auth.login', agentId: 'claude', event: { kind: 'prompt', hint: 'Paste >' } });
      expect(result.current.loginStates.claude).toEqual({ kind: 'prompt', hint: 'Paste >', url: 'https://a.example/x', code: undefined });

      emitLogin({ type: 'auth.login', agentId: 'claude', event: { kind: 'url', url: 'https://a.example/y', code: 'AB12-CD34' } });
      expect(result.current.loginStates.claude).toEqual({ kind: 'prompt', hint: 'Paste >', url: 'https://a.example/y', code: 'AB12-CD34' });
    });

    it('shows a prompt that arrives before any link', () => {
      const { result } = renderAuth();

      emitLogin({ type: 'auth.login', agentId: 'claude', event: { kind: 'prompt', hint: 'Paste >' } });

      expect(result.current.loginStates.claude).toEqual({ kind: 'prompt', hint: 'Paste >', url: undefined, code: undefined });
    });

    it('keeps the reason a login failed', () => {
      const { result } = renderAuth();

      emitLogin({ type: 'auth.login', agentId: 'claude', event: { kind: 'failed', reason: 'Invalid code.' } });

      expect(result.current.loginStates.claude).toEqual({ kind: 'failed', reason: 'Invalid code.' });
    });

    it('returns to idle when the login is cancelled', () => {
      const { result } = renderAuth();
      emitLogin({ type: 'auth.login', agentId: 'claude', event: { kind: 'url', url: 'https://a.example/x' } });

      emitLogin({ type: 'auth.login', agentId: 'claude', event: { kind: 'cancelled' } });

      expect(result.current.loginStates.claude).toEqual({ kind: 'idle' });
    });

    it('reports a completed login, refreshes the state and returns to idle', () => {
      const onCompleted = vi.fn();
      const { result } = renderAuth(onCompleted);

      emitLogin({ type: 'auth.login', agentId: 'claude', event: { kind: 'completed' } });

      expect(onCompleted).toHaveBeenCalledWith('claude');
      expect(connection.sent).toContainEqual({ type: 'auth.status', refresh: true });
      expect(result.current.loginStates.claude).toEqual({ kind: 'idle' });
    });

    it('completes without a listener', () => {
      renderAuth();

      expect(() => emitLogin({ type: 'auth.login', agentId: 'claude', event: { kind: 'completed' } })).not.toThrow();
    });

    it('sends a pasted code and a cancellation', () => {
      const { result } = renderAuth();

      act(() => result.current.submitCode('claude', 'abc#def'));
      act(() => result.current.cancel('claude'));

      expect(connection.sent).toContainEqual({ type: 'auth.input', agentId: 'claude', text: 'abc#def' });
      expect(connection.sent).toContainEqual({ type: 'auth.cancel', agentId: 'claude' });
    });
  });
});
