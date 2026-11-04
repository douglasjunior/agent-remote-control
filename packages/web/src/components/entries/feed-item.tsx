import type { EntryItem } from '../../conversations/group-entries.js';
import { cn } from '../../lib/utils.js';
import { AttachmentChip } from '../prompt-input/attachment-chip.js';

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

export function FeedItem({ item, activityRunning, lastQuestionId, expanded, onExpandedChange, onAnswer }: {
  readonly item: EntryItem;
  readonly activityRunning: boolean;
  readonly lastQuestionId: string | undefined;
  readonly expanded: boolean;
  readonly onExpandedChange: (id: string, open: boolean) => void;
  readonly onAnswer: (answer: QuestionAnswer) => void;
}) {
  if (item.kind === 'activity') {
    return (
      <ActivityGroup
        steps={item.steps}
        running={activityRunning}
        open={expanded}
        onOpenChange={open => onExpandedChange(item.id, open)}
      />
    );
  }
  const { entry } = item;
  switch (entry.type) {
    case 'user_message':
      return (
        <div className="ml-auto flex max-w-[85%] flex-col gap-1 rounded-2xl bg-primary px-4 py-2 text-sm text-primary-foreground">
          {entry.text !== '' && <p className="whitespace-pre-wrap">{entry.text}</p>}
          {entry.attachments && (
            <ul aria-label="Attachments" className="flex flex-wrap gap-1">
              {entry.attachments.map(attachment => (
                <AttachmentChip key={attachment.path} name={attachment.name} className="border-primary-foreground/30 bg-primary-foreground/15 text-primary-foreground" />
              ))}
            </ul>
          )}
        </div>
      );
    case 'agent_response':
      return <AgentResponse entry={entry} />;
    case 'interim':
      return <Markdown text={entry.text} className="text-muted-foreground" />;
    case 'delegation':
      return <DelegationCard entry={entry} open={expanded} onOpenChange={open => onExpandedChange(entry.id, open)} />;
    case 'question':
      return <QuestionCard entry={entry} active={entry.id === lastQuestionId} onAnswer={onAnswer} />;
    case 'notice':
      return <p className={cn('text-xs', NOTICE_STYLES[entry.level])}>{entry.text}</p>;
  }
}
