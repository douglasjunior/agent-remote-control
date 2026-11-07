import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { ConnectionStatus, IServerConnection } from './server-connection.js';


type ConnectionContextValue = {
  readonly connection: IServerConnection;
  readonly status: ConnectionStatus;
  readonly hasToken: boolean;
  readonly submitToken: (token: string) => void;
};

const ConnectionContext = createContext<ConnectionContextValue | null>(null);

export function ConnectionProvider({ connection, children }: {
  readonly connection: IServerConnection;
  readonly children: ReactNode;
}) {
  const [status, setStatus] = useState<ConnectionStatus>('closed');
  const [hasToken, setHasToken] = useState(() => connection.hasAccessToken());

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
    () => ({ connection, status, hasToken, submitToken }),
    [connection, status, hasToken, submitToken],
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
