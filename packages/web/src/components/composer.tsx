import { Send, Square } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

import { useConnection } from '../connection/connection-context.js';

import { FileMentionPopup } from './prompt-input/file-mention-popup.js';
import { useFileMentions } from './prompt-input/use-file-mentions.js';
import { usePromptHistory } from './prompt-input/use-prompt-history.js';
import { Button } from './ui/button.js';
import { Textarea } from './ui/textarea.js';


export function Composer({ disabled, running, onSend, onStop }: {
  readonly disabled: boolean;
  readonly running: boolean;
  readonly onSend: (text: string) => void;
  readonly onStop: () => void;
}) {
  const { connection } = useConnection();
  const [text, setText] = useState('');
  const { onKeyDown: onHistoryKeyDown, reset: resetHistory, position } = usePromptHistory(connection, setText);

  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const mentions = useFileMentions({
    connection,
    value: text,
    onValueChange: setText,
    placeCaret: (offset) => {
      pendingCaret.current = offset;
    },
  });

  // An accepted mention reaches the field on the next render; the caret goes after it.
  useLayoutEffect(() => {
    if (pendingCaret.current === null) {
      return;
    }
    fieldRef.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  });

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    onSend(trimmed);
    resetHistory();
    setText('');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    mentions.onKeyDown(event);
    if (event.defaultPrevented) {
      return;
    }
    onHistoryKeyDown(event);
    if (event.defaultPrevented) {
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  return (
    <div className="border-t p-3">
      <div className="relative mx-auto flex w-full max-w-3xl items-end gap-2">
        {position && (
          <span className="absolute -top-5 left-2 text-xs text-muted-foreground">
            {`History ${position.position}/${position.total}`}
          </span>
        )}
        {mentions.isOpen && (
          <FileMentionPopup
            id={mentions.listboxId}
            items={mentions.items}
            isWalking={mentions.isWalking}
            highlightedIndex={mentions.highlightedIndex}
            optionId={mentions.optionId}
            onHighlightChange={mentions.onHighlightChange}
            onAccept={mentions.accept}
          />
        )}
        <Textarea
          ref={fieldRef}
          aria-autocomplete="list"
          aria-expanded={mentions.isOpen}
          aria-controls={mentions.isOpen ? mentions.listboxId : undefined}
          aria-activedescendant={mentions.isOpen ? mentions.optionId(mentions.highlightedIndex) : undefined}
          aria-label="Message"
          placeholder="Message the agents…"
          rows={1}
          className="max-h-48 min-h-10 resize-none"
          value={text}
          disabled={disabled}
          onChange={(event) => {
            setText(event.target.value);
            mentions.trackCursor(event.currentTarget);
          }}
          {...mentions.fieldHandlers}
          onKeyDown={handleKeyDown}
        />
        {running && (
          <Button variant="outline" size="icon" aria-label="Stop" onClick={onStop}>
            <Square />
          </Button>
        )}
        <Button size="icon" aria-label="Send" disabled={disabled || !text.trim()} onClick={send}>
          <Send />
        </Button>
      </div>
    </div>
  );
}
