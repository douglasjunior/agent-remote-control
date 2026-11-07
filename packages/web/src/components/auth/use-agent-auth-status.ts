import type { AgentAuthInfo, AgentLoginEvent } from '@agent-remote-control/protocol/agent-auth';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useConnection } from '../../connection/connection-context.js';

import { type AgentLoginState, IDLE } from './agent-login-state.js';


/** Every check starts the agents' CLIs, so it runs rarely and only while the tab is visible. */
export const AUTH_REFRESH_MS = 300_000;

export type AgentAuthView = {
  /** `null` until the first check answered. */
  readonly agents: readonly AgentAuthInfo[] | null;
  readonly loginStates: Readonly<Record<string, AgentLoginState>>;
  readonly login: (agentId: string) => void;
  readonly submitCode: (agentId: string, text: string) => void;
  readonly cancel: (agentId: string) => void;
};

function nextLoginState(previous: AgentLoginState, event: AgentLoginEvent): AgentLoginState {
  switch (event.kind) {
    case 'url':
      return previous.kind === 'prompt' || previous.kind === 'verifying'
        ? { ...previous, url: event.url, code: event.code }
        : { kind: 'waiting', url: event.url, code: event.code };
    case 'prompt': {
      const link = previous.kind === 'waiting' || previous.kind === 'verifying' ? previous : undefined;
      return { kind: 'prompt', hint: event.hint, ...(previous.kind === 'verifying' && { rejected: true }), url: link?.url, code: link?.code };
    }
    case 'failed':
      return { kind: 'failed', reason: event.reason };
    case 'completed':
    case 'cancelled':
      return IDLE;
  }
}

export function useAgentAuthStatus(onCompleted?: (agentId: string) => void): AgentAuthView {
  const { connection, status } = useConnection();
  const [agents, setAgents] = useState<readonly AgentAuthInfo[] | null>(null);
  const [loginStates, setLoginStates] = useState<Readonly<Record<string, AgentLoginState>>>({});
  const fetchedAt = useRef<string | null>(null);
  const completed = useRef(onCompleted);

  useEffect(() => {
    completed.current = onCompleted;
  }, [onCompleted]);

  useEffect(() => connection.onEvent((event) => {
    if (event.type === 'auth.status') {
      fetchedAt.current = event.fetchedAt;
      setAgents(event.agents);
    } else if (event.type === 'auth.login') {
      setLoginStates(states => ({
        ...states,
        [event.agentId]: nextLoginState(states[event.agentId] ?? IDLE, event.event),
      }));
      if (event.event.kind === 'completed') {
        completed.current?.(event.agentId);
        connection.send({ type: 'auth.status', refresh: true });
      }
    }
  }), [connection]);

  useEffect(() => {
    if (status !== 'open') {
      return;
    }
    const request = () => connection.send({ type: 'auth.status' });
    const visible = () => document.visibilityState === 'visible';
    const refreshIfStale = () => {
      const age = fetchedAt.current === null ? Infinity : Date.now() - Date.parse(fetchedAt.current);
      if (visible() && age >= AUTH_REFRESH_MS) {
        request();
      }
    };

    request();
    const timer = setInterval(() => {
      if (visible()) {
        request();
      }
    }, AUTH_REFRESH_MS);
    document.addEventListener('visibilitychange', refreshIfStale);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshIfStale);
    };
  }, [connection, status]);

  const login = useCallback((agentId: string) => {
    setLoginStates(states => ({ ...states, [agentId]: { kind: 'starting' } }));
    connection.send({ type: 'auth.login', agentId });
  }, [connection]);

  const submitCode = useCallback((agentId: string, text: string) => {
    setLoginStates((states) => {
      const current = states[agentId];
      return current?.kind === 'prompt'
        ? { ...states, [agentId]: { kind: 'verifying', url: current.url, code: current.code } }
        : states;
    });
    connection.send({ type: 'auth.input', agentId, text });
  }, [connection]);

  const cancel = useCallback((agentId: string) => {
    connection.send({ type: 'auth.cancel', agentId });
  }, [connection]);

  return { agents, loginStates, login, submitCode, cancel };
}
