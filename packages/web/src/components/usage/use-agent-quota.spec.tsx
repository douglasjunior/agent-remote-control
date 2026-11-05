import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

import { storeAccessToken } from '../../connection/access-token.js';
import { ConnectionProvider } from '../../connection/connection-context.js';
import { FakeServerConnection } from '../../test/fake-server-connection.js';

import { QUOTA_REFRESH_MS, useAgentQuota } from './use-agent-quota.js';


const NOW = Date.parse('2026-01-01T00:00:00.000Z');
const reports = [{ agent: { id: 'cursor', name: 'Cursor' }, status: 'unsupported' as const }];

describe('useAgentQuota', () => {
  let connection: FakeServerConnection;
  let visibility: DocumentVisibilityState;

  const requests = () => connection.sent.filter(command => command.type === 'quota.get');
  const setVisibility = (state: DocumentVisibilityState) => {
    visibility = state;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
  };
  const renderQuota = () => {
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <ConnectionProvider connection={connection}>{children}</ConnectionProvider>
    );
    const view = renderHook(() => useAgentQuota(), { wrapper });
    act(() => connection.emitStatus('open'));
    return view;
  };

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    localStorage.clear();
    storeAccessToken('token');
    connection = new FakeServerConnection();
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('asks when the connection opens, and again after a reconnection', () => {
    renderQuota();
    expect(requests()).toEqual([{ type: 'quota.get' }]);

    act(() => connection.emitStatus('closed'));
    act(() => connection.emitStatus('open'));
    expect(requests()).toHaveLength(2);
  });

  it('asks nothing before the connection opens', () => {
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <ConnectionProvider connection={connection}>{children}</ConnectionProvider>
    );
    renderHook(() => useAgentQuota(), { wrapper });
    expect(requests()).toEqual([]);
  });

  it('keeps the reported numbers', () => {
    const { result } = renderQuota();
    expect(result.current.reports).toBeNull();

    act(() => connection.emitEvent({ type: 'quota.report', reports, fetchedAt: new Date(NOW).toISOString() }));

    expect(result.current.reports).toEqual(reports);
    expect(result.current.fetchedAt).toBe(new Date(NOW).toISOString());
  });

  it('refreshes on the interval only while the tab is visible', () => {
    renderQuota();
    act(() => void vi.advanceTimersByTime(QUOTA_REFRESH_MS));
    expect(requests()).toHaveLength(2);

    visibility = 'hidden';
    act(() => void vi.advanceTimersByTime(QUOTA_REFRESH_MS));
    expect(requests()).toHaveLength(2);
  });

  it('refreshes on returning to the tab only when the numbers are stale', () => {
    renderQuota();
    act(() => connection.emitEvent({ type: 'quota.report', reports, fetchedAt: new Date(NOW).toISOString() }));

    setVisibility('hidden');
    setVisibility('visible');
    expect(requests()).toHaveLength(1);

    visibility = 'hidden';
    act(() => void vi.advanceTimersByTime(QUOTA_REFRESH_MS));
    setVisibility('hidden');
    expect(requests()).toHaveLength(1);
    setVisibility('visible');
    expect(requests()).toHaveLength(2);
  });

  it('asks again on returning to the tab when nothing arrived yet', () => {
    renderQuota();
    setVisibility('visible');
    expect(requests()).toHaveLength(2);
  });

  it('stops asking when unmounted', () => {
    const { unmount } = renderQuota();
    unmount();
    act(() => void vi.advanceTimersByTime(QUOTA_REFRESH_MS));
    setVisibility('visible');
    expect(requests()).toHaveLength(1);
  });

  it('shows a refresh in progress until its answer arrives', () => {
    const { result } = renderQuota();

    act(() => result.current.refresh());
    expect(connection.sent.at(-1)).toEqual({ type: 'quota.get', refresh: true });
    expect(result.current.refreshing).toBe(true);

    act(() => connection.emitEvent({ type: 'quota.report', reports, fetchedAt: new Date(NOW).toISOString() }));
    expect(result.current.refreshing).toBe(false);
  });

  it('does not show a refresh in progress while the connection is down', () => {
    const { result } = renderQuota();
    act(() => result.current.refresh());

    act(() => connection.emitStatus('closed'));
    expect(result.current.refreshing).toBe(false);
  });

  it('keeps the numbers when a refresh fails and clears the failure with the next report', () => {
    const { result } = renderQuota();
    act(() => connection.emitEvent({ type: 'quota.report', reports, fetchedAt: new Date(NOW).toISOString() }));

    act(() => result.current.refresh());
    act(() => connection.emitEvent({ type: 'quota.failed' }));
    expect(result.current.failed).toBe(true);
    expect(result.current.refreshing).toBe(false);
    expect(result.current.reports).toEqual(reports);

    act(() => connection.emitEvent({ type: 'quota.report', reports, fetchedAt: new Date(NOW).toISOString() }));
    expect(result.current.failed).toBe(false);
  });
});
