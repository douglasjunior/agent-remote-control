import {
  createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode,
} from 'react';
import { useNavigate } from 'react-router';

import { useConnection } from '../connection/connection-context.js';

import {
  conversationsReducer, initialConversationsState, type ConversationsState,
} from './conversations-reducer.js';


type ConversationsContextValue = {
  readonly state: ConversationsState;
  readonly createConversation: () => void;
};

const ConversationsContext = createContext<ConversationsContextValue | null>(null);

export function ConversationsProvider({ children }: { readonly children: ReactNode }) {
  const { connection, status } = useConnection();
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(conversationsReducer, initialConversationsState);
  const pendingRequests = useRef(new Set<string>());

  useEffect(() => connection.onEvent((event) => {
    dispatch(event);
    if (event.type === 'conversation.created' && pendingRequests.current.delete(event.requestId)) {
      void navigate(`/c/${event.conversation.id}`);
    }
  }), [connection, navigate]);

  useEffect(() => {
    if (status === 'open') {
      connection.send({ type: 'conversation.list' });
    }
  }, [connection, status]);

  const createConversation = useCallback(() => {
    const requestId = crypto.randomUUID();
    pendingRequests.current.add(requestId);
    connection.send({ type: 'conversation.create', requestId });
  }, [connection]);

  const value = useMemo(() => ({ state, createConversation }), [state, createConversation]);
  return <ConversationsContext.Provider value={value}>{children}</ConversationsContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useConversations(): ConversationsContextValue {
  const value = useContext(ConversationsContext);
  if (!value) {
    throw new Error('useConversations must be used inside ConversationsProvider');
  }
  return value;
}
