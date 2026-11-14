import type { ArtifactType } from '@agent-remote-control/protocol/artifact';
import { Layers, SquareCheck, type LucideIcon } from 'lucide-react';

import { TYPE_LABELS } from '../../artifacts/artifact-labels.js';
import { cn } from '../../lib/utils.js';


const ICONS: Readonly<Record<ArtifactType, LucideIcon>> = { feature: Layers, task: SquareCheck };

const TONES: Readonly<Record<ArtifactType, string>> = {
  feature: 'text-(--agent-product-owner)',
  task: 'text-muted-foreground',
};

export function ArtifactTypeIcon({ type, className }: { readonly type: ArtifactType; readonly className?: string }) {
  const Icon = ICONS[type];
  return (
    <span role="img" aria-label={TYPE_LABELS[type]} className={cn('inline-flex size-4 shrink-0', TONES[type], className)}>
      <Icon aria-hidden className="size-full" />
    </span>
  );
}
