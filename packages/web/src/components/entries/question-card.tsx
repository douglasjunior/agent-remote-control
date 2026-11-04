import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { useState, type FormEvent } from 'react';

import { Button } from '../ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.js';

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

  return (
    <Card className={active ? 'min-w-0 border-primary/50' : 'min-w-0 opacity-60'}>
      <CardHeader>
        <CardTitle className="text-sm">
          {entry.askerRoleName}
          {entry.projectName && <span className="font-normal text-muted-foreground">{` · ${entry.projectName}`}</span>}
          {' '}
          asks
          {entry.total > 1 && (
            <span className="ml-2 font-normal text-muted-foreground">
              {`Question ${entry.number} of ${entry.total}`}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {active && entry.message && <Markdown text={entry.message} className="text-muted-foreground" />}
        <Markdown text={entry.text} className="font-medium" />
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
      </CardContent>
    </Card>
  );
}
