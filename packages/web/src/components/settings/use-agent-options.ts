import type { AgentOption } from '@agent-remote-control/protocol/agent-option';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useConnection } from '../../connection/connection-context.js';


/** `loading` while the server has not answered; the list once it has. */
export type OptionList = readonly AgentOption[] | 'loading';

export type AgentOptions = {
  readonly models: Readonly<Record<string, OptionList>>;
  readonly efforts: Readonly<Record<string, OptionList>>;
  readonly requestModels: (agentId: string) => void;
  readonly requestEfforts: (agentId: string, modelId: string) => void;
};

export const effortKey = (agentId: string, modelId: string) => `${agentId}\n${modelId}`;

/**
 * The models of each agent and the efforts of each model, asked once and kept while the component lives. An error
 * from the server drops the lists still loading, so asking again sends a new request.
 */
export function useAgentOptions(): AgentOptions {
  const { connection } = useConnection();
  const [models, setModels] = useState<Readonly<Record<string, OptionList>>>({});
  const [efforts, setEfforts] = useState<Readonly<Record<string, OptionList>>>({});
  const requested = useRef(new Set<string>());

  useEffect(() => connection.onEvent((event) => {
    if (event.type === 'models.list') {
      setModels(current => ({ ...current, [event.agentId]: event.models }));
    } else if (event.type === 'efforts.list') {
      setEfforts(current => ({ ...current, [effortKey(event.agentId, event.modelId)]: event.efforts }));
    } else if (event.type === 'error') {
      const settled = (lists: Readonly<Record<string, OptionList>>, prefix: string) => Object.fromEntries(
        Object.entries(lists).filter(([key, list]) => {
          if (list === 'loading') {
            requested.current.delete(`${prefix}${key}`);
          }
          return list !== 'loading';
        }),
      );
      setModels(current => settled(current, 'models:'));
      setEfforts(current => settled(current, 'efforts:'));
    }
  }), [connection]);

  const requestModels = useCallback((agentId: string) => {
    if (requested.current.has(`models:${agentId}`)) {
      return;
    }
    requested.current.add(`models:${agentId}`);
    setModels(current => ({ ...current, [agentId]: 'loading' }));
    connection.send({ type: 'models.list', agentId });
  }, [connection]);

  const requestEfforts = useCallback((agentId: string, modelId: string) => {
    const key = effortKey(agentId, modelId);
    if (requested.current.has(`efforts:${key}`)) {
      return;
    }
    requested.current.add(`efforts:${key}`);
    setEfforts(current => ({ ...current, [key]: 'loading' }));
    connection.send({ type: 'efforts.list', agentId, modelId });
  }, [connection]);

  return { models, efforts, requestModels, requestEfforts };
}
