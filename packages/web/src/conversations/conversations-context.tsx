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
  /** Opens a new conversation with `prompt` in its composer, for the user to finish and send. */
  readonly startConversation: (prompt: string) => void;
  readonly renameConversation: (conversationId: string, title: string) => void;
  readonly archiveConversation: (conversationId: string, archived: boolean) => void;
};

const ConversationsContext = createContext<ConversationsContextValue | null>(null);

export function ConversationsProvider({ children }: { readonly children: ReactNode }) {
  const { connection, status } = useConnection();
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(conversationsReducer, initialConversationsState);
  const pendingRequests = useRef(new Map<string, string>());

  useEffect(() => connection.onEvent((event) => {
    dispatch(event);
    if (event.type === 'conversation.created' && pendingRequests.current.has(event.requestId)) {
      const prompt = pendingRequests.current.get(event.requestId);
      pendingRequests.current.delete(event.requestId);
      void navigate(`/c/${event.conversation.id}`, prompt ? { state: { prompt } } : undefined);
    }
  }), [connection, navigate]);

  useEffect(() => {
    if (status === 'open') {
      connection.send({ type: 'conversation.list' });
    }
  }, [connection, status]);

  const startConversation = useCallback((prompt: string) => {
    const requestId = crypto.randomUUID();
    pendingRequests.current.set(requestId, prompt);
    connection.send({ type: 'conversation.create', requestId });
  }, [connection]);

  const createConversation = useCallback(() => startConversation(''), [startConversation]);

  const renameConversation = useCallback((conversationId: string, title: string) => {
    connection.send({ type: 'conversation.rename', conversationId, title });
  }, [connection]);

  const archiveConversation = useCallback((conversationId: string, archived: boolean) => {
    connection.send({ type: 'conversation.archive', conversationId, archived });
  }, [connection]);

  const value = useMemo(
    () => ({ state, createConversation, startConversation, renameConversation, archiveConversation }),
    [state, createConversation, startConversation, renameConversation, archiveConversation],
  );
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
