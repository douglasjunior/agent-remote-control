import type { ArtifactCreateInput, ArtifactUpdateInput } from '@agent-remote-control/protocol/artifact';
import type { ClientCommand } from '@agent-remote-control/protocol/client-command';
import {
  createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode,
} from 'react';
import { toast } from 'sonner';

import { useConnection } from '../connection/connection-context.js';

import { artifactsReducer, initialArtifactsState, type ArtifactsState } from './artifacts-reducer.js';


export type MutationResult = { readonly ok: true; readonly id: string } | { readonly ok: false; readonly error: string };

type ArtifactsContextValue = {
  readonly state: ArtifactsState;
  readonly createArtifact: (conversationId: string, artifact: ArtifactCreateInput) => Promise<MutationResult>;
  readonly updateArtifact: (conversationId: string, id: string, changes: ArtifactUpdateInput) => Promise<MutationResult>;
  readonly commentArtifact: (conversationId: string, id: string, text: string) => Promise<MutationResult>;
  readonly deleteArtifact: (conversationId: string, id: string) => Promise<MutationResult>;
};

type Mutation = Extract<ClientCommand, { requestId: string }> & { type: `artifact.${string}` };
type MutationCommand = Mutation extends infer M ? (M extends Mutation ? Omit<M, 'requestId'> : never) : never;

const CONNECTION_LOST = 'The connection to the server was lost.';

const ArtifactsContext = createContext<ArtifactsContextValue | null>(null);

/** The boards of the conversations opened so far, and the commands that change them. */
export function ArtifactsProvider({ children }: { readonly children: ReactNode }) {
  const { connection, status } = useConnection();
  const [state, dispatch] = useReducer(artifactsReducer, initialArtifactsState);
  const pending = useRef(new Map<string, (result: MutationResult) => void>());

  useEffect(() => connection.onEvent((event) => {
    dispatch(event);
    if (event.type !== 'artifact.result') {
      return;
    }
    const settle = pending.current.get(event.requestId);
    pending.current.delete(event.requestId);
    settle?.(event.ok ? { ok: true, id: event.id } : { ok: false, error: event.error });
  }), [connection]);

  useEffect(() => {
    if (status === 'open') {
      connection.send({ type: 'projects.list' });
      return;
    }
    for (const settle of pending.current.values()) {
      settle({ ok: false, error: CONNECTION_LOST });
    }
    pending.current.clear();
  }, [connection, status]);

  const mutate = useCallback((command: MutationCommand) => new Promise<MutationResult>((resolve) => {
    const requestId = crypto.randomUUID();
    pending.current.set(requestId, (result) => {
      if (!result.ok) {
        toast.error(result.error);
      }
      resolve(result);
    });
    connection.send({ ...command, requestId } as ClientCommand);
  }), [connection]);

  const value = useMemo<ArtifactsContextValue>(() => ({
    state,
    createArtifact: (conversationId, artifact) => mutate({ type: 'artifact.create', conversationId, artifact }),
    updateArtifact: (conversationId, id, changes) => mutate({ type: 'artifact.update', conversationId, id, changes }),
    commentArtifact: (conversationId, id, text) => mutate({ type: 'artifact.comment', conversationId, id, text }),
    deleteArtifact: (conversationId, id) => mutate({ type: 'artifact.delete', conversationId, id }),
  }), [state, mutate]);

  return <ArtifactsContext.Provider value={value}>{children}</ArtifactsContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useArtifacts(): ArtifactsContextValue {
  const value = useContext(ArtifactsContext);
  if (!value) {
    throw new Error('useArtifacts must be used inside ArtifactsProvider');
  }
  return value;
}
