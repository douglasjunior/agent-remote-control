import { ARTIFACT_TYPES, type ArtifactType } from '@agent-remote-control/protocol/artifact';
import { X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { TYPE_LABELS } from '../../artifacts/artifact-labels.js';
import { dependencyCandidates, parentCandidates } from '../../artifacts/artifact-tree.js';
import { useBoard } from '../../artifacts/use-board.js';
import { IconButton } from '../icon-button.js';
import { Button } from '../ui/button.js';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog.js';
import { Input } from '../ui/input.js';
import { Label } from '../ui/label.js';
import { Switch } from '../ui/switch.js';
import { Textarea } from '../ui/textarea.js';

import { ChoiceSelect } from './choice-select.js';


const NONE = '';

function RefinementSwitch({ id, checked, onChange, title, description }: {
  readonly id: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly title: string;
  readonly description: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/30 px-3 py-2.5">
      <Label htmlFor={id} className="flex-col items-start gap-1">
        <span>{title}</span>
        <span className="text-xs font-normal text-muted-foreground">{description}</span>
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} className="mt-0.5" />
    </div>
  );
}

/**
 * Creates a feature or a task on the board of a conversation. Both refinements off means a simple task the Coordinator
 * hands straight to the Developer.
 */
export function ArtifactCreateDialog({ conversationId, open, onOpenChange, defaultParentId }: {
  readonly conversationId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly defaultParentId?: string;
}) {
  const { board, projects, createArtifact } = useBoard(conversationId);
  const artifacts = Object.values(board.byId);
  const [type, setType] = useState<ArtifactType>('task');
  const [title, setTitle] = useState('');
  const [parentId, setParentId] = useState(defaultParentId ?? NONE);
  const [chosenProject, setChosenProject] = useState(NONE);
  const [dependsOn, setDependsOn] = useState<readonly string[]>([]);
  const [overview, setOverview] = useState('');
  const [business, setBusiness] = useState(true);
  const [technical, setTechnical] = useState(true);
  const [saving, setSaving] = useState(false);

  const parents = parentCandidates(type, artifacts);
  const effectiveParent = parents.some(parent => parent.id === parentId) ? parentId : NONE;
  const parentProject = effectiveParent ? board.byId[effectiveParent].projectName : undefined;
  const projectName = parentProject ?? chosenProject;
  const dependencyChoices = dependencyCandidates(type, effectiveParent || null, artifacts).filter(sibling => !dependsOn.includes(sibling.id));

  /** Dependencies join siblings only, so changing the type or feature drops the ones outside the new level. */
  const changeLevel = (nextType: ArtifactType, nextParentId: string) => {
    const siblings = dependencyCandidates(nextType, nextType === 'task' ? nextParentId || null : null, artifacts).map(sibling => sibling.id);
    setType(nextType);
    setParentId(nextParentId);
    setDependsOn(dependsOn.filter(id => siblings.includes(id)));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const result = await createArtifact({
      type,
      title: title.trim(),
      ...(effectiveParent ? { parentId: effectiveParent } : { projectName }),
      dependsOn: [...dependsOn],
      ...(overview.trim() && { sections: { overview: overview.trim() } }),
      businessRefinement: business,
      technicalRefinement: technical,
    });
    setSaving(false);
    if (result.ok) {
      toast.success(`${result.id} created`);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{type === 'feature' ? 'New feature' : 'New task'}</DialogTitle>
          <DialogDescription>Describe what needs to be done. The Coordinator moves it through the team by its status.</DialogDescription>
        </DialogHeader>
        <form id="artifact-create" onSubmit={event => void submit(event)} className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Type</span>
              <ChoiceSelect
                label="Type"
                value={type}
                choices={ARTIFACT_TYPES.map(value => ({ value, label: TYPE_LABELS[value] }))}
                onChange={value => changeLevel(value as ArtifactType, parentId)}
                className="w-full"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="artifact-title">Title</Label>
              <Input id="artifact-title" value={title} onChange={event => setTitle(event.target.value)} placeholder="What should be delivered?" autoFocus />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {type === 'task' && (
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Feature</span>
                <ChoiceSelect
                  label="Feature"
                  value={effectiveParent}
                  choices={[{ value: NONE, label: 'Standalone task' }, ...parents.map(parent => ({ value: parent.id, label: `${parent.id} · ${parent.title}` }))]}
                  onChange={id => changeLevel(type, id)}
                  className="w-full"
                />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Project</span>
              <ChoiceSelect
                label="Project"
                value={projectName}
                choices={[
                  ...(projectName === NONE ? [{ value: NONE, label: 'Choose a project' }] : []),
                  ...[...new Set([...projects, ...(parentProject ? [parentProject] : [])])].map(project => ({ value: project, label: project })),
                ]}
                onChange={setChosenProject}
                className="w-full"
                disabled={parentProject !== undefined}
              />
              {parentProject !== undefined && <span className="text-xs text-muted-foreground">The project of its feature.</span>}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Depends on</span>
            {dependsOn.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {dependsOn.map(id => (
                  <li key={id} className="inline-flex items-center gap-1 rounded-md bg-muted py-0.5 pr-0.5 pl-2 text-xs">
                    <span className="font-mono">{id}</span>
                    <span className="max-w-40 truncate text-muted-foreground">{board.byId[id]?.title}</span>
                    <IconButton type="button" variant="ghost" size="icon-xs" label={`Remove dependency ${id}`} onClick={() => setDependsOn(dependsOn.filter(other => other !== id))}>
                      <X />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
            <ChoiceSelect
              label="Add a dependency"
              value={NONE}
              choices={[{ value: NONE, label: 'Add a dependency…' }, ...dependencyChoices.map(sibling => ({ value: sibling.id, label: `${sibling.id} · ${sibling.title}` }))]}
              onChange={id => id && setDependsOn([...dependsOn, id])}
              className="w-full"
              disabled={dependencyChoices.length === 0}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="artifact-overview">Overview</Label>
            <Textarea
              id="artifact-overview"
              value={overview}
              onChange={event => setOverview(event.target.value)}
              placeholder="Context, the problem and the expected outcome. Markdown is welcome."
              className="max-h-64 min-h-24"
            />
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-medium">Refinement</legend>
            <RefinementSwitch
              id="artifact-business-refinement"
              checked={business}
              onChange={setBusiness}
              title="Business refinement by the Product Owner"
              description="Rules, user stories, acceptance criteria and test cases, discussed with you."
            />
            <RefinementSwitch
              id="artifact-technical-refinement"
              checked={technical}
              onChange={setTechnical}
              title="Technical refinement by the Tech Lead"
              description="The technical solution, before any code is written."
            />
            {!business && !technical && (
              <p className="text-xs text-muted-foreground">A simple item: it goes straight to the Developer.</p>
            )}
          </fieldset>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="artifact-create" disabled={saving || title.trim() === '' || projectName === NONE}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
