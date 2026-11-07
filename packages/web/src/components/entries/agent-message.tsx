import type { CSSProperties, ReactNode } from 'react';

import { agentIdentity } from '../../lib/agent-identity.js';
import { AgentMark } from '../agent/agent-mark.js';


/** The agent's name in its own color; clicking it focuses the feed on that agent. */
export function AgentName({ role, roleName, onFocus }: {
  readonly role: string;
  readonly roleName?: string;
  readonly onFocus: (role: string) => void;
}) {
  const { label, color } = agentIdentity(role, roleName);
  return (
    <button
      type="button"
      aria-label={`Show only ${label}`}
      onClick={() => onFocus(role)}
      style={{ '--c': color } as CSSProperties}
      className="block rounded-sm text-left text-[13.5px] font-semibold text-(--c) outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {label}
    </button>
  );
}

/** A message of an agent: its mark, its name, and the content under it. */
export function AgentMessage({ role, roleName, onFocus, children }: {
  readonly role: string;
  readonly roleName?: string;
  readonly onFocus: (role: string) => void;
  readonly children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[34px_minmax(0,1fr)] gap-3">
      <AgentMark role={role} roleName={roleName} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <AgentName role={role} roleName={roleName} onFocus={onFocus} />
        {children}
      </div>
    </div>
  );
}
