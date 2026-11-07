import { useRef } from 'react';

import type { TeamMember } from '../../conversations/team-state.js';
import { useNow } from '../../lib/use-now.js';
import { cn } from '../../lib/utils.js';

import { squadStatus } from './squad-status.js';
import { Station } from './station.js';
import { useSquadMotion } from './use-squad-motion.js';
import { useSquadSpine } from './use-squad-spine.js';


const COORDINATOR = 'CEO';

/**
 * The present moment of the squad: one station per role, joined by a neutral spine. It describes the
 * current turn only and never grows; the feed is the history.
 */
export function SquadPanel({ members, focus, highlight, delivery, onSelect, onContinue }: {
  readonly members: readonly TeamMember[];
  readonly focus: string | null;
  readonly highlight: string | null;
  /** Counts the deliveries seen live; each increment plays the delivery moment once. */
  readonly delivery: number;
  readonly onSelect: (role: string) => void;
  readonly onContinue: (workId: string) => void;
}) {
  const root = useRef<HTMLElement>(null);
  const stations = useRef<HTMLDivElement>(null);
  const spine = useSquadSpine(stations, members.length);
  useSquadMotion({ root, stations, members, delivery });

  const status = squadStatus(members);
  const now = useNow(members.some(member => member.state === 'working' || member.state === 'waiting'));
  const delegating = members.some(member => member.role !== COORDINATOR && (member.state === 'working' || member.state === 'waiting'));

  return (
    <section ref={root} aria-label="Your squad" className="squad-panel relative flex h-full min-h-0 flex-col overflow-hidden bg-card">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(color-mix(in_oklab,var(--muted-foreground)_26%,transparent)_1px,transparent_1px)] bg-[length:22px_22px] opacity-45 [mask-image:linear-gradient(to_bottom,black,transparent_70%)]"
      />
      <header className="relative flex min-h-[60px] items-center justify-between gap-3 border-b px-5 py-3.5">
        <h2 className="font-heading text-[17px] leading-tight font-semibold">Your squad</h2>
        <span aria-live="polite" className="inline-flex items-center gap-2 text-[13px] whitespace-nowrap text-muted-foreground">
          <i
            aria-hidden
            data-live={status.live}
            className={cn('squad-live-dot size-[7px] rounded-full', status.live ? 'bg-good shadow-[0_0_0_0_var(--good)]' : 'bg-muted-foreground/60')}
          />
          {status.text}
        </span>
      </header>
      <div className="relative min-h-0 flex-1 overflow-y-auto p-3">
        <div ref={stations} className="relative">
          <div ref={spine} aria-hidden className="squad-spine absolute left-[30px] -ml-px w-0.5 rounded-sm bg-border" />
          <ul className="relative flex flex-col gap-0.5">
            {members.map((member, index) => (
              <Station
                key={member.role}
                member={member}
                index={index}
                now={now}
                delegating={delegating}
                selected={focus === member.role}
                highlighted={highlight === member.role}
                onSelect={onSelect}
                onContinue={onContinue}
              />
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
