import { Check, X } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';

import { agentIdentity, type MarkId } from '../../lib/agent-identity.js';
import { cn } from '../../lib/utils.js';


export type AgentMarkState = 'idle' | 'working' | 'waiting' | 'done' | 'failed';
export type AgentMarkSize = 'sm' | 'md' | 'lg';

const DIAMETERS: Readonly<Record<AgentMarkSize, string>> = { sm: '26px', md: '34px', lg: '36px' };

const STATE_LABELS: Readonly<Record<AgentMarkState, string>> = {
  idle: 'idle',
  working: 'working',
  waiting: 'waiting for you',
  done: 'done',
  failed: 'failed',
};

const DOT = { fill: 'currentColor', stroke: 'none' } as const;

const GLYPHS: Readonly<Record<MarkId, ReactNode>> = {
  ceo: (
    <>
      <circle cx="16" cy="16" r="3.2" {...DOT} />
      <circle cx="16" cy="16" r="11" opacity=".35" />
      <g className="g-orbit">
        <circle cx="16" cy="5" r="2.2" {...DOT} />
        <circle cx="25.5" cy="21.5" r="2.2" {...DOT} />
        <circle cx="6.5" cy="21.5" r="2.2" {...DOT} />
      </g>
    </>
  ),
  po: <path className="g-star" d="M16 4 L18.6 13.4 L28 16 L18.6 18.6 L16 28 L13.4 18.6 L4 16 L13.4 13.4 Z" fill="currentColor" fillOpacity=".22" />,
  lead: (
    <>
      <circle cx="16" cy="16" r="12" />
      <g className="g-needle"><path d="M16 7 L19 16 L16 25 L13 16 Z" fill="currentColor" fillOpacity=".3" /></g>
    </>
  ),
  dev: (
    <>
      <path className="g-left" d="M11 9 L4 16 L11 23" />
      <path className="g-right" d="M21 9 L28 16 L21 23" />
      <path className="g-cursor" d="M16 10 V22" />
    </>
  ),
  review: (
    <g className="g-glass">
      <circle cx="14" cy="14" r="8" fill="currentColor" fillOpacity=".14" />
      <path d="M20 20 L27 27" />
    </g>
  ),
  qa: (
    <>
      <path d="M12.5 5 H19.5 M13.5 5 V13 L7 24.5 C6.3 25.8 7.2 27 8.6 27 H23.4 C24.8 27 25.7 25.8 25 24.5 L18.5 13 V5" />
      <path d="M9.6 20 H22.4 L25 24.5 C25.7 25.8 24.8 27 23.4 27 H8.6 C7.2 27 6.3 25.8 7 24.5 Z" fill="currentColor" fillOpacity=".22" stroke="none" />
      <circle className="g-bubble" cx="14.5" cy="21" r="1.4" {...DOT} />
      <circle className="g-bubble" cx="18" cy="23" r="1.1" {...DOT} />
    </>
  ),
  git: (
    <>
      <path d="M9 7 V25" />
      <path d="M9 20 C9 14 23 17 23 9" />
      <circle cx="9" cy="6" r="2.6" {...DOT} />
      <circle cx="9" cy="26" r="2.6" {...DOT} />
      <circle cx="23" cy="7" r="2.6" {...DOT} />
      <circle className="g-dot" cx="9" cy="19" r="2" {...DOT} />
    </>
  ),
  generic: (
    <>
      <circle cx="16" cy="16" r="11" opacity=".35" />
      <circle cx="16" cy="16" r="3.2" {...DOT} />
    </>
  ),
};

/**
 * The agent's round lens with its own animated glyph. `dim` mutes the lens of an agent that is not part of the
 * current moment.
 */
export function AgentMark({ role, roleName, state = 'idle', size = 'md', dim = false, className }: {
  readonly role: string;
  readonly roleName?: string;
  readonly state?: AgentMarkState;
  readonly size?: AgentMarkSize;
  readonly dim?: boolean;
  readonly className?: string;
}) {
  const { mark, label, color } = agentIdentity(role, roleName);
  const badged = state === 'done' || state === 'failed';

  return (
    <span
      role="img"
      aria-label={`${label}, ${STATE_LABELS[state]}`}
      data-state={state}
      data-mark={mark}
      className={cn(
        'agent-mark relative inline-grid size-(--s) shrink-0 place-items-center rounded-full border border-[color-mix(in_oklab,var(--c)_42%,transparent)] bg-[color-mix(in_oklab,var(--c)_15%,var(--card))] text-(--c) transition-[box-shadow,filter] duration-500',
        'data-[state=working]:shadow-[0_0_22px_-2px_var(--c)] data-[state=waiting]:border-attention data-[state=waiting]:shadow-[0_0_22px_-2px_var(--attention)] data-[state=failed]:border-destructive',
        dim && 'opacity-75 saturate-[.45]',
        className,
      )}
      style={{ '--c': color, '--s': DIAMETERS[size] } as CSSProperties}
    >
      <svg viewBox="0 0 32 32" aria-hidden>{GLYPHS[mark]}</svg>
      {badged && (
        <span
          aria-hidden
          className={cn(
            'mark-badge absolute grid place-items-center rounded-full text-card ring-2 ring-card',
            size === 'sm' ? '-right-[2px] -bottom-[2px] size-[11px]' : '-right-[3px] -bottom-[3px] size-[15px]',
            state === 'done' ? 'bg-good' : 'bg-destructive',
          )}
        >
          {state === 'done' ? <Check className="size-[70%] stroke-[3.2]" /> : <X className="size-[70%] stroke-[3.2]" />}
        </span>
      )}
    </span>
  );
}
