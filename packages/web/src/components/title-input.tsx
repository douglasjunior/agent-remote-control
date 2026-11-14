import { MAX_CONVERSATION_TITLE_LENGTH } from '@agent-remote-control/protocol/limits';
import { useRef, useState } from 'react';

import { cn } from '../lib/utils.js';

import { Input } from './ui/input.js';


/**
 * Edits a title in place: Enter or leaving the field saves, Escape cancels. An empty or unchanged title saves
 * nothing, and `onDone` runs once however the edit ends.
 */
export function TitleInput({ title, label, onSave, onDone, className }: {
  readonly title: string;
  readonly label: string;
  readonly onSave: (title: string) => void;
  readonly onDone: () => void;
  readonly className?: string;
}) {
  const [draft, setDraft] = useState(title);
  const finished = useRef(false);

  const finish = (save: boolean) => {
    if (finished.current) {
      return;
    }
    finished.current = true;
    const next = draft.trim();
    if (save && next !== '' && next !== title) {
      onSave(next);
    }
    onDone();
  };

  return (
    <Input
      aria-label={label}
      value={draft}
      maxLength={MAX_CONVERSATION_TITLE_LENGTH}
      autoFocus
      onFocus={event => event.target.select()}
      onChange={event => setDraft(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(true);
        } else if (event.key === 'Escape') {
          // Escape ends the edit only, not the drawer or dialog around the field.
          event.preventDefault();
          event.stopPropagation();
          finish(false);
        }
      }}
      className={cn('h-8', className)}
    />
  );
}
