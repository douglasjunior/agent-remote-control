import type { ArtifactStatus, ArtifactSummary, ArtifactType } from '@agent-remote-control/protocol/artifact';
import { ArrowRightLeft, Layers, Snowflake } from 'lucide-react';
import { useState, type CSSProperties, type DragEvent } from 'react';
import { Link } from 'react-router';

import { STATUS_LABELS, STATUS_TONES } from '../../artifacts/artifact-labels.js';
import { artifactPath } from '../../artifacts/artifact-paths.js';
import { type ArtifactFilter, childrenOf, compareArtifacts, isClosed, matchesFilter, taskProgress } from '../../artifacts/artifact-tree.js';
import { agentIdentity } from '../../lib/agent-identity.js';
import { cn } from '../../lib/utils.js';
import { IconButton } from '../icon-button.js';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '../ui/dropdown-menu.js';

import { ArtifactAssignee } from './artifact-assignee.js';
import { ProjectChip, PullRequestChip, WaitingChip } from './artifact-indicators.js';
import { ArtifactUnfreezeDialog } from './artifact-unfreeze-dialog.js';


const COLUMNS: readonly ArtifactStatus[] = ['backlog', 'ready', 'in_progress', 'in_review', 'changes_requested', 'approved', 'in_testing', 'done', 'blocked', 'frozen', 'cancelled'];
const DRAG_TYPE = 'application/x-artifact-id';

/**
 * The columns in workflow order: the closed ones only while the filter keeps closed artifacts, and Frozen only while
 * a task is frozen, since freezing is the exception.
 */
function columnsFor(filter: ArtifactFilter, anyFrozen: boolean): readonly ArtifactStatus[] {
  return COLUMNS.filter(status => !(filter.hideClosed && isClosed(status)) && (status !== 'frozen' || anyFrozen));
}

