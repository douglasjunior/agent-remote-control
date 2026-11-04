import type { FocusEvent, KeyboardEvent, SyntheticEvent } from 'react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import type { IServerConnection } from '../../connection/server-connection.js';

import { findMentionAtCursor, formatMention } from './mention-token.js';


export const MENTION_DEBOUNCE_MS = 200;

export type MentionItem = {
  readonly path: string;
  readonly kind: 'file' | 'directory';
  /** Indexes of the characters of `path` matched by the query. */
  readonly matches: readonly number[];
};

type FileMentionsInput = {
  readonly connection: IServerConnection;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  /** Moves the caret to `offset` once the new text reaches the field. */
  readonly placeCaret: (offset: number) => void;
};

/** The text and caret as the field reported them in the same event. */
type TrackedCursor = { readonly value: string; readonly cursor: number };

type FieldEvent = SyntheticEvent<HTMLTextAreaElement>;

/**
 * The workspace file list opened by `@`, which replaces the mention under the caret with the chosen
 * path. "Open" is derived from text, caret, focus and results on every render, so the list reopens
 * when the caret returns to a mention and closes when the `@` is deleted. The only state of its own
 * is the `Esc` dismissal, kept by the start of the dismissed token until the caret leaves every mention.
 */
export function useFileMentions({ connection, value, onValueChange, placeCaret }: FileMentionsInput) {
  const listboxId = useId();
  const [tracked, setTracked] = useState<TrackedCursor>({ value, cursor: value.length });
  const [isFocused, setIsFocused] = useState(false);
  const [highlight, setHighlight] = useState({ query: '', index: 0 });
  const [dismissedStart, setDismissedStart] = useState<number | null>(null);
  const [items, setItems] = useState<readonly MentionItem[]>([]);
  const [isWalking, setIsWalking] = useState(false);
  const requestId = useRef<string | null>(null);

  // Text replaced from outside the field (history, line break) arrives before the caret is reported again.
  const mention = tracked.value === value ? findMentionAtCursor(value, tracked.cursor) : null;
  const isActive = mention !== null && dismissedStart !== mention.start;
  const query = mention?.query ?? '';

  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), query === '' ? 0 : MENTION_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);
  // A bare `@` opens the list on the same key; only a typed query waits for the pause.
  const effectiveQuery = query === '' ? '' : debouncedQuery;

  // One search session per open list: the server walks the workspace on the first `files.search` of a
  // request id, streams the results while it walks and only changes the query on the next ones.
  useEffect(() => {
    if (!isActive) {
      return;
    }
    const id = crypto.randomUUID();
    requestId.current = id;
    const unsubscribe = connection.onEvent((event) => {
      if (event.type === 'files.results' && event.requestId === id) {
        setItems(event.items);
        setIsWalking(event.walking);
      }
    });
    return () => {
      unsubscribe();
      requestId.current = null;
      connection.send({ type: 'files.close', requestId: id });
      setItems([]);
      setIsWalking(false);
    };
  }, [connection, isActive]);

  useEffect(() => {
    if (isActive && requestId.current) {
      connection.send({ type: 'files.search', requestId: requestId.current, query: effectiveQuery });
    }
  }, [connection, isActive, effectiveQuery]);

  const isOpen = isActive && isFocused && items.length > 0;
  // The highlight returns to the first item whenever the searched query changes.
  const highlighted = highlight.query === effectiveQuery ? highlight.index : 0;
  const highlightedIndex = Math.min(highlighted, Math.max(0, items.length - 1));
  const highlightItem = (index: number) => setHighlight({ query: effectiveQuery, index });

  const trackCursor = useCallback((field: HTMLTextAreaElement) => {
    setTracked({ value: field.value, cursor: field.selectionStart });
    if (!findMentionAtCursor(field.value, field.selectionStart)) {
      setDismissedStart(null);
    }
  }, []);

  const accept = useCallback((item: MentionItem) => {
    const { start, end } = mention ?? { start: value.length, end: value.length };
    const inserted = formatMention(item.path, item.kind);
    const next = value.slice(0, start) + inserted + value.slice(end);
    const caret = start + inserted.length;
    onValueChange(next);
    setTracked({ value: next, cursor: caret });
    placeCaret(caret);
  }, [mention, value, onValueChange, placeCaret]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!isOpen || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlightItem(Math.max(0, highlightedIndex - 1));
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      highlightItem(Math.min(items.length - 1, highlightedIndex + 1));
    } else if (event.key === 'Tab' || event.key === 'Enter') {
      event.preventDefault();
      accept(items[highlightedIndex]);
    } else if (event.key === 'Escape' && mention) {
      event.preventDefault();
      setDismissedStart(mention.start);
    }
  };

  const onCursorEvent = (event: FieldEvent) => trackCursor(event.currentTarget);

  return {
    isOpen,
    items,
    isWalking,
    highlightedIndex,
    listboxId,
    optionId: (index: number) => `${listboxId}-${index}`,
    onHighlightChange: highlightItem,
    accept,
    onKeyDown,
    trackCursor,
    fieldHandlers: {
      onSelect: onCursorEvent,
      onClick: onCursorEvent,
      onKeyUp: onCursorEvent,
      onFocus: (event: FocusEvent<HTMLTextAreaElement>) => {
        trackCursor(event.currentTarget);
        setIsFocused(true);
      },
      onBlur: () => setIsFocused(false),
    },
  };
}
