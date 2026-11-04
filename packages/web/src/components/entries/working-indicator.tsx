import { cn } from '../../lib/utils.js';


/** Three dots that rise in turn: the agents are at work. Still when the user prefers reduced motion. */
export function WorkingDots({ className }: { readonly className?: string }) {
  return (
    <span aria-hidden className={cn('inline-flex items-center gap-0.5 text-primary', className)}>
      {[0, 1, 2].map(index => (
        <span
          key={index}
          className="size-1 rounded-full bg-current motion-safe:animate-[working-dot_1.2s_ease-in-out_infinite]"
          style={{ animationDelay: `${index * 0.15}s` }}
        />
      ))}
    </span>
  );
}

export function WorkingLabel({ children }: { readonly children: string }) {
  return <span className="motion-safe:animate-[working-shimmer_2.4s_linear_infinite] motion-safe:bg-[linear-gradient(90deg,var(--muted-foreground)_40%,var(--foreground)_50%,var(--muted-foreground)_60%)] motion-safe:bg-[length:250%_100%] motion-safe:bg-clip-text motion-safe:text-transparent">{children}</span>;
}

/** Shown from the moment the turn starts until the first step or the response appears. */
export function WorkingIndicator() {
  return (
    <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <WorkingDots />
      <WorkingLabel>Working…</WorkingLabel>
    </div>
  );
}
