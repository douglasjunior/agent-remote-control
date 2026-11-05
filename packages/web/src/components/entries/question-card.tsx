import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { useState, type CSSProperties, type FormEvent } from 'react';

import { agentIdentity } from '../../lib/agent-identity.js';
import { cn } from '../../lib/utils.js';
import { Button } from '../ui/button.js';

import { Markdown } from './markdown.js';


type QuestionEntry = Extract<ConversationEntry, { type: 'question' }>;

export type QuestionAnswer = { kind: 'option'; optionIndex: number } | { kind: 'text'; text: string };

export function QuestionCard({ entry, active, onAnswer }: {
  readonly entry: QuestionEntry;
  readonly active: boolean;
  readonly onAnswer: (answer: QuestionAnswer) => void;
}) {
  const [text, setText] = useState('');

  const submitText = (event: FormEvent) => {
    event.preventDefault();
    onAnswer({ kind: 'text', text: text.trim() });
    setText('');
  };

  const { color } = agentIdentity(entry.askerRole, entry.askerRoleName);

  return (
    <div
      data-question-id={entry.id}
      style={{ '--c': color } as CSSProperties}
      className={cn(
        'flex min-w-0 flex-col gap-2.5 rounded-[14px] border p-[15px] text-sm sm:ml-[46px]',
        active ? 'border-attention bg-[color-mix(in_oklab,var(--attention)_9%,var(--card))]' : 'bg-card',
      )}
    >
      <p className="text-[13.5px] font-semibold text-(--c)">
        {entry.askerRoleName}
        {entry.projectName && <span className="font-normal text-muted-foreground">{` · ${entry.projectName}`}</span>}
        {' '}
        asks
        {entry.total > 1 && (
          <span className="ml-2 font-normal text-muted-foreground">
            {`Question ${entry.number} of ${entry.total}`}
          </span>
        )}
      </p>
      <div className="flex flex-col gap-3">
        {active && entry.message && <Markdown text={entry.message} className="text-muted-foreground" />}
        <Markdown text={entry.text} className="font-heading text-base font-semibold" />
        {active && entry.rationale && (
          <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Why it matters: </span>
            {entry.rationale}
          </p>
        )}
        {active && entry.options.length > 0 && (
          <div className="flex flex-col gap-2">
            {entry.options.map((option, index) => (
              <Button
                key={option}
                variant="outline"
                className="h-auto w-full justify-start gap-3 px-3 py-2 text-left leading-snug whitespace-normal [overflow-wrap:anywhere]"
                onClick={() => onAnswer({ kind: 'option', optionIndex: index + 1 })}
              >
                <span aria-hidden className="font-mono text-xs text-muted-foreground">{index + 1}</span>
                <span className="min-w-0 flex-1">{option}</span>
              </Button>
            ))}
          </div>
        )}
        {active && (
          <form onSubmit={submitText} className="flex gap-2">
            <input
              aria-label="Your answer"
              value={text}
              onChange={event => setText(event.target.value)}
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
            />
            <Button type="submit" size="sm" disabled={!text.trim()}>Answer</Button>
          </form>
        )}
      </div>
    </div>
  );
}
