import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';

import { AgentMark } from '../components/agent/agent-mark.js';
import { useAppOutlet } from '../components/app-outlet-context.js';
import { homeFocusRequest } from '../components/home/home-paths.js';
import { RecentConversations } from '../components/home/recent-conversations.js';
import { CUSTOM_SQUAD, resolveSquad } from '../components/home/squad-choice.js';
import { SquadPicker } from '../components/home/squad-picker.js';
import { PromptInput } from '../components/prompt-input/prompt-input.js';
import { usePromptInput } from '../components/prompt-input/use-prompt-input.js';
import { useSquads } from '../components/squads/use-squads.js';
import { useConnection } from '../connection/connection-context.js';
import { useConversations } from '../conversations/conversations-context.js';


/**
 * What `/` shows: a composer that starts a conversation with its first message, the squad that will run it and the
 * conversations to go back to.
 */
export function HomePage() {
  const { status } = useConnection();
  const { sendInNewConversation } = useConversations();
  const { conversationListVisible, showConversations } = useAppOutlet();
  const location = useLocation();
  const squads = useSquads();
  const [choice, setChoice] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [seenStatus, setSeenStatus] = useState(status);
  // A connection that drops may lose the answer to the creation, so the composer must not stay locked.
  if (status !== seenStatus) {
    setSeenStatus(status);
    if (status !== 'open') {
      setStarting(false);
    }
  }
  const squadId = squads === null ? CUSTOM_SQUAD : resolveSquad(squads, choice);
  const input = usePromptInput({
    conversationId: null,
    disabled: status !== 'open' || starting,
    onSubmit: (text) => {
      setStarting(true);
      sendInNewConversation({ text, ...(squadId !== CUSTOM_SQUAD && { squadId }) });
    },
  });
  const focusRequest = homeFocusRequest(location.state);
  const { focus } = input;

  useEffect(() => {
    if (focusRequest !== null) {
      focus();
    }
  }, [focusRequest, focus]);


  return (
    <div className="@container flex h-full overflow-y-auto">
      <div className="m-auto flex w-full max-w-[680px] flex-col gap-8 px-4 py-8 motion-safe:animate-in motion-safe:duration-500 motion-safe:fade-in motion-safe:slide-in-from-bottom-2">
        <div className="flex flex-col items-center gap-3 text-center">
          <span aria-hidden><AgentMark role="CEO" size="lg" /></span>
          <h2 className="font-heading text-2xl font-semibold tracking-tight @md:text-3xl">What should your squad build today?</h2>
        </div>
        <div className="flex flex-col gap-2">
          <div className="rounded-xl shadow-sm">
            <PromptInput
              input={input}
              layout="inline"
              label="Message"
              placeholder="Tell the CEO what you need…"
              submitLabel="Start conversation"
              fieldClassName="min-h-16"
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {squads !== null && squads.length > 0 && <SquadPicker squads={squads} value={squadId} onChange={setChoice} />}
            <p className="text-xs text-muted-foreground @md:ml-auto">Attachments and audio are available once the conversation starts.</p>
          </div>
        </div>
        <RecentConversations onSeeAll={conversationListVisible ? undefined : showConversations} />
      </div>
    </div>
  );
}
