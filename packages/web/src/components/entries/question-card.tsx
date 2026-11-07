import type { ClientCommand } from '@agent-remote-control/protocol/client-command';
import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { type CSSProperties, useEffect, useState } from 'react';

import { agentIdentity } from '../../lib/agent-identity.js';
import { cn } from '../../lib/utils.js';
import { PromptInput } from '../prompt-input/prompt-input.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { Progress } from '../ui/progress.js';

import { useAnswerInput } from './answer-input.js';
import { Markdown } from './markdown.js';


type QuestionEntry = Extract<ConversationEntry, { type: 'question' }>;

export type QuestionAnswer = Extract<ClientCommand, { type: 'question.answer' }>['answer'];

const URGENT_MS = 30_000;

function useRemainingMs(expiresAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, expiresAt - now);
}

function QuestionCountdown({ timeout, recommended }: {
  readonly timeout: NonNullable<QuestionEntry['timeout']>;
  readonly recommended: boolean;
}) {
  const remainingMs = useRemainingMs(timeout.expiresAt);
  const seconds = Math.ceil(remainingMs / 1000);
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const urgent = remainingMs <= URGENT_MS;

  return (
    <div role="timer" aria-label={`Time left to answer: ${clock}`} className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
        <span>{recommended ? 'The recommended answer is assumed if you do not reply' : 'The agent carries on without an answer if you do not reply'}</span>
        <span className={cn('font-mono text-[13px] tabular-nums', urgent && 'text-destructive')}>{clock}</span>
      </div>
      <Progress
        value={Math.min(100, (remainingMs / timeout.durationMs) * 100)}
        aria-label="Time left to answer"
        className={cn(
          '[&_[data-slot=progress-indicator]]:duration-1000 [&_[data-slot=progress-indicator]]:ease-linear',
          urgent && '[&_[data-slot=progress-indicator]]:bg-destructive',
        )}
      />
    </div>
  );
}

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
                {entry.recommendedIndex === index + 1 && <Badge variant="secondary">Recommended</Badge>}
              </Button>
            ))}
          </div>
        )}
        {active && <AnswerField />}
        {active && entry.timeout && <QuestionCountdown timeout={entry.timeout} recommended={entry.recommendedIndex !== undefined} />}
      </div>
    </div>
  );
}
