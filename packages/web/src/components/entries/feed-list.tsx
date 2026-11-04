import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { ArrowDown } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { Virtuoso } from 'react-virtuoso';

import { groupEntries, type EntryItem } from '../../conversations/group-entries.js';
import { IconButton } from '../icon-button.js';

import { FeedItem } from './feed-item.js';
import { Markdown } from './markdown.js';
import type { QuestionAnswer } from './question-card.js';
import { useStickToEnd } from './use-stick-to-end.js';
import { WorkingIndicator } from './working-indicator.js';


interface FeedContext {
  readonly items: readonly EntryItem[];
  readonly draft: string;
  readonly running: boolean;
  readonly working: boolean;
  readonly lastQuestionId: string | undefined;
  readonly expanded: ReadonlySet<string>;
  readonly onExpandedChange: (id: string, open: boolean) => void;
  readonly onAnswer: (answer: QuestionAnswer) => void;
}

const COLUMN_CLASSES = 'mx-auto w-full max-w-3xl px-4';

function FeedRow(props: ComponentProps<'div'>) {
  return <div {...props} className={`${COLUMN_CLASSES} pb-4`} />;
}

function FeedHeader() {
  return <div className="h-4" />;
}

function FeedFooter({ context }: { readonly context: FeedContext }) {
  return (
    <div className={`${COLUMN_CLASSES} pb-4`}>
      {context.draft !== '' && <Markdown text={context.draft} isAnimating />}
      {context.working && <WorkingIndicator />}
    </div>
  );
}

const FEED_COMPONENTS = { Item: FeedRow, Header: FeedHeader, Footer: FeedFooter };

function lastUserMessageId(entries: readonly ConversationEntry[]) {
  return entries.findLast(entry => entry.type === 'user_message')?.id;
}

export function FeedList({ entries, draft, running, onAnswer }: {
  readonly entries: readonly ConversationEntry[];
  readonly draft: string;
  readonly running: boolean;
  readonly onAnswer: (answer: QuestionAnswer) => void;
}) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const { atEnd, follow, scrollToEnd } = useStickToEnd(viewport);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const handledUserMessage = useRef<string | undefined>(undefined);

  const items = useMemo(() => groupEntries(entries), [entries]);
  const last = entries.at(-1);
  const lastQuestionId = last?.type === 'question' ? last.id : undefined;
  const working = running && draft === '' && items.at(-1)?.kind !== 'activity' && last?.type !== 'question' && last?.type !== 'agent_response';

  const lastUserId = lastUserMessageId(entries);
  useEffect(() => {
    if (lastUserId && lastUserId !== handledUserMessage.current) {
      handledUserMessage.current = lastUserId;
      follow();
    }
  }, [lastUserId, follow]);

  const onExpandedChange = useCallback((id: string, open: boolean) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (open) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const context = useMemo<FeedContext>(() => ({
    items, draft, running, working, lastQuestionId, expanded, onExpandedChange, onAnswer,
  }), [items, draft, running, working, lastQuestionId, expanded, onExpandedChange, onAnswer]);

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={setViewport} data-testid="message-viewport" className="h-full overflow-y-auto">
        {viewport && (
          <Virtuoso
            customScrollParent={viewport}
            data={items}
            context={context}
            components={FEED_COMPONENTS}
            computeItemKey={(_, item) => (item.kind === 'activity' ? item.id : item.entry.id)}
            itemContent={(index, item, ctx) => (
              <FeedItem
                item={item}
                activityRunning={ctx.running && ctx.draft === '' && index === ctx.items.length - 1}
                lastQuestionId={ctx.lastQuestionId}
                expanded={ctx.expanded.has(item.kind === 'activity' ? item.id : item.entry.id)}
                onExpandedChange={ctx.onExpandedChange}
                onAnswer={ctx.onAnswer}
              />
            )}
          />
        )}
      </div>
      {!atEnd && (
        <IconButton
          label="Scroll to bottom"
          variant="outline"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-background/90 shadow-md backdrop-blur-sm animate-in fade-in zoom-in-90"
          onClick={() => {
            follow();
            scrollToEnd('smooth');
          }}
        >
          <ArrowDown aria-hidden />
        </IconButton>
      )}
    </div>
  );
}
