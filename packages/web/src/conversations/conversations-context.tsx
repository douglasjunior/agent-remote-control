import {
  createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode,
} from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';

import { useConnection } from '../connection/connection-context.js';

import {
  conversationsReducer, initialConversationsState, type ConversationsState,
} from './conversations-reducer.js';


/** The first message of a conversation created for it: sent to the CEO once the squad, when one is chosen, is applied. */
export type FirstMessage = { readonly text: string; readonly squadId?: string };

type PendingStart = { readonly prompt: string } | { readonly message: FirstMessage };

type ConversationsContextValue = {
  readonly state: ConversationsState;
  readonly createConversation: () => void;
  /** Opens a new conversation with `prompt` in its composer, for the user to finish and send. */
  readonly startConversation: (prompt: string) => void;
  /** Creates a conversation, applies its squad, sends the message and opens it. */
  readonly sendInNewConversation: (message: FirstMessage) => void;
  readonly renameConversation: (conversationId: string, title: string) => void;
  readonly archiveConversation: (conversationId: string, archived: boolean) => void;
};

const ConversationsContext = createContext<ConversationsContextValue | null>(null);

export function ConversationsProvider({ children }: { readonly children: ReactNode }) {
  const { connection, status } = useConnection();
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(conversationsReducer, initialConversationsState);
  const pendingRequests = useRef(new Map<string, PendingStart>());
  /** First messages held back until the squad they ask for is applied: the commands of a connection run concurrently. */
  const awaitingSquad = useRef(new Map<string, FirstMessage>());

  useEffect(() => {
    const sendMessage = (conversationId: string, { text }: FirstMessage) => {
      connection.send({ type: 'message.send', conversationId, text });
    };
    const release = (conversationId: string) => {
      const message = awaitingSquad.current.get(conversationId);
      if (message) {
        awaitingSquad.current.delete(conversationId);
        sendMessage(conversationId, message);
      }
    };

    return connection.onEvent((event) => {
      dispatch(event);
      if (event.type === 'conversation.created') {
        const start = pendingRequests.current.get(event.requestId);
        if (!start) {
          return;
        }
        pendingRequests.current.delete(event.requestId);
        const { id } = event.conversation;
        if ('message' in start) {
          if (start.message.squadId === undefined) {
            sendMessage(id, start.message);
          } else {
            awaitingSquad.current.set(id, start.message);
            connection.send({ type: 'squads.apply', conversationId: id, squadId: start.message.squadId });
          }
        }
        void navigate(`/c/${id}`, 'prompt' in start && start.prompt ? { state: { prompt: start.prompt } } : undefined);
      } else if (event.type === 'profiles') {
        const waiting = awaitingSquad.current.get(event.conversationId);
        if (waiting && event.appliedSquad?.id === waiting.squadId) {
          release(event.conversationId);
        }
      } else if (event.type === 'error' && event.conversationId !== undefined && awaitingSquad.current.has(event.conversationId)) {
        toast.error(event.message);
        release(event.conversationId);
      }
    });
  }, [connection, navigate]);

  useEffect(() => {
    if (status === 'open') {
      connection.send({ type: 'conversation.list' });
    }
  }, [connection, status]);

  const startConversation = useCallback((prompt: string) => {
    const requestId = crypto.randomUUID();
    pendingRequests.current.set(requestId, { prompt });
    connection.send({ type: 'conversation.create', requestId });
  }, [connection]);

  const sendInNewConversation = useCallback((message: FirstMessage) => {
    const requestId = crypto.randomUUID();
    pendingRequests.current.set(requestId, { message });
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
    () => ({ state, createConversation, startConversation, sendInNewConversation, renameConversation, archiveConversation }),
    [state, createConversation, startConversation, sendInNewConversation, renameConversation, archiveConversation],
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
