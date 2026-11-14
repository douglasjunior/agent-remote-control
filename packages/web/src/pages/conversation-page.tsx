import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation, useMatch, useNavigate, useParams } from 'react-router';

import { ConversationView } from '../components/conversation-view.js';
import { Button } from '../components/ui/button.js';
import { useConversations } from '../conversations/conversations-context.js';


export function ConversationPage() {
  const { conversationId, artifactId } = useParams();
  const onBoard = useMatch('/c/:conversationId/tasks/*') !== null;
  const { createConversation } = useConversations();
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
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
        <p className="text-muted-foreground">Start a conversation to give the agents a task.</p>
        <Button onClick={createConversation}>
          <Plus />
          {' '}
          New conversation
        </Button>
      </div>
    );
  }

  const pane = artifactId ? { kind: 'artifact', artifactId } as const : { kind: onBoard ? 'board' : 'chat' } as const;
  return <ConversationView key={conversationId} conversationId={conversationId} pane={pane} initialPrompt={initialPrompt} />;
}
