import { ARTIFACT_TYPES, type ArtifactType } from '@agent-remote-control/protocol/artifact';
import { SlidersHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';

import { TYPE_LABELS } from '../../artifacts/artifact-labels.js';
import { type ArtifactFilter, EMPTY_FILTER } from '../../artifacts/artifact-tree.js';
import { cn } from '../../lib/utils.js';
import { Button } from '../ui/button.js';
import { Label } from '../ui/label.js';
import { Sheet, SheetClose, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '../ui/sheet.js';
import { Switch } from '../ui/switch.js';

import { ChoiceSelect } from './choice-select.js';


const ALL = '';

type FilterProps = {
  readonly filter: ArtifactFilter;
  readonly projects: readonly string[];
  readonly kanban: boolean;
  /** Whether the kanban shows features; otherwise it shows tasks. */
  readonly featureBoard: boolean;
  readonly onChange: (changes: Partial<ArtifactFilter>) => void;
  readonly onFeatureBoardChange: (featureBoard: boolean) => void;
};

/** The filters set besides the search, which shows on its own; the type counts only on the list, where it applies. */
function activeFilters({ filter, kanban }: Pick<FilterProps, 'filter' | 'kanban'>): number {
  return [filter.project !== null, !kanban && filter.type !== null, filter.hideClosed].filter(Boolean).length;
}

function Field({ label, stacked, children }: { readonly label: string; readonly stacked: boolean; readonly children: ReactNode }) {
  return stacked
    ? (
      <div className="flex flex-col gap-1.5">
        <span aria-hidden className="text-[13px] font-medium">{label}</span>
        {children}
      </div>
    )
    : children;
}

/**
 * Project, type and closed filters and, on the kanban, whether it shows tasks or features: in a row beside the search,
 * or `stacked` with visible labels in the filters sheet.
 */
function FilterControls({ filter, projects, kanban, featureBoard, onChange, onFeatureBoardChange, stacked }: FilterProps & { readonly stacked: boolean }) {
  return (
    <>
      <Field label="Project" stacked={stacked}>
        <ChoiceSelect
          label="Project"
          value={filter.project ?? ALL}
          choices={[{ value: ALL, label: 'All projects' }, ...projects.map(project => ({ value: project, label: project }))]}
          onChange={value => onChange({ project: value || null })}
          className={cn(stacked && 'w-full')}
        />
      </Field>
      {kanban
        ? (
          <Field label="Cards" stacked={stacked}>
            <ChoiceSelect
              label="Cards"
              value={featureBoard ? 'feature' : 'task'}
              choices={[{ value: 'task', label: 'Task cards' }, { value: 'feature', label: 'Feature cards' }]}
              onChange={value => onFeatureBoardChange(value === 'feature')}
              className={cn(stacked && 'w-full')}
            />
          </Field>
        )
        : (
          <Field label="Type" stacked={stacked}>
            <ChoiceSelect
              label="Type"
              value={filter.type ?? ALL}
              choices={[{ value: ALL, label: 'Features and tasks' }, ...ARTIFACT_TYPES.map(type => ({ value: type, label: `${TYPE_LABELS[type]}s` }))]}
              onChange={value => onChange({ type: (value || null) as ArtifactType | null })}
              className={cn(stacked && 'w-full')}
            />
          </Field>
        )}
      <Label className={cn('gap-2 text-[13px] font-normal', stacked ? 'justify-between py-1' : 'text-muted-foreground')}>
        {stacked && 'Hide done and cancelled'}
        <Switch checked={filter.hideClosed} onCheckedChange={hideClosed => onChange({ hideClosed })} size={stacked ? 'default' : 'sm'} />
        {!stacked && 'Hide done and cancelled'}
      </Label>
    </>
  );
}

/** The filters in a row, for a board wide enough to show them beside the search. */
export function InlineArtifactFilters({ className, ...props }: FilterProps & { readonly className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <FilterControls {...props} stacked={false} />
    </div>
  );
}

/** A "Filters" button with the number of active filters, opening them in a bottom sheet, for a narrow board. */
export function ArtifactFiltersSheet({ className, ...props }: FilterProps & { readonly className?: string }) {
  const count = activeFilters(props);
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" className={className} />}>
        <SlidersHorizontal aria-hidden />
        Filters
        {count > 0 && (
          <>
            <span aria-hidden className="rounded-full bg-primary px-1.5 font-mono text-[10.5px] leading-4 text-primary-foreground tabular-nums">{count}</span>
            <span className="sr-only">{`, ${count} active`}</span>
          </>
        )}
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85dvh] gap-2 overflow-y-auto rounded-t-2xl pb-[env(safe-area-inset-bottom)]">
        <SheetHeader className="pb-0">
          <SheetTitle>Filters</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pt-2">
          <FilterControls {...props} stacked />
        </div>
        <SheetFooter className="flex-row">
          <Button
            variant="outline"
            className="flex-1"
            disabled={count === 0}
            onClick={() => props.onChange({ project: EMPTY_FILTER.project, type: EMPTY_FILTER.type, hideClosed: EMPTY_FILTER.hideClosed })}
          >
            Clear filters
          </Button>
          <SheetClose render={<Button className="flex-1" />}>Done</SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
