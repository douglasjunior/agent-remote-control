import type { ClientCommand } from '@agent-remote-control/protocol/client-command';
import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import type { CSSProperties } from 'react';

import { agentIdentity } from '../../lib/agent-identity.js';
import { cn } from '../../lib/utils.js';
import { PromptInput } from '../prompt-input/prompt-input.js';
import { Button } from '../ui/button.js';

import { useAnswerInput } from './answer-input.js';
import { Markdown } from './markdown.js';


type QuestionEntry = Extract<ConversationEntry, { type: 'question' }>;

export type QuestionAnswer = Extract<ClientCommand, { type: 'question.answer' }>['answer'];

function AnswerField() {
  const input = useAnswerInput();
  return <PromptInput input={input} layout="inline" label="Your answer" placeholder="Write your own answer…" submitLabel="Answer" />;
}

export function QuestionCard({ entry, active, onAnswer }: {
  readonly entry: QuestionEntry;
  readonly active: boolean;
  readonly onAnswer: (answer: QuestionAnswer) => void;
}) {
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
        {active && <AnswerField />}
      </div>
    </div>
  );
}
