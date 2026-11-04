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
    <Card className={active ? 'border-primary/50' : 'opacity-70'}>
      <CardHeader>
        <CardTitle className="text-sm">
          {entry.askerRoleName}
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
        <Markdown text={entry.text} />
        {entry.rationale && <p className="text-xs text-muted-foreground">{entry.rationale}</p>}
        {entry.options.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {entry.options.map((option, index) => (
              <Button
                key={option}
                size="sm"
                variant="outline"
                disabled={!active}
                onClick={() => onAnswer({ kind: 'option', optionIndex: index + 1 })}
              >
                {option}
              </Button>
            ))}
          </div>
        )}
        <form onSubmit={submitText} className="flex gap-2">
          <input
            aria-label="Your answer"
            value={text}
            disabled={!active}
            onChange={event => setText(event.target.value)}
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
          />
          <Button type="submit" size="sm" disabled={!active || !text.trim()}>Answer</Button>
        </form>
      </CardContent>
    </Card>
  );
}
