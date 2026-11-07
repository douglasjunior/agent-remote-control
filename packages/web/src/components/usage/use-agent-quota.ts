import type { AgentQuotaReport } from '@agent-remote-control/protocol/agent-quota';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useConnection } from '../../connection/connection-context.js';


/** Every query starts the agents' CLIs, so the numbers refresh rarely and only while the tab is visible. */
export const QUOTA_REFRESH_MS = 300_000;

export type AgentQuotaView = {
  readonly reports: readonly AgentQuotaReport[] | null;
  readonly fetchedAt: string | null;
  /** A refresh the user asked for is in progress. */
  readonly refreshing: boolean;
  /** The last query failed; `reports` keeps what the one before it brought. */
  readonly failed: boolean;
  readonly refresh: () => void;
};

export function useAgentQuota(): AgentQuotaView {
  const { connection, status } = useConnection();
  const [snapshot, setSnapshot] = useState<{ reports: readonly AgentQuotaReport[]; fetchedAt: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const fetchedAt = useRef<string | null>(null);

  useEffect(() => connection.onEvent((event) => {
    if (event.type === 'quota.report') {
      fetchedAt.current = event.fetchedAt;
      setSnapshot({ reports: event.reports, fetchedAt: event.fetchedAt });
      setFailed(false);
      setRefreshing(false);
    } else if (event.type === 'quota.failed') {
      setFailed(true);
      setRefreshing(false);
    }
  }), [connection]);

  useEffect(() => {
    if (status !== 'open') {
      return;
    }
    const request = () => connection.send({ type: 'quota.get' });
    const visible = () => document.visibilityState === 'visible';
    const refreshIfStale = () => {
      const age = fetchedAt.current === null ? Infinity : Date.now() - Date.parse(fetchedAt.current);
      if (visible() && age >= QUOTA_REFRESH_MS) {
        request();
      }
    };

    request();
    const timer = setInterval(() => {
      if (visible()) {
        request();
      }
    }, QUOTA_REFRESH_MS);
    document.addEventListener('visibilitychange', refreshIfStale);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshIfStale);
    };
  }, [connection, status]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    connection.send({ type: 'quota.get', refresh: true });
  }, [connection]);

  return {
    reports: snapshot?.reports ?? null,
    fetchedAt: snapshot?.fetchedAt ?? null,
    refreshing: refreshing && status === 'open',
    failed,
    refresh,
  };
}
