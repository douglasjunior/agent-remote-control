import {
  ARTIFACT_STATUSES, REFINEMENT_KINDS, type ArtifactDetail, type ArtifactSummary, type ArtifactUpdateInput, type PullRequestState, type RefinementState,
} from '@agent-remote-control/protocol/artifact';
import { FolderGit2, GitBranch, GitMerge, GitPullRequest, GitPullRequestClosed, X, type LucideIcon } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router';

import { REFINEMENT_KIND_LABELS, REFINEMENT_LABELS, STATUS_LABELS } from '../../artifacts/artifact-labels.js';
import { artifactPath } from '../../artifacts/artifact-paths.js';
import { dependencyCandidates, dependentsOf, parentCandidates } from '../../artifacts/artifact-tree.js';
import { formatRelativeTime } from '../../lib/format.js';
import { useNow } from '../../lib/use-now.js';
import { cn } from '../../lib/utils.js';
import { IconButton } from '../icon-button.js';

import { ArtifactStatusBadge } from './artifact-status-badge.js';
import { ArtifactTypeIcon } from './artifact-type-icon.js';
import { ChoiceSelect } from './choice-select.js';


const NONE = '';
const REFINEMENT_CHOICES = Object.entries(REFINEMENT_LABELS).map(([value, label]) => ({ value, label }));
const PULL_REQUEST_ICONS: Readonly<Record<PullRequestState, LucideIcon>> = { open: GitPullRequest, merged: GitMerge, closed: GitPullRequestClosed };

function Property({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <dt className="text-[11.5px] font-medium tracking-[.05em] text-muted-foreground uppercase">{label}</dt>
      <dd className="flex min-w-0 flex-col gap-1.5 text-sm">{children}</dd>
    </div>
  );
}

function ArtifactLink({ conversationId, artifact, onRemove }: {
  readonly conversationId: string;
  readonly artifact: ArtifactSummary;
  readonly onRemove?: () => void;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <ArtifactTypeIcon type={artifact.type} className="size-3.5" />
      <Link to={artifactPath(conversationId, artifact.id)} className="min-w-0 flex-1 truncate rounded-sm hover:underline">
        <span className="mr-1.5 font-mono text-[11.5px] text-muted-foreground">{artifact.id}</span>
        {artifact.title}
      </Link>
      <ArtifactStatusBadge status={artifact.status} />
      {onRemove && (
        <IconButton variant="ghost" size="icon-xs" label={`Remove dependency ${artifact.id}`} onClick={onRemove}>
          <X />
        </IconButton>
      )}
    </span>
  );
}

