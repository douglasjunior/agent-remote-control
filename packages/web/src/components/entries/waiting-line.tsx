import type { CSSProperties } from 'react';

import type { QuestionEntry } from '../../conversations/open-question.js';
import { agentIdentity } from '../../lib/agent-identity.js';
import { Button } from '../ui/button.js';


/** One line above the composer that leads to the open question while it is out of view. */
export function WaitingLine({ question, onGo }: {
  readonly question: QuestionEntry;
  readonly onGo: () => void;
}) {
  const { label, color } = agentIdentity(question.askerRole, question.askerRoleName);

  return (
    <div style={{ '--c': color } as CSSProperties} className="mx-auto w-full max-w-[680px] px-5 pb-2">
      <div className="flex items-center gap-3 rounded-full border border-attention bg-[color-mix(in_oklab,var(--attention)_9%,var(--card))] py-1 pr-1 pl-3.5 text-sm">
        <i aria-hidden className="size-2 shrink-0 rounded-full bg-(--c)" />
        <p className="min-w-0 flex-1 truncate">{`${label} is waiting for your answer`}</p>
        <Button variant="outline" size="sm" className="shrink-0 rounded-full" onClick={onGo}>Go to question</Button>
      </div>
    </div>
  );
}
