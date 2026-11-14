import type { ArtifactSummary } from '@agent-remote-control/protocol/artifact';
import { ChevronRight, FolderGit2, Snowflake } from 'lucide-react';
import { useId, useState } from 'react';
import { Link } from 'react-router';

import { artifactPath } from '../../artifacts/artifact-paths.js';
import { type ArtifactFilter, type ArtifactNode, buildTree, type ProjectTree, taskProgress } from '../../artifacts/artifact-tree.js';
import { cn } from '../../lib/utils.js';
import { IconButton } from '../icon-button.js';

import { ArtifactAssignee } from './artifact-assignee.js';
import { PullRequestChip, WaitingChip } from './artifact-indicators.js';
import { ArtifactStatusBadge } from './artifact-status-badge.js';
import { ArtifactTypeIcon } from './artifact-type-icon.js';
import { ArtifactUnfreezeDialog } from './artifact-unfreeze-dialog.js';


const INDENT_PX = 22;

type RowContext = {
  readonly conversationId: string;
  readonly unfreeze: (artifact: ArtifactSummary) => void;
  readonly artifacts: readonly ArtifactSummary[];
  readonly byId: Readonly<Record<string, ArtifactSummary>>;
  readonly collapsed: ReadonlySet<string>;
  readonly toggle: (id: string) => void;
};

function Progress({ artifact, artifacts }: { readonly artifact: ArtifactSummary; readonly artifacts: readonly ArtifactSummary[] }) {
  const { done, total } = taskProgress(artifact.id, artifacts);
  if (total === 0) {
    return null;
  }
  return (
    <span className="hidden items-center gap-1.5 sm:inline-flex" title={`${done} of ${total} tasks done`}>
      <span aria-hidden className="h-1 w-12 overflow-hidden rounded-full bg-muted">
        <span className="block h-full rounded-full bg-good transition-[width] duration-500" style={{ width: `${(done / total) * 100}%` }} />
      </span>
      <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{`${done}/${total}`}</span>
    </span>
  );
}

function TreeRow({ node, depth, context }: { readonly node: ArtifactNode; readonly depth: number; readonly context: RowContext }) {
  const { artifact, children } = node;
  const open = !context.collapsed.has(artifact.id);
  const grouping = artifact.type === 'feature';

  return (
    <li>
      <div
        className={cn(
          'group flex min-h-10 items-center gap-2 rounded-lg py-1.5 pr-2 transition-colors hover:bg-accent/60',
          grouping && 'font-medium',
        )}
        style={{ paddingLeft: `${depth * INDENT_PX + 4}px` }}
      >
        {children.length > 0
          ? (
            <button
              type="button"
              aria-expanded={open}
              aria-label={`${open ? 'Collapse' : 'Expand'} ${artifact.id}`}
              onClick={() => context.toggle(artifact.id)}
              className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <ChevronRight aria-hidden className={cn('size-3.5 transition-transform duration-200', open && 'rotate-90')} />
            </button>
          )
          : <span aria-hidden className="size-6 shrink-0" />}
        <ArtifactTypeIcon type={artifact.type} />
        <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground">{artifact.id}</span>
        <Link
          to={artifactPath(context.conversationId, artifact.id)}
          className={cn(
            'min-w-0 flex-1 truncate rounded-sm text-sm outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50',
            artifact.status === 'cancelled' && 'text-muted-foreground line-through',
          )}
        >
          {artifact.title}
        </Link>
        <span className="flex shrink-0 items-center gap-1.5">
          {grouping && <Progress artifact={artifact} artifacts={context.artifacts} />}
          <WaitingChip artifact={artifact} byId={context.byId} />
          <PullRequestChip artifact={artifact} />
          {artifact.status === 'frozen' && (
            <IconButton variant="ghost" size="icon-xs" label={`Unfreeze ${artifact.id}`} onClick={() => context.unfreeze(artifact)} className="text-frozen">
              <Snowflake />
            </IconButton>
          )}
          {artifact.assignee && <ArtifactAssignee assignee={artifact.assignee} compact />}
          <ArtifactStatusBadge status={artifact.status} />
        </span>
      </div>
      {children.length > 0 && open && (
        <ul>
          {children.map(child => <TreeRow key={child.artifact.id} node={child} depth={depth + 1} context={context} />)}
        </ul>
      )}
    </li>
  );
}

function ProjectSection({ tree, context }: { readonly tree: ProjectTree; readonly context: RowContext }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <h2 id={headingId} className="flex items-center gap-2 px-1 pb-1 font-heading text-sm font-semibold">
        <FolderGit2 aria-hidden className="size-4 text-muted-foreground" />
        {tree.projectName}
      </h2>
      {tree.features.length > 0 && (
        <ul aria-label={`Features of ${tree.projectName}`} className="flex flex-col">
          {tree.features.map(node => <TreeRow key={node.artifact.id} node={node} depth={0} context={context} />)}
        </ul>
      )}
      {tree.standalone.length > 0 && (
        <>
          <h3 className="px-1 pt-2 text-[11.5px] font-medium tracking-[.05em] text-muted-foreground uppercase">Standalone tasks</h3>
          <ul aria-label={`Standalone tasks of ${tree.projectName}`} className="flex flex-col">
            {tree.standalone.map(node => <TreeRow key={node.artifact.id} node={node} depth={0} context={context} />)}
          </ul>
        </>
      )}
    </section>
  );
}

/** One group per project: its features with their tasks, then the tasks outside any feature. */
export function ArtifactTreeView({ conversationId, artifacts, byId, filter }: {
  readonly conversationId: string;
  readonly artifacts: readonly ArtifactSummary[];
  readonly byId: Readonly<Record<string, ArtifactSummary>>;
  readonly filter: ArtifactFilter;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [unfreezing, setUnfreezing] = useState<ArtifactSummary | null>(null);
  const trees = buildTree(artifacts, filter);
  const context: RowContext = {
    conversationId,
    unfreeze: setUnfreezing,
    artifacts,
    byId,
    collapsed,
    toggle: id => setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    }),
  };

  if (trees.length === 0) {
    return <p className="px-1 py-6 text-center text-sm text-muted-foreground">Nothing matches the filters.</p>;
  }

  return (
    <div className="flex flex-col gap-7">
      {trees.map(tree => <ProjectSection key={tree.projectName} tree={tree} context={context} />)}
      {unfreezing && (
        <ArtifactUnfreezeDialog conversationId={conversationId} artifact={unfreezing} open onOpenChange={open => !open && setUnfreezing(null)} />
      )}
    </div>
  );
}
