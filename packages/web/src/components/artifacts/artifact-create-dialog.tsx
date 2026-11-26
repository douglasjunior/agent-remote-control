import { ARTIFACT_TYPES, REFINEMENT_KINDS, type ArtifactType, type RefinementKind } from '@agent-remote-control/protocol/artifact';
import { FolderGit2, X } from 'lucide-react';
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
import { ProjectsSelect } from './projects-select.js';


const NONE = '';

const REFINEMENT_SWITCHES: Readonly<Record<RefinementKind, { readonly title: string; readonly description: string; readonly owedByDefault: boolean }>> = {
  business: {
    title: 'Business refinement by the Product Owner',
    description: 'Rules, user stories, acceptance criteria and test cases, discussed with you.',
    owedByDefault: true,
  },
  design: {
    title: 'Design refinement by the UX Designer',
    description: 'Screens, states and a working prototype to approve before it is built.',
    owedByDefault: false,
  },
  technical: {
    title: 'Technical refinement by the Tech Lead',
    description: 'The technical solution, before any code is written.',
    owedByDefault: true,
  },
};

const DEFAULT_REFINEMENTS = Object.fromEntries(REFINEMENT_KINDS.map(kind => [kind, REFINEMENT_SWITCHES[kind].owedByDefault])) as Record<RefinementKind, boolean>;

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
 * The project of a task: the only one of its feature when that feature links a single project, otherwise a required
 * pick among the feature's projects, or among all of them for a standalone task.
 */
function TaskProject({ featureProjects, projects, value, onChange }: {
  readonly featureProjects: readonly string[] | undefined;
  readonly projects: readonly string[];
  readonly value: string;
  readonly onChange: (project: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">Project</span>
      {featureProjects?.length === 1
        ? (
          <>
            <span className="flex h-8 items-center gap-1.5 text-sm">
              <FolderGit2 aria-hidden className="size-3.5 text-muted-foreground" />
              {featureProjects[0]}
            </span>
            <span className="text-xs text-muted-foreground">The project of its feature.</span>
          </>
        )
        : (
          <>
            <ChoiceSelect
              label="Project"
              value={value}
              choices={[...(value === NONE ? [{ value: NONE, label: 'Choose a project' }] : []), ...(featureProjects ?? projects).map(project => ({ value: project, label: project }))]}
              onChange={onChange}
              className="w-full"
            />
            {featureProjects && <span className="text-xs text-muted-foreground">One of the projects of its feature.</span>}
          </>
        )}
    </div>
  );
}

/**
 * Creates a feature or a task on the board of a conversation. Every refinement off means a simple task the CEO
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
  const [chosenProjects, setChosenProjects] = useState<readonly string[]>([]);
  const [dependsOn, setDependsOn] = useState<readonly string[]>([]);
  const [overview, setOverview] = useState('');
  const [refinements, setRefinements] = useState(DEFAULT_REFINEMENTS);
  const [saving, setSaving] = useState(false);

  const parents = parentCandidates(type, artifacts);
  const effectiveParent = parents.some(parent => parent.id === parentId) ? parentId : NONE;
  const parentProjects = effectiveParent ? board.byId[effectiveParent].projectNames : undefined;
  const projectName = parentProjects?.length === 1 ? parentProjects[0] : chosenProject;
  const dependencyChoices = dependencyCandidates(type, effectiveParent || null, artifacts).filter(sibling => !dependsOn.includes(sibling.id));

  /** Dependencies join siblings only, so changing the type or feature drops the ones outside the new level. */
  const changeLevel = (nextType: ArtifactType, nextParentId: string) => {
    const siblings = dependencyCandidates(nextType, nextType === 'task' ? nextParentId || null : null, artifacts).map(sibling => sibling.id);
    setType(nextType);
    setParentId(nextParentId);
    if (nextParentId !== parentId) {
      setChosenProject(NONE);
    }
    setDependsOn(dependsOn.filter(id => siblings.includes(id)));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const result = await createArtifact({
      type,
      title: title.trim(),
      ...(effectiveParent ? { parentId: effectiveParent } : {}),
      ...(type === 'feature' ? { projectNames: [...chosenProjects] } : { projectName }),
      dependsOn: [...dependsOn],
      ...(overview.trim() && { sections: { overview: overview.trim() } }),
      refinements,
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
          <DialogDescription>Describe what needs to be done. The CEO routes it through the team by its status.</DialogDescription>
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
            {type === 'feature' && (
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <span className="text-sm font-medium">Projects</span>
                <ProjectsSelect label="Projects" value={chosenProjects} choices={projects} onChange={setChosenProjects} />
              </div>
            )}
            {type === 'task' && <TaskProject featureProjects={parentProjects} projects={projects} value={projectName} onChange={setChosenProject} />}
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
            {REFINEMENT_KINDS.map(kind => (
              <RefinementSwitch
                key={kind}
                id={`artifact-${kind}-refinement`}
                checked={refinements[kind]}
                onChange={checked => setRefinements({ ...refinements, [kind]: checked })}
                title={REFINEMENT_SWITCHES[kind].title}
                description={REFINEMENT_SWITCHES[kind].description}
              />
            ))}
            {REFINEMENT_KINDS.every(kind => !refinements[kind]) && (
              <p className="text-xs text-muted-foreground">A simple item: it goes straight to the Developer.</p>
            )}
          </fieldset>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="artifact-create" disabled={saving || title.trim() === '' || (type === 'feature' ? chosenProjects.length === 0 : projectName === NONE)}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
