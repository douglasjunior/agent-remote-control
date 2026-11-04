import { Settings } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useConnection } from '../connection/connection-context.js';
import { useConversations } from '../conversations/conversations-context.js';
import { emptyConversationView } from '../conversations/conversations-reducer.js';

import { Composer } from './composer.js';
import { FeedList } from './entries/feed-list.js';
import type { QuestionAnswer } from './entries/question-card.js';
import { SettingsSheet } from './settings-sheet.js';
import { Button } from './ui/button.js';


export function ConversationView({ conversationId }: { readonly conversationId: string }) {
  const { connection, status } = useConnection();
  const { state } = useConversations();
  const view = state.byId[conversationId] ?? emptyConversationView;
  const title = state.list.find(item => item.id === conversationId)?.title ?? 'Conversation';
  const [settingsRequested, setSettingsRequested] = useState(false);
  const [settingsDismissed, setSettingsDismissed] = useState(false);
  const noAgents = state.agents.length === 0;

  useEffect(() => {
    if (status !== 'open') {
      return;
    }
    connection.send({ type: 'conversation.history', conversationId });
    connection.send({ type: 'profiles.get', conversationId });
  }, [connection, status, conversationId]);

  useEffect(() => {
    if (status === 'open' && noAgents) {
      connection.send({ type: 'agents.list' });
    }
  }, [connection, status, noAgents]);

  const handleAnswer = (answer: QuestionAnswer) => {
    connection.send({ type: 'question.answer', conversationId, answer });
  };

  const needsSettings = view.profilesLoaded && !view.configured && !settingsDismissed;
  const handleSettingsOpenChange = (open: boolean) => {
    setSettingsRequested(open);
    if (!open) {
      setSettingsDismissed(true);
    }
  };

  const running = view.state !== 'idle';
  const entries = view.entryIds.map(id => view.entries[id]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
        <h2 className="min-w-0 truncate text-sm font-medium">{title}</h2>
        <Button variant="outline" size="sm" onClick={() => setSettingsRequested(true)}>
          <Settings />
          {' '}
          Settings
        </Button>
      </div>
      <FeedList key={conversationId} entries={entries} draft={view.draft} running={running} onAnswer={handleAnswer} />
      <Composer
        key={conversationId}
        conversationId={conversationId}
        disabled={status !== 'open' || !view.configured}
        running={running}
        onSend={(text, attachments) => connection.send({
          type: 'message.send',
          conversationId,
          text,
          ...(attachments.length > 0 && { attachments: [...attachments] }),
        })}
        onStop={() => connection.send({ type: 'turn.cancel', conversationId })}
      />
      <SettingsSheet conversationId={conversationId} open={settingsRequested || needsSettings} onOpenChange={handleSettingsOpenChange} />
    </div>
  );
}
