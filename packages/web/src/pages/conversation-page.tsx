import { useEffect, useState } from 'react';
import { useLocation, useMatch, useNavigate, useParams } from 'react-router';

import { ConversationView } from '../components/conversation-view.js';

import { HomePage } from './home-page.js';


export function ConversationPage() {
  const { conversationId, artifactId } = useParams();
  const onBoard = useMatch('/c/:conversationId/tasks/*') !== null;
  const onSquad = useMatch('/c/:conversationId/squad') !== null;
  const location = useLocation();
  const navigate = useNavigate();
  const statePrompt = (location.state as { prompt?: unknown } | null)?.prompt;
  const [initialPrompt] = useState(typeof statePrompt === 'string' ? statePrompt : undefined);

  // The prompt seeds the composer once; dropping it from the history keeps a reload from seeding it again.
  useEffect(() => {
    if (statePrompt !== undefined) {
      void navigate(location.pathname, { replace: true, state: null });
    }
  }, [statePrompt, navigate, location.pathname]);

  if (!conversationId) {
    return <HomePage />;
  }

  const pane = artifactId
    ? { kind: 'artifact', artifactId } as const
    : { kind: onBoard ? 'board' : onSquad ? 'squad' : 'chat' } as const;
  return <ConversationView key={conversationId} conversationId={conversationId} pane={pane} initialPrompt={initialPrompt} />;
}
