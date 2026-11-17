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
    rs.useFakeTimers({ now: NOW });
    localStorage.clear();
    connection = new FakeServerConnection();
    visibility = 'visible';
    rs.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  });

  afterEach(() => {
    rs.useRealTimers();
    rs.restoreAllMocks();
  });

  it('should ask when the connection opens, and again after a reconnection', () => {
    renderAuth();
    expect(requests()).toEqual([{ type: 'auth.status' }]);

    act(() => connection.emitStatus('closed'));
    act(() => connection.emitStatus('open'));
    expect(requests()).toHaveLength(2);
  });

  it('should ask nothing before the connection opens', () => {
    renderAuth(undefined, false);
    expect(requests()).toEqual([]);
  });

  it('should keep the agents the server reports', () => {
    const { result } = renderAuth();
    expect(result.current.agents).toBeNull();

    emitStatus();

    expect(result.current.agents).toEqual(agents);
  });

  it('should ask every five minutes while the tab is visible', () => {
    renderAuth();

    act(() => rs.advanceTimersByTime(AUTH_REFRESH_MS));
    expect(requests()).toHaveLength(2);
  });

  it('should skip the timer while the tab is hidden', () => {
    renderAuth();
    visibility = 'hidden';

    act(() => rs.advanceTimersByTime(AUTH_REFRESH_MS));

    expect(requests()).toHaveLength(1);
  });

  it('should ask again when the tab becomes visible with a stale or missing answer', () => {
    renderAuth();
    setVisibility('hidden');
    setVisibility('visible');
    expect(requests()).toHaveLength(2);

    emitStatus(new Date(Date.now()).toISOString());
    setVisibility('hidden');
    setVisibility('visible');
    expect(requests()).toHaveLength(2);

    act(() => rs.advanceTimersByTime(AUTH_REFRESH_MS - 1));
    setVisibility('hidden');
    act(() => rs.advanceTimersByTime(1));
    setVisibility('visible');
    expect(requests()).toHaveLength(3);
  });

  it('should stop asking once unmounted', () => {
    const { unmount } = renderAuth();
    unmount();

    act(() => rs.advanceTimersByTime(AUTH_REFRESH_MS));

    expect(requests()).toHaveLength(1);
  });

  it('should ignore a failed check and keep the last answer', () => {
    const { result } = renderAuth();
    emitStatus();

    act(() => connection.emitEvent({ type: 'auth.status.failed' }));

    expect(result.current.agents).toEqual(agents);
  });

  describe('login', () => {
    it('should send the login and show it as starting', () => {
      const { result } = renderAuth();

      act(() => result.current.login('claude'));

      expect(connection.sent).toContainEqual({ type: 'auth.login', agentId: 'claude' });
      expect(result.current.loginStates.claude).toEqual({ kind: 'starting' });
    });

    it('should follow the link, the prompt and a repeated link', () => {
      const { result } = renderAuth();

      emitLogin({ type: 'auth.login', agentId: 'claude', event: { kind: 'url', url: 'https://a.example/x' } });
      expect(result.current.loginStates.claude).toEqual({ kind: 'waiting', url: 'https://a.example/x', code: undefined });

      emitLogin({ type: 'auth.login', agentId: 'claude', event: { kind: 'prompt', hint: 'Paste >' } });
      expect(result.current.loginStates.claude).toEqual({ kind: 'prompt', hint: 'Paste >', url: 'https://a.example/x', code: undefined });

      emitLogin({ type: 'auth.login', agentId: 'claude', event: { kind: 'url', url: 'https://a.example/y', code: 'AB12-CD34' } });
      expect(result.current.loginStates.claude).toEqual({ kind: 'prompt', hint: 'Paste >', url: 'https://a.example/y', code: 'AB12-CD34' });
    });

    it('should show a prompt that arrives before any link', () => {
      const { result } = renderAuth();

      emitLogin({ type: 'auth.login', agentId: 'claude', event: { kind: 'prompt', hint: 'Paste >' } });

      expect(result.current.loginStates.claude).toEqual({ kind: 'prompt', hint: 'Paste >', url: undefined, code: undefined });
    });

    it('should keep the reason a login failed', () => {
      const { result } = renderAuth();

      emitLogin({ type: 'auth.login', agentId: 'claude', event: { kind: 'failed', reason: 'Invalid code.' } });

      expect(result.current.loginStates.claude).toEqual({ kind: 'failed', reason: 'Invalid code.' });
    });

    it('should return to idle when the login is cancelled', () => {
      const { result } = renderAuth();
      emitLogin({ type: 'auth.login', agentId: 'claude', event: { kind: 'url', url: 'https://a.example/x' } });

      emitLogin({ type: 'auth.login', agentId: 'claude', event: { kind: 'cancelled' } });

      expect(result.current.loginStates.claude).toEqual({ kind: 'idle' });
    });

    it('should report a completed login, refresh the state and return to idle', () => {
      const onCompleted = rs.fn();
      const { result } = renderAuth(onCompleted);

      emitLogin({ type: 'auth.login', agentId: 'claude', event: { kind: 'completed' } });

      expect(onCompleted).toHaveBeenCalledWith('claude');
      expect(connection.sent).toContainEqual({ type: 'auth.status', refresh: true });
      expect(result.current.loginStates.claude).toEqual({ kind: 'idle' });
    });

    it('should complete without a listener', () => {
      renderAuth();

      expect(() => emitLogin({ type: 'auth.login', agentId: 'claude', event: { kind: 'completed' } })).not.toThrow();
    });

    it('should send a pasted code and a cancellation', () => {
      const { result } = renderAuth();

      act(() => result.current.submitCode('claude', 'abc#def'));
      act(() => result.current.cancel('claude'));

      expect(connection.sent).toContainEqual({ type: 'auth.input', agentId: 'claude', text: 'abc#def' });
      expect(connection.sent).toContainEqual({ type: 'auth.cancel', agentId: 'claude' });
    });
  });
});
