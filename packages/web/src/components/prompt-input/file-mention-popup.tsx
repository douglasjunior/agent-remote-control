import { File, Folder, LoaderCircle } from 'lucide-react';

import { cn } from '../../lib/utils.js';

import type { MentionItem } from './use-file-mentions.js';


type PathRun = {
  text: string;
  readonly isMatch: boolean;
};

/** Splits a text into matched and unmatched runs, so the highlight needs no element per character. */
function toRuns(text: string, matched: ReadonlySet<number>, offset: number): PathRun[] {
  const runs: PathRun[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const isMatch = matched.has(offset + index);
    const current = runs.at(-1);
    if (current?.isMatch === isMatch) {
      current.text += text[index];
    } else {
      runs.push({ text: text[index], isMatch });
    }
  }
  return runs;
}

function renderRuns(runs: readonly PathRun[]) {
  return runs.map((run, index) => (
    <span key={index} className={cn(run.isMatch && 'font-medium text-primary')}>{run.text}</span>
  ));
}

export function FileMentionPopup({ id, items, highlightedIndex, isWalking, optionId, onHighlightChange, onAccept }: {
  readonly id: string;
  readonly items: readonly MentionItem[];
  readonly highlightedIndex: number;
  /** `true` while the server still walks the workspace and may deliver more items. */
  readonly isWalking: boolean;
  readonly optionId: (index: number) => string;
  readonly onHighlightChange: (index: number) => void;
  readonly onAccept: (item: MentionItem) => void;
}) {
  const renderItem = (item: MentionItem, index: number) => {
    const Icon = item.kind === 'directory' ? Folder : File;
    const highlighted = index === highlightedIndex;
    const matched = new Set(item.matches);
    // The trailing `/` of a directory does not start a new name.
    const nameStart = item.path.lastIndexOf('/', item.path.length - 2) + 1;
    return (
      <li
        key={item.path}
        id={optionId(index)}
        role="option"
        aria-selected={highlighted}
        ref={element => (highlighted ? element?.scrollIntoView?.({ block: 'nearest' }) : undefined)}
        // Keeps the focus in the field so the list does not close before the click lands.
        onMouseDown={event => event.preventDefault()}
        onMouseMove={() => onHighlightChange(index)}
        onClick={() => onAccept(item)}
        className={cn('flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm', highlighted && 'bg-accent text-accent-foreground')}
      >
        <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 items-baseline">
          {nameStart > 0 && (
            <span className="truncate text-muted-foreground">{renderRuns(toRuns(item.path.slice(0, nameStart), matched, 0))}</span>
          )}
          <span className="shrink-0 whitespace-pre">{renderRuns(toRuns(item.path.slice(nameStart), matched, nameStart))}</span>
        </span>
      </li>
    );
  };

  return (
    <div className="absolute right-0 bottom-full left-0 z-20 mb-1 flex flex-col rounded-lg border bg-popover text-popover-foreground shadow-md">
      <ul id={id} role="listbox" aria-label="Files" className="max-h-60 overflow-y-auto p-1">
        {items.map(renderItem)}
      </ul>
      <div className="flex items-center gap-1.5 border-t px-3 py-1.5 text-xs text-muted-foreground">
        <span>{`${highlightedIndex + 1} / ${items.length}`}</span>
        {isWalking && (
          <>
            <LoaderCircle aria-hidden data-testid="walking-spinner" className="size-3 animate-spin" />
            Searching…
          </>
        )}
      </div>
    </div>
  );
}
