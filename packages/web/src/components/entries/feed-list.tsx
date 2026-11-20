import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { ArrowDown } from 'lucide-react';
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ComponentProps, type Ref } from 'react';
import { Virtuoso, type ListRange, type VirtuosoHandle } from 'react-virtuoso';

import { groupEntries, itemId, type EntryItem } from '../../conversations/group-entries.js';
import { openQuestion } from '../../conversations/open-question.js';
import type { TeamMember } from '../../conversations/team-state.js';
import { IconButton } from '../icon-button.js';
import { Button } from '../ui/button.js';

import { FeedItem } from './feed-item.js';
import { Markdown } from './markdown.js';
import type { QuestionAnswer } from './question-card.js';
import { useFirstItemIndex } from './use-first-item-index.js';
import { useStickToEnd } from './use-stick-to-end.js';
import { WaitingLine } from './waiting-line.js';
import { WorkingIndicator } from './working-indicator.js';


/** The earlier entries the history holds beyond the loaded ones. */
export interface EarlierEntries {
  readonly available: boolean;
  readonly loading: boolean;
  readonly load: () => void;
}

const NOTHING_EARLIER: EarlierEntries = { available: false, loading: false, load: () => undefined };

interface FeedContext {
  readonly items: readonly EntryItem[];
  readonly earlier: EarlierEntries;
  readonly draft: string;
  readonly running: boolean;
  readonly working: boolean;
  readonly team: readonly TeamMember[];
  readonly openQuestionId: string | undefined;
  readonly expanded: ReadonlySet<string>;
  readonly focus: string | null;
  readonly onFocus: (role: string) => void;
  readonly onHover: (role: string | null) => void;
  readonly onExpandedChange: (id: string, open: boolean) => void;
  readonly onAnswer: (answer: QuestionAnswer) => void;
  readonly onRetryNow: () => void;
  readonly onStopRetrying: () => void;
}

const COLUMN_CLASSES = 'mx-auto w-full max-w-[680px] px-5';

function FeedRow(props: ComponentProps<'div'>) {
  return <div {...props} className={`${COLUMN_CLASSES} pb-4`} />;
}

function FeedHeader({ context }: { readonly context: FeedContext }) {
  const { available, loading, load } = context.earlier;
  if (!available) {
    return <div className="h-7" />;
  }
  return (
    <div className={`${COLUMN_CLASSES} flex justify-center py-3`}>
      {loading
        ? <p role="status" className="text-[13px] text-muted-foreground">Loading earlier messages…</p>
        : <Button variant="ghost" size="sm" onClick={load}>Load earlier messages</Button>}
    </div>
  );
}

function FeedFooter({ context }: { readonly context: FeedContext }) {
  return (
    <div className={`${COLUMN_CLASSES} pb-4`}>
      {context.draft !== '' && <Markdown text={context.draft} isAnimating />}
      {context.working && <WorkingIndicator members={context.team} />}
    </div>
  );
}

const FEED_COMPONENTS = { Item: FeedRow, Header: FeedHeader, Footer: FeedFooter };

function lastUserMessageId(entries: readonly ConversationEntry[]) {
  return entries.findLast(entry => entry.type === 'user_message')?.id;
}

export interface FeedHandle {
  /** Scrolls to the open question and moves focus to its first control. */
  readonly goToQuestion: () => void;
}

const FOCUSABLE = 'button, input';

