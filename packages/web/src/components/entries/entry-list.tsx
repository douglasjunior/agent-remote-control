import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';

import { groupEntries } from '../../conversations/group-entries.js';
import { cn } from '../../lib/utils.js';

import { ActivityGroup } from './activity-group.js';
import { AgentResponse } from './agent-response.js';
import { DelegationCard } from './delegation-card.js';
import { Markdown } from './markdown.js';
import { QuestionCard, type QuestionAnswer } from './question-card.js';


const NOTICE_STYLES = {
  info: 'text-muted-foreground',
  warning: 'text-amber-600',
  error: 'text-destructive',
} as const;

export function EntryList({ entries, running, onAnswer }: {
  readonly entries: readonly ConversationEntry[];
  readonly running: boolean;
  readonly onAnswer: (answer: QuestionAnswer) => void;
}) {
  const items = groupEntries(entries);
  const lastQuestionId = entries.findLast(entry => entry.type === 'question')?.id;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      {items.map((item, index) => {
        if (item.kind === 'activity') {
          return <ActivityGroup key={item.id} steps={item.steps} running={running && index === items.length - 1} />;
        }
        const { entry } = item;
        switch (entry.type) {
          case 'user_message':
            return (
              <div key={entry.id} className="max-w-[85%] self-end whitespace-pre-wrap rounded-2xl bg-primary px-4 py-2 text-sm text-primary-foreground">
                {entry.text}
              </div>
            );
          case 'agent_response':
            return <AgentResponse key={entry.id} entry={entry} />;
          case 'interim':
            return <Markdown key={entry.id} text={entry.text} className="text-muted-foreground" />;
          case 'delegation':
            return <DelegationCard key={entry.id} entry={entry} />;
          case 'question':
            return <QuestionCard key={entry.id} entry={entry} active={entry.id === lastQuestionId} onAnswer={onAnswer} />;
          case 'notice':
            return <p key={entry.id} className={cn('text-xs', NOTICE_STYLES[entry.level])}>{entry.text}</p>;
        }
      })}
    </div>
  );
}
