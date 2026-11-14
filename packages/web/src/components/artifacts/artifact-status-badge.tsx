import type { ArtifactStatus } from '@agent-remote-control/protocol/artifact';
import { Snowflake } from 'lucide-react';
import type { CSSProperties } from 'react';

import { STATUS_LABELS, STATUS_TONES } from '../../artifacts/artifact-labels.js';
import { cn } from '../../lib/utils.js';


/** A pill tinted with the status tone, so a status reads the same in the list, on the board and in the detail. */
export function ArtifactStatusBadge({ status, className }: { readonly status: ArtifactStatus; readonly className?: string }) {
  return (
    <span
      data-status={status}
      style={{ '--tone': STATUS_TONES[status] } as CSSProperties}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[color-mix(in_oklab,var(--tone)_35%,transparent)] bg-[color-mix(in_oklab,var(--tone)_12%,transparent)] px-2 py-0.5 text-[11.5px] leading-none font-medium whitespace-nowrap text-foreground',
        status === 'cancelled' && 'text-muted-foreground line-through decoration-muted-foreground/60',
        className,
      )}
    >
      {status === 'frozen'
        ? <Snowflake aria-hidden className="size-3 text-(--tone)" />
        : <span aria-hidden className="size-1.5 rounded-full bg-(--tone)" />}
      {STATUS_LABELS[status]}
    </span>
  );
}
