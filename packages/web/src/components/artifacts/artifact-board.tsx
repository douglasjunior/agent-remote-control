import type { ArtifactStatus } from '@agent-remote-control/protocol/artifact';
import { ListTodo, ListTree, Plus, Search, SquareKanban } from 'lucide-react';
import { useState } from 'react';

import { type ArtifactFilter, EMPTY_FILTER } from '../../artifacts/artifact-tree.js';
import { useBoard } from '../../artifacts/use-board.js';
import { useStoredFlag } from '../../lib/use-stored-flag.js';
import { IconButton } from '../icon-button.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group.js';

import { ArtifactCreateDialog } from './artifact-create-dialog.js';
import { ArtifactFiltersSheet, InlineArtifactFilters } from './artifact-filters.js';
import { ArtifactKanban } from './artifact-kanban.js';
import { ArtifactTreeView } from './artifact-tree-view.js';


const SEGMENT = 'h-7 gap-1.5 rounded-md px-2.5 text-[13px] font-normal text-muted-foreground hover:bg-transparent aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-xs [&_svg]:size-3.5';

/** List or kanban; the labels show once the board is wide enough, and name the choices for assistive technology before. */
function ViewSwitch({ kanban, onChange }: { readonly kanban: boolean; readonly onChange: (kanban: boolean) => void }) {
  return (
    <ToggleGroup
      aria-label="View"
      value={[kanban ? 'kanban' : 'list']}
      onValueChange={([view]) => view !== undefined && onChange(view === 'kanban')}
      spacing={0.5}
      className="shrink-0 bg-muted p-0.5"
    >
      <ToggleGroupItem value="list" className={SEGMENT}>
        <ListTree aria-hidden />
        <span className="sr-only @sm:not-sr-only">List</span>
      </ToggleGroupItem>
      <ToggleGroupItem value="kanban" className={SEGMENT}>
        <SquareKanban aria-hidden />
        <span className="sr-only @sm:not-sr-only">Kanban</span>
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

function EmptyState({ onCreate }: { readonly onCreate: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground"><ListTodo aria-hidden /></span>
      <div className="flex flex-col gap-1">
        <p className="font-heading text-base font-medium">No tasks yet</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Create one here, or tell the CEO what you need: the Product Owner turns ideas into features and tasks.
        </p>
      </div>
      <Button onClick={onCreate}>
        <Plus />
        New task
      </Button>
    </div>
  );
}

/**
 * The features and tasks of a conversation's mission, as a list grouped by project or as a board of tasks by status.
 * Its width depends on the side panels, so it lays out by container queries: below `@2xl` the filters fold into a
 * sheet.
 */
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
  const filters = { filter, projects, kanban, featureBoard, onChange: change, onFeatureBoardChange: setFeatureBoard };

  return (
    <div className="@container h-full">
      <div className="flex h-full flex-col gap-3 overflow-hidden px-4 pt-4 @2xl:gap-4 @2xl:px-5">
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            <h3 className="truncate font-heading text-base font-semibold">Mission board</h3>
            {board.loaded && <span className="text-sm text-muted-foreground tabular-nums">{artifacts.length}</span>}
          </div>
          <ViewSwitch kanban={kanban} onChange={setKanban} />
        </div>
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1 @2xl:w-60 @2xl:flex-none">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search tasks"
              placeholder="Search by id or title"
              value={filter.text}
              onChange={event => change({ text: event.target.value })}
              className="pl-8"
            />
          </div>
          <ArtifactFiltersSheet {...filters} className="shrink-0 @2xl:hidden" />
          <InlineArtifactFilters {...filters} className="hidden @2xl:flex" />
          <IconButton label="New" className="shrink-0 @2xl:ml-auto @2xl:w-auto @2xl:px-2.5" onClick={create}>
            <Plus />
            <span className="hidden @2xl:inline">New</span>
          </IconButton>
        </div>
        {!board.loaded && <p className="text-sm text-muted-foreground">Loading tasks…</p>}
        {board.loaded && artifacts.length === 0 && <EmptyState onCreate={create} />}
        {board.loaded && artifacts.length > 0 && (kanban
          ? <ArtifactKanban conversationId={conversationId} type={featureBoard ? 'feature' : 'task'} artifacts={artifacts} byId={board.byId} filter={{ ...filter, type: null }} onMove={move} />
          : (
            <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2 pb-6">
              <ArtifactTreeView conversationId={conversationId} artifacts={artifacts} byId={board.byId} filter={filter} />
            </div>
          ))}
        {creating && <ArtifactCreateDialog conversationId={conversationId} open onOpenChange={setCreating} />}
      </div>
    </div>
  );
}
