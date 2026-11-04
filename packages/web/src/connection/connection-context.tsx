import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { loadAccessToken, storeAccessToken } from './access-token.js';
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
  const [hasToken, setHasToken] = useState(() => loadAccessToken() !== null);

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
    storeAccessToken(token.trim());
    setHasToken(true);
  }, []);

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
