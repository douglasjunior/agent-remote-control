import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { ConnectionStatus, ConnectionTransport, IServerConnection } from './server-connection.js';


/** What a message may attach, as the server last said; `null` until it says, and then the server alone checks. */
export type UploadLimits = { readonly maxBytes: number; readonly maxAttachments: number };


type ConnectionContextValue = {
  readonly connection: IServerConnection;
  readonly status: ConnectionStatus;
  readonly transport: ConnectionTransport;
  readonly hasToken: boolean;
  readonly uploadLimits: UploadLimits | null;
  readonly submitToken: (token: string) => void;
};

const ConnectionContext = createContext<ConnectionContextValue | null>(null);

export function ConnectionProvider({ connection, children }: {
  readonly connection: IServerConnection;
  readonly children: ReactNode;
}) {
  const [status, setStatus] = useState<ConnectionStatus>('closed');
  const [transport, setTransport] = useState(() => connection.transport);
  const [hasToken, setHasToken] = useState(() => connection.hasAccessToken());
  const [uploadLimits, setUploadLimits] = useState<UploadLimits | null>(null);

  useEffect(() => connection.onTransport(setTransport), [connection]);

  useEffect(() => connection.onEvent((event) => {
    if (event.type === 'upload.limits') {
      setUploadLimits({ maxBytes: event.maxBytes, maxAttachments: event.maxAttachments });
    }
  }), [connection]);

  useEffect(() => {
    const unsubscribe = connection.onStatus((next) => {
      setStatus(next);
      if (next === 'unauthorized') {
        setHasToken(false);
      }
    });
    if (hasToken) {
      connection.connect();
    }
    return () => {
      unsubscribe();
      connection.disconnect();
    };
  }, [connection, hasToken]);

  const submitToken = useCallback((token: string) => {
    connection.setAccessToken(token.trim());
    setHasToken(true);
  }, [connection]);

  const value = useMemo(
    () => ({ connection, status, transport, hasToken, uploadLimits, submitToken }),
    [connection, status, transport, hasToken, uploadLimits, submitToken],
  );
  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useConnection(): ConnectionContextValue {
  const value = useContext(ConnectionContext);
  if (!value) {
    throw new Error('useConnection must be used inside ConnectionProvider');
  }
  return value;
}
