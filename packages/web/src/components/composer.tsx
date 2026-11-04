import { Send, Square } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';

import { Button } from './ui/button.js';
import { Textarea } from './ui/textarea.js';


export function Composer({ disabled, running, onSend, onStop }: {
  readonly disabled: boolean;
  readonly running: boolean;
  readonly onSend: (text: string) => void;
  readonly onStop: () => void;
}) {
  const [text, setText] = useState('');

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    onSend(trimmed);
    setText('');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  return (
    <div className="border-t p-3">
      <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
        <Textarea
          aria-label="Message"
          placeholder="Message the agents…"
          rows={1}
          className="max-h-48 min-h-10 resize-none"
          value={text}
          disabled={disabled}
          onChange={event => setText(event.target.value)}
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