/** Everything about an artifact besides its text, each property editable where people may change it. */
export function ArtifactProperties({ conversationId, artifact, byId, projects, onChange }: {
  readonly conversationId: string;
  readonly artifact: ArtifactDetail;
  readonly byId: Readonly<Record<string, ArtifactSummary>>;
  readonly projects: readonly string[];
  readonly onChange: (changes: ArtifactUpdateInput) => void;
}) {
  const now = useNow(true);
  const artifacts = Object.values(byId);
  const parents = parentCandidates(artifact.type, artifacts, artifact);
  const projectLocked = artifact.parentId !== null || artifacts.some(other => other.parentId === artifact.id) || artifact.projectNames.length > 1;
  const blocks = dependentsOf(artifact.id, artifacts);
  const dependencyChoices = dependencyCandidates(artifact.type, artifact.parentId, artifacts, artifact.id)
    .filter(sibling => !artifact.dependsOn.includes(sibling.id));
  const projectChoices = [...new Set([...projects, artifact.projectNames[0]!])];

  return (
    <dl className="flex flex-col gap-5">
      <Property label="Status">
        <ChoiceSelect
          label="Status"
          value={artifact.status}
          choices={ARTIFACT_STATUSES.map(status => ({ value: status, label: STATUS_LABELS[status] }))}
          onChange={status => onChange({ status: status as ArtifactDetail['status'] })}
          className="w-full"
        />
      </Property>
      <Property label="Refinement">
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5">
          {REFINEMENT_KINDS.map(kind => (
            <Fragment key={kind}>
              <span className="text-[13px] text-muted-foreground">{REFINEMENT_KIND_LABELS[kind]}</span>
              <ChoiceSelect
                label={`${REFINEMENT_KIND_LABELS[kind]} refinement`}
                size="sm"
                value={artifact.refinement[kind]}
                choices={REFINEMENT_CHOICES}
                onChange={state => onChange({ refinement: { [kind]: state as RefinementState } })}
                className="w-full"
              />
            </Fragment>
          ))}
        </div>
      </Property>
      <Property label="Project">
        {projectLocked
          ? (
            <span className="flex items-center gap-1.5" title={artifact.parentId ? 'A project of its feature' : 'Shared with the tasks of the feature'}>
              <FolderGit2 aria-hidden className="size-3.5 text-muted-foreground" />
              {artifact.projectNames.join(', ')}
            </span>
          )
          : (
            <ChoiceSelect
              label="Project"
              value={artifact.projectNames[0]}
              choices={projectChoices.map(project => ({ value: project, label: project }))}
              onChange={projectName => onChange(artifact.type === 'feature' ? { projectNames: [projectName] } : { projectName })}
              className="w-full"
            />
          )}
      </Property>
      {artifact.type === 'task' && (
        <Property label="Feature">
          <ChoiceSelect
            label="Feature"
            value={artifact.parentId ?? NONE}
            choices={[{ value: NONE, label: 'Standalone task' }, ...parents.map(parent => ({ value: parent.id, label: `${parent.id} · ${parent.title}` }))]}
            onChange={parentId => onChange({ parentId: parentId || null })}
            className="w-full"
          />
        </Property>
      )}
      <Property label="Depends on">
        {artifact.dependsOn.map(id => (byId[id]
          ? <ArtifactLink key={id} conversationId={conversationId} artifact={byId[id]} onRemove={() => onChange({ dependsOn: artifact.dependsOn.filter(other => other !== id) })} />
          : <span key={id} className="font-mono text-[12.5px] text-muted-foreground">{id}</span>))}
        <ChoiceSelect
          label="Add a dependency"
          size="sm"
          value={NONE}
          choices={[{ value: NONE, label: 'Add a dependency…' }, ...dependencyChoices.map(sibling => ({ value: sibling.id, label: `${sibling.id} · ${sibling.title}` }))]}
          onChange={id => id && onChange({ dependsOn: [...artifact.dependsOn, id] })}
          className="w-full"
          disabled={dependencyChoices.length === 0}
        />
      </Property>
      {blocks.length > 0 && (
        <Property label="Blocks">
          {blocks.map(dependent => <ArtifactLink key={dependent.id} conversationId={conversationId} artifact={dependent} />)}
        </Property>
      )}
      {artifact.branch && (
        <Property label="Branch">
          <span className="flex items-center gap-1.5 font-mono text-[12.5px]">
            <GitBranch aria-hidden className="size-3.5 text-muted-foreground" />
            <span className="truncate">{artifact.branch}</span>
          </span>
        </Property>
      )}
      {artifact.pullRequests.length > 0 && (
        <Property label="Pull requests">
          {artifact.pullRequests.map((pullRequest) => {
            const Icon = PULL_REQUEST_ICONS[pullRequest.state];
            return (
              <a
                key={pullRequest.url}
                href={pullRequest.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${pullRequest.title ?? pullRequest.url}, ${pullRequest.state}`}
                className="flex min-w-0 items-center gap-1.5 rounded-sm hover:underline"
              >
                <Icon aria-hidden className={cn('size-3.5 shrink-0 text-muted-foreground', pullRequest.state === 'merged' && 'text-(--agent-product-owner)')} />
                <span className="truncate">{pullRequest.title ?? pullRequest.url}</span>
                {pullRequest.repository !== '.' && <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground">{pullRequest.repository}</span>}
              </a>
            );
          })}
        </Property>
      )}
      <Property label="Dates">
        <span className="text-[13px] text-muted-foreground">
          {`Created ${formatRelativeTime(artifact.createdAt, now)} · updated ${formatRelativeTime(artifact.updatedAt, now)}`}
        </span>
      </Property>
    </dl>
  );
}