export function FeedList({ ref, entries, earlier = NOTHING_EARLIER, team, draft, running, stateAfter, focus, onFocus, onHover, onAnswer, onRetryNow, onStopRetrying }: {
  readonly ref?: Ref<FeedHandle>;
  readonly entries: readonly ConversationEntry[];
  /** Absent for a feed whose history starts with its first entry. */
  readonly earlier?: EarlierEntries;
  readonly team: readonly TeamMember[];
  readonly draft: string;
  readonly running: boolean;
  /** The last entry held when the state was last set: a response after it ended the turn the state still reports. */
  readonly stateAfter?: string;
  readonly focus: string | null;
  readonly onFocus: (role: string) => void;
  readonly onHover: (role: string | null) => void;
  readonly onAnswer: (answer: QuestionAnswer) => void;
  readonly onRetryNow: () => void;
  readonly onStopRetrying: () => void;
}) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const { atEnd, follow, release, scrollToEnd } = useStickToEnd(viewport);
  const virtuoso = useRef<VirtuosoHandle>(null);
  const [range, setRange] = useState<ListRange | null>(null);
  const focusPending = useRef(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const handledUserMessage = useRef<string | undefined>(undefined);

  const items = useMemo(() => groupEntries(entries), [entries]);
  const itemIds = useMemo(() => items.map(itemId), [items]);
  const firstItemIndex = useFirstItemIndex(itemIds);
  const last = entries.at(-1);
  const open = openQuestion(entries);
  const openQuestionId = open?.id;
  const openIndex = items.findIndex(item => item.kind === 'entry' && item.entry.id === openQuestionId);
  const lastIsOpenQuestion = open !== undefined && last?.id === open.id;
  const lastIsOpenRetry = last?.type === 'retry' && !last.closed;
  const lastEndedTurn = last?.type === 'agent_response' && last.id !== stateAfter;
  const working = running && draft === '' && items.at(-1)?.kind !== 'activity' && !lastIsOpenQuestion && !lastIsOpenRetry && !lastEndedTurn;
  const questionOutOfView = open !== undefined && range !== null
    && (openIndex + firstItemIndex < range.startIndex || openIndex + firstItemIndex > range.endIndex);

  const focusQuestion = useCallback(() => {
    const control = viewport?.querySelector(`[data-question-id="${openQuestionId}"]`)?.querySelector<HTMLElement>(FOCUSABLE);
    if (control) {
      control.focus({ preventScroll: true });
      focusPending.current = false;
    }
  }, [viewport, openQuestionId]);

  const goToQuestion = useCallback(() => {
    if (openIndex === -1) {
      return;
    }
    release();
    virtuoso.current?.scrollToIndex({ index: openIndex, align: 'center', behavior: 'smooth' });
    focusPending.current = true;
    focusQuestion();
  }, [openIndex, release, focusQuestion]);
  useImperativeHandle(ref, () => ({ goToQuestion }), [goToQuestion]);

  useEffect(() => {
    if (focusPending.current) {
      focusQuestion();
    }
  }, [range, focusQuestion]);

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
    items, earlier, draft, running, working, team, openQuestionId, expanded, focus, onFocus, onHover, onExpandedChange, onAnswer, onRetryNow, onStopRetrying,
  }), [items, earlier, draft, running, working, team, openQuestionId, expanded, focus, onFocus, onHover, onExpandedChange, onAnswer, onRetryNow, onStopRetrying]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1">
        <div ref={setViewport} data-testid="message-viewport" className="h-full overflow-y-auto">
          {viewport && (
            <Virtuoso
              ref={virtuoso}
              rangeChanged={setRange}
              customScrollParent={viewport}
              firstItemIndex={firstItemIndex}
              startReached={earlier.load}
              data={items}
              context={context}
              components={FEED_COMPONENTS}
              computeItemKey={(_, item) => itemId(item)}
              itemContent={(_, item, ctx) => (
                <FeedItem
                  item={item}
                  activityRunning={ctx.running && ctx.draft === '' && item === ctx.items.at(-1)}
                  running={ctx.running}
                  openQuestionId={ctx.openQuestionId}
                  expanded={ctx.expanded}
                  focus={ctx.focus}
                  onFocus={ctx.onFocus}
                  onHover={ctx.onHover}
                  onExpandedChange={ctx.onExpandedChange}
                  onAnswer={ctx.onAnswer}
                  onRetryNow={ctx.onRetryNow}
                  onStopRetrying={ctx.onStopRetrying}
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
      {questionOutOfView && <WaitingLine question={open} onGo={goToQuestion} />}
    </div>
  );
}