function MoveMenu({ artifact, onMove, onUnfreeze }: {
  readonly artifact: ArtifactSummary;
  readonly onMove: (status: ArtifactStatus) => void;
  readonly onUnfreeze: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <IconButton
            variant="ghost"
            size="icon-sm"
            label={`Move ${artifact.id}`}
            className="opacity-70 group-hover:opacity-100 focus-visible:opacity-100"
          />
        )}
      >
        <ArrowRightLeft />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {artifact.status === 'frozen' && (
          <>
            <DropdownMenuItem onClick={onUnfreeze}>
              <Snowflake className="text-frozen" />
              Unfreeze…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuGroup><DropdownMenuLabel>Move to</DropdownMenuLabel></DropdownMenuGroup>
        <DropdownMenuRadioGroup value={artifact.status} onValueChange={status => onMove(status as ArtifactStatus)}>
          {Object.entries(STATUS_LABELS).map(([status, label]) => (
            <DropdownMenuRadioItem key={status} closeOnClick value={status}>{label}</DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The tasks of a feature, as one bar split by status, with how many are done. */
function FeatureProgress({ feature, artifacts }: { readonly feature: ArtifactSummary; readonly artifacts: readonly ArtifactSummary[] }) {
  const tasks = childrenOf(feature.id, artifacts);
  const { done, total } = taskProgress(feature.id, artifacts);
  if (total === 0) {
    return <span className="text-[12px] text-muted-foreground">No tasks yet</span>;
  }
  const counts = COLUMNS
    .filter(status => status !== 'cancelled')
    .map(status => [status, tasks.filter(task => task.status === status).length] as const)
    .filter(([, count]) => count > 0);
  const breakdown = counts.map(([status, count]) => `${count} ${STATUS_LABELS[status].toLowerCase()}`).join(', ');
  return (
    <div className="flex items-center gap-2" title={breakdown}>
      <span role="img" aria-label={`${done} of ${total} tasks done: ${breakdown}`} className="flex h-1.5 flex-1 gap-px overflow-hidden rounded-full bg-muted">
        {counts.map(([status, count]) => (
          <span
            key={status}
            className="h-full transition-[width] duration-500 first:rounded-l-full last:rounded-r-full motion-reduce:transition-none"
            style={{ width: `${(count / total) * 100}%`, background: STATUS_TONES[status] }}
          />
        ))}
      </span>
      <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{`${done}/${total}`}</span>
    </div>
  );
}

function KanbanCard({ conversationId, artifact, artifacts, byId, onMove, onUnfreeze }: {
  readonly conversationId: string;
  readonly artifacts: readonly ArtifactSummary[];
  readonly artifact: ArtifactSummary;
  readonly byId: Readonly<Record<string, ArtifactSummary>>;
  readonly onMove: (status: ArtifactStatus) => void;
  readonly onUnfreeze: () => void;
}) {
  const parent = artifact.parentId ? byId[artifact.parentId] : undefined;
  const startDrag = (event: DragEvent) => {
    event.dataTransfer.setData(DRAG_TYPE, artifact.id);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <li
      draggable
      onDragStart={startDrag}
      style={artifact.assignee ? { '--holder': agentIdentity(artifact.assignee.role, artifact.assignee.roleName).color } as CSSProperties : undefined}
      aria-label={`${artifact.id} ${artifact.title}`}
      className={cn(
        'group flex cursor-grab flex-col gap-2 rounded-xl border bg-card p-3 text-sm shadow-xs transition-[border-color,box-shadow] duration-200 hover:border-foreground/20 hover:shadow-sm active:cursor-grabbing',
        artifact.assignee && 'border-[color-mix(in_oklab,var(--holder)_45%,var(--border))]',
        artifact.status === 'frozen' && 'border-frozen/50 bg-[color-mix(in_oklab,var(--frozen)_7%,var(--card))]',
      )}
    >
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-mono text-[11px] text-muted-foreground">{artifact.id}</span>
          <Link
            to={artifactPath(conversationId, artifact.id)}
            draggable={false}
            className="line-clamp-3 rounded-sm leading-snug font-medium outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {artifact.title}
          </Link>
          {artifact.type === 'feature' && <div className="pt-1.5"><FeatureProgress feature={artifact} artifacts={artifacts} /></div>}
          {parent && (
            <span className="flex min-w-0 items-center gap-1 text-[12px] text-muted-foreground" title={`${parent.id} ${parent.title}`}>
              <Layers aria-hidden className="size-3 shrink-0 text-(--agent-product-owner)" />
              <span className="truncate">{parent.title}</span>
            </span>
          )}
        </div>
        <MoveMenu artifact={artifact} onMove={onMove} onUnfreeze={onUnfreeze} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <ProjectChip projectName={artifact.projectName} />
        <WaitingChip artifact={artifact} byId={byId} />
        <PullRequestChip artifact={artifact} />
        {artifact.assignee && <ArtifactAssignee assignee={artifact.assignee} className="ml-auto" />}
      </div>
    </li>
  );
}

/**
 * The tasks, or the features, one column per status; dropping a card on a column, or picking it in the card's menu,
 * moves it there.
 */
export function ArtifactKanban({ conversationId, type, artifacts, byId, filter, onMove }: {
  readonly conversationId: string;
  readonly type: ArtifactType;
  readonly artifacts: readonly ArtifactSummary[];
  readonly byId: Readonly<Record<string, ArtifactSummary>>;
  readonly filter: ArtifactFilter;
  readonly onMove: (id: string, status: ArtifactStatus) => void;
}) {
  const [target, setTarget] = useState<ArtifactStatus | null>(null);
  const [unfreezing, setUnfreezing] = useState<{ readonly artifact: ArtifactSummary; readonly status?: ArtifactStatus } | null>(null);
  const visible = artifacts.filter(artifact => artifact.type === type && matchesFilter(artifact, filter)).sort(compareArtifacts);

  /** Leaving Frozen is the user's decision with its own dialog, wherever the card is moved from. */
  const move = (artifact: ArtifactSummary, status: ArtifactStatus) => {
    if (artifact.status === 'frozen') {
      setUnfreezing({ artifact, status });
      return;
    }
    onMove(artifact.id, status);
  };

  const drop = (status: ArtifactStatus) => (event: DragEvent) => {
    event.preventDefault();
    setTarget(null);
    const id = event.dataTransfer.getData(DRAG_TYPE);
    if (byId[id] && byId[id].status !== status) {
      move(byId[id], status);
    }
  };

  return (
    <div className="-mx-4 flex min-h-0 flex-1 snap-x gap-3 overflow-x-auto px-4 pb-4">
      {columnsFor(filter, visible.some(artifact => artifact.status === 'frozen')).map((status) => {
        const cards = visible.filter(artifact => artifact.status === status);
        return (
          <section
            key={status}
            aria-label={STATUS_LABELS[status]}
            data-drop-target={target === status}
            onDragOver={(event) => {
              event.preventDefault();
              setTarget(status);
            }}
            onDragLeave={() => setTarget(current => (current === status ? null : current))}
            onDrop={drop(status)}
            style={{ '--tone': STATUS_TONES[status] } as CSSProperties}
            className="flex w-72 shrink-0 snap-start flex-col rounded-2xl border border-transparent bg-muted/45 transition-colors duration-200 data-[drop-target=true]:border-[color-mix(in_oklab,var(--tone)_55%,transparent)] data-[drop-target=true]:bg-[color-mix(in_oklab,var(--tone)_9%,var(--muted))]"
          >
            <header className="flex items-center gap-2 px-3 pt-3 pb-2">
              <span aria-hidden className="size-2 rounded-full bg-(--tone)" />
              <h2 className="text-[13px] font-semibold">{STATUS_LABELS[status]}</h2>
              <span className="ml-auto rounded-full bg-background/70 px-1.5 font-mono text-[11px] text-muted-foreground tabular-nums">{cards.length}</span>
            </header>
            <ul className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
              {cards.map(artifact => (
                <KanbanCard key={artifact.id} conversationId={conversationId} artifact={artifact} artifacts={artifacts} byId={byId} onMove={next => move(artifact, next)} onUnfreeze={() => setUnfreezing({ artifact })} />
              ))}
            </ul>
          </section>
        );
      })}
      {unfreezing && (
        <ArtifactUnfreezeDialog
          conversationId={conversationId}
          artifact={unfreezing.artifact}
          defaultStatus={unfreezing.status}
          open
          onOpenChange={open => !open && setUnfreezing(null)}
        />
      )}
    </div>
  );
}
