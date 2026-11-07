import type { KeyboardEvent } from 'react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import type { IServerConnection } from '../../connection/server-connection.js';


export const HISTORY_REQUEST_TIMEOUT_MS = 5_000;

type Navigation = {
  /** Most recent first. */
  readonly entries: readonly string[];
  /** `null` is the text being typed; 0 is the most recent entry. */
  readonly index: number | null;
  /** Current text of every visited position; the `null` key holds the text being typed. */
  readonly drafts: ReadonlyMap<number | null, string>;
};

type Cursor = { readonly element: HTMLTextAreaElement; readonly at: 'start' | 'end' };

/** 1 is the oldest entry, `total` the most recent. */
export type PromptHistoryPosition = { readonly position: number; readonly total: number };

function positionOf(navigation: Navigation | null): PromptHistoryPosition | null {
  if (!navigation || navigation.index === null) {
    return null;
  }
  return { position: navigation.entries.length - navigation.index, total: navigation.entries.length };
}

function requestPrompts(connection: IServerConnection): Promise<readonly string[]> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const finish = (settle: () => void) => {
      clearTimeout(timer);
      unsubscribe();
      settle();
    };
    const unsubscribe = connection.onEvent((event) => {
      if (event.type === 'prompts.list' && event.requestId === requestId) {
        finish(() => resolve(event.prompts));
      }
    });
    const timer = setTimeout(() => finish(() => reject(new Error('Prompt history timed out'))), HISTORY_REQUEST_TIMEOUT_MS);
    connection.send({ type: 'prompts.history', requestId });
  });
}

/**
 * Shell-like history on `ArrowUp`/`ArrowDown` while the caret sits on the first/last line of the
 * field. The first `ArrowUp` asks the server for its prompt history and the navigation runs over
 * that list until `reset()`; the server records a prompt when it accepts the message. Going up stops
 * at the oldest entry, going down returns to the text being typed, and the edit made at each
 * position is kept there. During IME composition the arrows belong to the IME.
 */
export function usePromptHistory(
  connection: IServerConnection,
  setDraft: (value: string) => void,
) {
  const navigation = useRef<Navigation | null>(null);
  const [position, setPosition] = useState<PromptHistoryPosition | null>(null);
  const loading = useRef(false);
  const cursor = useRef<Cursor | null>(null);
  const [revision, setRevision] = useState(0);

  // The new text only reaches the field on the next render; the caret moves to the edge after it.
  useLayoutEffect(() => {
    const pending = cursor.current;
    if (!pending) {
      return;
    }
    cursor.current = null;
    const offset = pending.at === 'end' ? pending.element.value.length : 0;
    pending.element.setSelectionRange(offset, offset);
  }, [revision]);

  const show = useCallback((next: Navigation, element: HTMLTextAreaElement, at: Cursor['at']) => {
    navigation.current = next;
    setPosition(positionOf(next));
    cursor.current = { element, at };
    setRevision(value => value + 1);
    setDraft(next.drafts.get(next.index) ?? next.entries[next.index as number]);
  }, [setDraft]);

  const move = useCallback((current: Navigation, index: number | null, element: HTMLTextAreaElement, at: Cursor['at']) => {
    const drafts = new Map(current.drafts).set(current.index, element.value);
    show({ ...current, index, drafts }, element, at);
  }, [show]);

  const openSession = useCallback(async (element: HTMLTextAreaElement) => {
    loading.current = true;
    try {
      const prompts = await requestPrompts(connection);
      if (prompts.length > 0) {
        show({ entries: prompts, index: 0, drafts: new Map([[null, element.value]]) }, element, 'end');
      }
    } catch {
      // Nothing opens; the next `ArrowUp` asks again.
    } finally {
      loading.current = false;
    }
  }, [connection, show]);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }

    const element = event.currentTarget;
    const up = event.key === 'ArrowUp';
    const onBoundaryLine = up
      ? !element.value.slice(0, element.selectionStart).includes('\n')
      : !element.value.slice(element.selectionEnd).includes('\n');
    if (!onBoundaryLine) {
      return;
    }

    const current = navigation.current;
    if (up) {
      event.preventDefault();
      if (loading.current) {
        return;
      }
      if (!current) {
        void openSession(element);
      } else if (current.index === null || current.index < current.entries.length - 1) {
        move(current, current.index === null ? 0 : current.index + 1, element, 'end');
      }
      return;
    }

    if (!current || current.index === null) {
      return;
    }
    event.preventDefault();
    move(current, current.index === 0 ? null : current.index - 1, element, 'start');
  }, [move, openSession]);

  /** Ends the navigation session; the next `ArrowUp` reads the history again. */
  const reset = useCallback(() => {
    navigation.current = null;
    setPosition(null);
  }, []);

  return { onKeyDown, reset, position };
}
