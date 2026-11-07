import { File, LoaderCircle, TriangleAlert, X } from 'lucide-react';

import { cn } from '../../lib/utils.js';
import { IconButton } from '../icon-button.js';


/** A file attached to a message. With `onRemove` it is an item of the message being written, otherwise it is read-only. */
export function AttachmentChip({ name, status = 'ready', error, onRemove, className }: {
  readonly name: string;
  readonly status?: 'uploading' | 'ready' | 'error';
  readonly error?: string;
  readonly onRemove?: () => void;
  readonly className?: string;
}) {
  const Icon = status === 'error' ? TriangleAlert : File;
  return (
    <li
      title={error ?? name}
      className={cn('flex max-w-60 items-center gap-1 rounded-md border bg-muted/50 py-0.5 pl-2 text-xs', onRemove ? 'pr-0.5' : 'pr-2', status === 'error' && 'border-destructive/50 text-destructive', className)}
    >
      {status === 'uploading'
        ? <LoaderCircle aria-label="Uploading" className="size-3.5 shrink-0 animate-spin" />
        : <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />}
      <span className="truncate">{name}</span>
      {error && <span className="sr-only">{error}</span>}
      {onRemove && (
        <IconButton variant="ghost" size="icon-xs" label={`Remove ${name}`} onClick={onRemove}>
          <X aria-hidden />
        </IconButton>
      )}
    </li>
  );
}
