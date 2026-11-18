import { useEffect, useState } from 'react';

import { cn } from '../../lib/utils.js';
import { Progress } from '../ui/progress.js';


const URGENT_MS = 30_000;

function useRemainingMs(expiresAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= expiresAt) {
        clearInterval(timer);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  return Math.max(0, expiresAt - now);
}

/** The time left before something happens without the user: what it is, a clock and a bar that empties. */
export function EntryCountdown({ timeout, description, label }: {
  readonly timeout: { readonly expiresAt: number; readonly durationMs: number };
  /** What happens when the time runs out. */
  readonly description: string;
  /** What the time left is for, read by assistive technology. */
  readonly label: string;
}) {
  const remainingMs = useRemainingMs(timeout.expiresAt);
  const seconds = Math.ceil(remainingMs / 1000);
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const urgent = remainingMs <= URGENT_MS;

  return (
    <div role="timer" aria-label={`${label}: ${clock}`} className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
        <span>{description}</span>
        <span className={cn('font-mono text-[13px] tabular-nums', urgent && 'text-destructive')}>{clock}</span>
      </div>
      <Progress
        value={Math.min(100, (remainingMs / timeout.durationMs) * 100)}
        aria-label={label}
        className={cn(
          '[&_[data-slot=progress-indicator]]:duration-1000 [&_[data-slot=progress-indicator]]:ease-linear',
          urgent && '[&_[data-slot=progress-indicator]]:bg-destructive',
        )}
      />
    </div>
  );
}
