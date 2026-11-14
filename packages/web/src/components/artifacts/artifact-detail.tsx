import { ARTIFACT_SECTIONS, type ArtifactDetail as Detail, type ArtifactSection, type ArtifactStatus, type ArtifactUpdateInput } from '@agent-remote-control/protocol/artifact';
import { ChevronRight, Pencil, Plus, Snowflake, Trash2 } from 'lucide-react';
import { useState, type CSSProperties, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';

import { SECTION_LABELS, TYPE_LABELS } from '../../artifacts/artifact-labels.js';
import { artifactPath, boardPath } from '../../artifacts/artifact-paths.js';
import { childrenOf, taskProgress } from '../../artifacts/artifact-tree.js';
import { useBoard } from '../../artifacts/use-board.js';
import { agentIdentity } from '../../lib/agent-identity.js';
import { formatRelativeTime } from '../../lib/format.js';
import { useNow } from '../../lib/use-now.js';
import { AgentMark } from '../agent/agent-mark.js';
import { IconButton } from '../icon-button.js';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '../ui/alert-dialog.js';
import { Button } from '../ui/button.js';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '../ui/dropdown-menu.js';
import { Input } from '../ui/input.js';

import { ArtifactActivity } from './artifact-activity.js';
import { ArtifactCreateDialog } from './artifact-create-dialog.js';
import { ArtifactProperties } from './artifact-properties.js';
import { ArtifactSectionCard } from './artifact-section.js';
import { ArtifactStatusBadge } from './artifact-status-badge.js';
import { ArtifactTypeIcon } from './artifact-type-icon.js';
import { ArtifactUnfreezeDialog } from './artifact-unfreeze-dialog.js';


function Title({ artifact, onRename }: { readonly artifact: Detail; readonly onRename: (title: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState<string | null>(null);

  const submit = async (event: FormEvent, title: string) => {
    event.preventDefault();
    if (await onRename(title.trim())) {
      setDraft(null);
    }
  };

  if (draft === null) {
    return (
      <div className="group/title flex min-w-0 items-start gap-1">
        <h1 className="min-w-0 font-heading text-xl leading-tight font-semibold text-balance sm:text-2xl">{artifact.title}</h1>
        <IconButton variant="ghost" size="icon-sm" label="Rename" onClick={() => setDraft(artifact.title)} className="opacity-60 group-hover/title:opacity-100 focus-visible:opacity-100">
          <Pencil />
        </IconButton>
      </div>
    );
  }
  return (
    <form onSubmit={event => void submit(event, draft)} className="flex flex-wrap items-center gap-2">
      <Input aria-label="Title" value={draft} onChange={event => setDraft(event.target.value)} className="h-9 min-w-0 flex-1 text-base" autoFocus />
      <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
      <Button type="submit" size="sm" disabled={draft.trim() === ''}>Save</Button>
    </form>
  );
}

/** Who holds the artifact right now: it stays with one agent until that agent's delegation ends. */
function Presence({ artifact }: { readonly artifact: Detail }) {
  const now = useNow(artifact.assignee !== null);
  if (!artifact.assignee) {
    return null;
  }
  const { role, roleName, since } = artifact.assignee;
  const { label, color } = agentIdentity(role, roleName);
  return (
    <div
      role="status"
      style={{ '--c': color } as CSSProperties}
      className="flex items-center gap-3 rounded-2xl border border-[color-mix(in_oklab,var(--c)_40%,var(--border))] bg-[color-mix(in_oklab,var(--c)_8%,var(--card))] px-3.5 py-2.5"
    >
      <AgentMark role={role} roleName={roleName} state="working" size="md" />
      <div className="flex min-w-0 flex-col">
        <span className="text-sm font-medium">{`${label} is working on it`}</span>
        <span className="text-xs text-muted-foreground">{`Picked it up ${formatRelativeTime(since, now)}`}</span>
      </div>
    </div>
  );
}

function Tasks({ conversationId, artifact, onAdd }: {
  readonly conversationId: string;
  readonly artifact: Detail;
  readonly onAdd: () => void;
}) {
  const { board } = useBoard(conversationId);
  const artifacts = Object.values(board.byId);
  const children = childrenOf(artifact.id, artifacts);
  const { done, total } = taskProgress(artifact.id, artifacts);
  return (
    <section aria-labelledby="artifact-children" className="flex flex-col gap-2 rounded-2xl border bg-card px-4 py-3">
      <header className="flex items-center gap-2">
        <h3 id="artifact-children" className="font-heading text-sm font-semibold">Tasks</h3>
        {total > 0 && <span className="font-mono text-[11.5px] text-muted-foreground tabular-nums">{`${done}/${total} tasks done`}</span>}
        <Button size="xs" variant="ghost" className="ml-auto" onClick={onAdd}>
          <Plus />
          Add task
        </Button>
      </header>
      {children.length === 0
        ? <p className="text-sm text-muted-foreground">No tasks yet.</p>
        : (
          <ul className="flex flex-col">
            {children.map(child => (
              <li key={child.id} className="flex min-w-0 items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-accent/60">
                <ArtifactTypeIcon type={child.type} />
                <span className="font-mono text-[11.5px] text-muted-foreground">{child.id}</span>
                <Link to={artifactPath(conversationId, child.id)} className="min-w-0 flex-1 truncate text-sm hover:underline">{child.title}</Link>
                <ArtifactStatusBadge status={child.status} />
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

function FrozenBanner({ onUnfreeze }: { readonly onUnfreeze: () => void }) {
  return (
    <div
      role="note"
      aria-label="Frozen"
      className="flex flex-wrap items-center gap-3 rounded-2xl border border-frozen/45 bg-[color-mix(in_oklab,var(--frozen)_10%,var(--card))] px-3.5 py-2.5"
    >
      <span className="grid size-[34px] shrink-0 place-items-center rounded-full bg-[color-mix(in_oklab,var(--frozen)_18%,transparent)] text-frozen">
        <Snowflake aria-hidden className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">Frozen after too many delegations</span>
        <span className="text-xs text-muted-foreground">The agents kept going around in circles on it, so no agent can pick it up until you move it on.</span>
      </div>
      <Button size="sm" variant="outline" onClick={onUnfreeze}>Unfreeze</Button>
    </div>
  );
}

function DeleteButton({ artifact, onDelete }: { readonly artifact: Detail; readonly onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton variant="ghost" label="Delete" onClick={() => setOpen(true)} className="text-muted-foreground hover:text-destructive">
        <Trash2 />
      </IconButton>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{`Delete ${artifact.id}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {`"${artifact.title}" and its history are removed for good. Setting the status to Cancelled keeps the record instead.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** A feature or a task in full: its text by section, its properties, the tasks of a feature and its activity. */
export function ArtifactDetail({ conversationId, artifact }: { readonly conversationId: string; readonly artifact: Detail }) {
  const { board, projects, updateArtifact, commentArtifact, deleteArtifact } = useBoard(conversationId);
  const navigate = useNavigate();
  const [adding, setAdding] = useState<ArtifactSection | null>(null);
  const [creatingChild, setCreatingChild] = useState(false);
  const [unfreezeTo, setUnfreezeTo] = useState<ArtifactStatus | null>(null);
  const parent = artifact.parentId ? board.byId[artifact.parentId] : undefined;
  const filled = ARTIFACT_SECTIONS.filter(section => (artifact.sections[section] ?? '').trim() !== '');
  const empty = ARTIFACT_SECTIONS.filter(section => !filled.includes(section) && section !== adding);
  const shown = ARTIFACT_SECTIONS.filter(section => filled.includes(section) || section === adding);

  const update = async (changes: ArtifactUpdateInput) => (await updateArtifact(artifact.id, changes)).ok;
  /** Leaving Frozen goes through its dialog, which also offers an instruction for the coordinator. */
  const change = (changes: ArtifactUpdateInput) => {
    if (artifact.status === 'frozen' && changes.status && changes.status !== 'frozen') {
      setUnfreezeTo(changes.status);
      return;
    }
    void update(changes);
  };
  const remove = async () => {
    if ((await deleteArtifact(artifact.id)).ok) {
      void navigate(boardPath(conversationId));
    }
  };

  return (
    <article className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-5 sm:px-5">
      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-wrap items-center gap-1 text-[13px] text-muted-foreground">
        <Link to={boardPath(conversationId)} className="rounded-sm hover:text-foreground">Tasks</Link>
        {parent && (
          <span className="flex min-w-0 items-center gap-1">
            <ChevronRight aria-hidden className="size-3.5 shrink-0" />
            <Link to={artifactPath(conversationId, parent.id)} className="max-w-48 truncate rounded-sm hover:text-foreground">{parent.title}</Link>
          </span>
        )}
      </nav>
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <ArtifactTypeIcon type={artifact.type} />
          <span className="font-mono text-[12.5px] text-muted-foreground">{`${TYPE_LABELS[artifact.type]} ${artifact.id}`}</span>
          <ArtifactStatusBadge status={artifact.status} />
          <span className="ml-auto">
            <DeleteButton artifact={artifact} onDelete={() => void remove()} />
          </span>
        </div>
        <Title artifact={artifact} onRename={title => update({ title })} />
        <Presence artifact={artifact} />
        {artifact.status === 'frozen' && <FrozenBanner onUnfreeze={() => setUnfreezeTo('ready')} />}
      </header>
      <div className="grid gap-8 @3xl:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="flex min-w-0 flex-col gap-3">
          {artifact.type === 'feature' && <Tasks conversationId={conversationId} artifact={artifact} onAdd={() => setCreatingChild(true)} />}
          {shown.map(section => (
            <ArtifactSectionCard
              key={section}
              section={section}
              text={artifact.sections[section] ?? ''}
              startEditing={section === adding}
              onClose={() => setAdding(null)}
              onSave={text => update({ sections: { [section]: text } })}
            />
          ))}
          {shown.length === 0 && <p className="text-sm text-muted-foreground">No description yet. Add a section, or let the Product Owner and the Tech Lead refine it.</p>}
          {empty.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="self-start border-dashed" />}>
                <Plus />
                Add section
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {empty.map(section => (
                  <DropdownMenuItem key={section} onClick={() => setAdding(section)}>{SECTION_LABELS[section]}</DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <div className="mt-4">
            <ArtifactActivity history={artifact.history} onComment={async text => (await commentArtifact(artifact.id, text)).ok} />
          </div>
        </div>
        <aside aria-label="Properties" className="order-first @3xl:order-none">
          <ArtifactProperties conversationId={conversationId} artifact={artifact} byId={board.byId} projects={projects} onChange={changes => void change(changes)} />
        </aside>
      </div>
      {unfreezeTo && (
        <ArtifactUnfreezeDialog
          conversationId={conversationId}
          artifact={artifact}
          defaultStatus={unfreezeTo}
          open
          onOpenChange={open => !open && setUnfreezeTo(null)}
        />
      )}
      {creatingChild && <ArtifactCreateDialog conversationId={conversationId} open defaultParentId={artifact.id} onOpenChange={setCreatingChild} />}
    </article>
  );
}
