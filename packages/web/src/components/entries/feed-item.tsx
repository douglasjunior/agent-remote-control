import type { EntryItem } from '../../conversations/group-entries.js';
import { cn } from '../../lib/utils.js';
import { AttachmentChip } from '../prompt-input/attachment-chip.js';

import { ActivityGroup } from './activity-group.js';
import { AgentMessage } from './agent-message.js';
import { AgentResponse } from './agent-response.js';
import { SquadCard } from './handoff-card.js';
import { Markdown } from './markdown.js';
import { QuestionCard, type QuestionAnswer } from './question-card.js';


const NOTICE_STYLES = {
  info: 'text-muted-foreground',
  warning: 'text-amber-600',
  error: 'text-destructive',
} as const;

interface FeedItemProps {
  readonly item: EntryItem;
  readonly activityRunning: boolean;
  readonly running: boolean;
  readonly openQuestionId: string | undefined;
  readonly expanded: ReadonlySet<string>;
  /** The role the feed is focused on; items of other agents are dimmed. */
  readonly focus: string | null;
  readonly onFocus: (role: string) => void;
  readonly onHover: (role: string | null) => void;
  readonly onExpandedChange: (id: string, open: boolean) => void;
  readonly onAnswer: (answer: QuestionAnswer) => void;
}

function FeedItemBody({ item, activityRunning, running, openQuestionId, expanded, focus, onFocus, onHover, onExpandedChange, onAnswer }: FeedItemProps) {
  if (item.kind === 'activity') {
    return (
      <ActivityGroup
        steps={item.steps}
        running={activityRunning}
        open={expanded.has(item.id)}
        onOpenChange={open => onExpandedChange(item.id, open)}
      />
    );
  }
  if (item.kind === 'squad') {
    return <SquadCard handoffs={item.handoffs} running={running} focus={focus} expanded={expanded} onExpandedChange={onExpandedChange} onHover={onHover} />;
  }
  const { entry } = item;
  switch (entry.type) {
    case 'user_message':
      return (
        <div className="ml-auto flex w-fit max-w-[82%] flex-col gap-1 rounded-[18px_18px_5px_18px] bg-primary px-[15px] py-2.5 text-sm [overflow-wrap:anywhere] text-primary-foreground">
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
      return <AgentResponse entry={entry} recap={item.recap} onFocus={onFocus} />;
    case 'interim':
      return <AgentMessage role="CEO" onFocus={onFocus}><Markdown text={entry.text} className="text-muted-foreground" /></AgentMessage>;
    case 'question':
      return <QuestionCard entry={entry} active={entry.id === openQuestionId} onAnswer={onAnswer} />;
    case 'notice':
      return <p className={cn('text-xs', NOTICE_STYLES[entry.level])}>{entry.text}</p>;
  }
}

/** The role a feed item belongs to, which decides whether a focus on another agent dims it. User messages and notices belong to nobody. */
function entryAgent(item: Exclude<EntryItem, { kind: 'squad' }>): string | undefined {
  switch (item.kind) {
    case 'activity': return item.steps[0]!.role;
    case 'entry':
      switch (item.entry.type) {
        case 'agent_response':
        case 'interim': return 'CEO';
        case 'question': return item.entry.askerRole;
        default: return undefined;
      }
  }
}

export function FeedItem(props: FeedItemProps) {
  const { item, focus, onHover } = props;
  if (item.kind === 'squad') {
    return <FeedItemBody {...props} />;
  }
  const role = entryAgent(item);
  const dimmed = focus !== null && role !== undefined && role !== focus;
  return (
    <div
      data-dimmed={dimmed}
      onMouseEnter={() => role && onHover(role)}
      onMouseLeave={() => role && onHover(null)}
      className={cn('transition-opacity duration-300', dimmed && 'opacity-30')}
    >
      <FeedItemBody {...props} />
    </div>
  );
}
