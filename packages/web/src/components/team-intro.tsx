import type { CSSProperties } from 'react';

import { agentIdentity, TEAM_ROLES } from '../lib/agent-identity.js';

import { AgentMark } from './agent/agent-mark.js';


/** What a conversation without messages shows: the team, and a request each member could take. */
export function TeamIntro({ onPick }: { readonly onPick: (text: string) => void }) {
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col justify-center gap-6 overflow-y-auto px-4 py-8">
      <div className="flex flex-col gap-1 text-center">
        <h3 className="font-heading text-2xl font-semibold">Meet your team</h3>
        <p className="text-sm text-muted-foreground">Tell the Coordinator what you need. It brings in whoever is best for the job.</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TEAM_ROLES.map((role) => {
          const { label, tagline, example, color } = agentIdentity(role);
          return (
            <li key={role}>
              <button
                type="button"
                onClick={() => onPick(example)}
                style={{ '--agent-color': color } as CSSProperties}
                className="group flex h-full w-full flex-col items-start gap-3 rounded-2xl border bg-card/80 p-4 text-left outline-none backdrop-blur-sm transition hover:-translate-y-0.5 hover:border-(--agent-color)/60 hover:shadow-[0_8px_30px_-12px_var(--agent-color)] focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <AgentMark role={role} size="md" />
                <span className="flex flex-col gap-0.5">
                  <span className="font-heading text-sm font-medium">{label}</span>
                  <span className="text-xs text-muted-foreground">{tagline}</span>
                </span>
                <span className="text-xs text-(--agent-color)">{`“${example}”`}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
