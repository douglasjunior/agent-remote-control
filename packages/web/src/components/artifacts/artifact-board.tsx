import { ARTIFACT_TYPES, type ArtifactStatus, type ArtifactType } from '@agent-remote-control/protocol/artifact';
import { Layers, ListTodo, ListTree, Plus, Search, SquareCheck, SquareKanban } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { TYPE_LABELS } from '../../artifacts/artifact-labels.js';
import { type ArtifactFilter, EMPTY_FILTER } from '../../artifacts/artifact-tree.js';
import { useBoard } from '../../artifacts/use-board.js';
import { useStoredFlag } from '../../lib/use-stored-flag.js';
import { cn } from '../../lib/utils.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { Label } from '../ui/label.js';
import { Switch } from '../ui/switch.js';

import { ArtifactCreateDialog } from './artifact-create-dialog.js';
import { ArtifactKanban } from './artifact-kanban.js';
import { ArtifactTreeView } from './artifact-tree-view.js';
import { ChoiceSelect } from './choice-select.js';


const ALL = '';

/** Two choices side by side, the active one raised; `label` names the group. */
function Toggle({ label, value, onChange, options }: {
  readonly label: string;
  readonly value: boolean;
  readonly onChange: (value: boolean) => void;
  readonly options: readonly [off: { label: string; icon: ReactNode }, on: { label: string; icon: ReactNode }];
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg bg-muted p-0.5">
      {options.map((option, index) => {
        const active = value === (index === 1);
        return (
          <button
            key={option.label}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(index === 1)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:size-3.5',
              active && 'bg-background text-foreground shadow-xs',
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function EmptyState({ onCreate }: { readonly onCreate: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground"><ListTodo aria-hidden /></span>
      <div className="flex flex-col gap-1">
        <p className="font-heading text-base font-medium">No tasks yet</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Create one here, or tell the Coordinator what you need: the Product Owner turns ideas into features and tasks.
        </p>
      </div>
      <Button onClick={onCreate}>
        <Plus />
        New task
      </Button>
    </div>
  );
}

/** The features and tasks of a conversation's mission, as a list grouped by project or as a board of tasks by status. */
export function ArtifactBoard({ conversationId }: { readonly conversationId: string }) {
  const { board, projects, updateArtifact } = useBoard(conversationId);
  const [kanban, setKanban] = useStoredFlag('arc.artifactsBoard', false);
  const [featureBoard, setFeatureBoard] = useStoredFlag('arc.artifactsBoardFeatures', false);
  const [filter, setFilter] = useState<ArtifactFilter>(EMPTY_FILTER);
  const [creating, setCreating] = useState(false);
  const artifacts = Object.values(board.byId);
  const change = (changes: Partial<ArtifactFilter>) => setFilter({ ...filter, ...changes });
  const create = () => setCreating(true);
  const move = (id: string, status: ArtifactStatus) => void updateArtifact(id, { status });

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden px-4 pt-4 sm:px-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h3 className="font-heading text-base font-semibold whitespace-nowrap">Mission board</h3>
          {board.loaded && <span className="text-sm text-muted-foreground tabular-nums">{artifacts.length}</span>}
        </div>
        {kanban && (
          <Toggle
            label="Board of"
            value={featureBoard}
            onChange={setFeatureBoard}
            options={[{ label: 'Tasks', icon: <SquareCheck aria-hidden /> }, { label: 'Features', icon: <Layers aria-hidden /> }]}
          />
        )}
        <Toggle
          label="View"
          value={kanban}
          onChange={setKanban}
          options={[{ label: 'List', icon: <ListTree aria-hidden /> }, { label: 'Board', icon: <SquareKanban aria-hidden /> }]}
        />
        <Button size="sm" onClick={create}>
          <Plus />
          New
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-60">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search tasks"
            placeholder="Search by id or title"
            value={filter.text}
            onChange={event => change({ text: event.target.value })}
            className="pl-8"
          />
        </div>
        <ChoiceSelect
          label="Project"
          value={filter.project ?? ALL}
          choices={[{ value: ALL, label: 'All projects' }, ...projects.map(project => ({ value: project, label: project }))]}
          onChange={value => change({ project: value || null })}
        />
        {!kanban && (
          <ChoiceSelect
            label="Type"
            value={filter.type ?? ALL}
            choices={[{ value: ALL, label: 'Features and tasks' }, ...ARTIFACT_TYPES.map(type => ({ value: type, label: `${TYPE_LABELS[type]}s` }))]}
            onChange={value => change({ type: (value || null) as ArtifactType | null })}
          />
        )}
        <Label className="ml-auto gap-2 text-[13px] font-normal text-muted-foreground">
          <Switch checked={filter.hideClosed} onCheckedChange={hideClosed => change({ hideClosed })} size="sm" />
          Hide done and cancelled
        </Label>
      </div>
      {!board.loaded && <p className="text-sm text-muted-foreground">Loading tasks…</p>}
      {board.loaded && artifacts.length === 0 && <EmptyState onCreate={create} />}
      {board.loaded && artifacts.length > 0 && (kanban
        ? <ArtifactKanban conversationId={conversationId} type={featureBoard ? 'feature' : 'task'} artifacts={artifacts} byId={board.byId} filter={filter} onMove={move} />
        : (
          <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2 pb-6">
            <ArtifactTreeView conversationId={conversationId} artifacts={artifacts} byId={board.byId} filter={filter} />
          </div>
        ))}
      {creating && <ArtifactCreateDialog conversationId={conversationId} open onOpenChange={setCreating} />}
    </div>
  );
}
