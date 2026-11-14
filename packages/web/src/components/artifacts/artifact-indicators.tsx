import type { ArtifactSummary } from '@agent-remote-control/protocol/artifact';
import { FolderGit2, GitPullRequest, Hourglass } from 'lucide-react';

import { pendingDependencies } from '../../artifacts/artifact-tree.js';
import { cn } from '../../lib/utils.js';


const CHIP = 'inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] leading-none text-muted-foreground';

export function ProjectChip({ projectName }: { readonly projectName: string }) {
  return (
    <span className={cn(CHIP, 'bg-muted/70')} title={`Project ${projectName}`}>
      <FolderGit2 aria-hidden className="size-3" />
      <span className="max-w-32 truncate">{projectName}</span>
    </span>
  );
}

/** Shown only while some dependency is not done: the artifact should wait for it. */
export function WaitingChip({ artifact, byId }: {
  readonly artifact: ArtifactSummary;
  readonly byId: Readonly<Record<string, ArtifactSummary>>;
}) {
  const waiting = pendingDependencies(artifact, byId);
  if (waiting.length === 0) {
    return null;
  }
  const label = `Waiting on ${waiting.join(', ')}`;
  return (
    <span className={cn(CHIP, 'bg-attention/12 text-foreground')} title={label} aria-label={label}>
      <Hourglass aria-hidden className="size-3 text-attention" />
      {waiting.length}
    </span>
  );
}

export function PullRequestChip({ artifact }: { readonly artifact: ArtifactSummary }) {
  const count = artifact.pullRequests.length;
  if (count === 0) {
    return null;
  }
  const label = count === 1 ? '1 pull request' : `${count} pull requests`;
  return (
    <span className={cn(CHIP, 'bg-muted/70')} title={label} aria-label={label}>
      <GitPullRequest aria-hidden className="size-3" />
      {count}
    </span>
  );
}
