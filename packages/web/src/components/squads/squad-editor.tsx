import type { AgentOption } from '@agent-remote-control/protocol/agent-option';
import type { ClientCommand } from '@agent-remote-control/protocol/client-command';
import { MAX_SQUAD_DESCRIPTION_LENGTH, MAX_SQUAD_NAME_LENGTH } from '@agent-remote-control/protocol/limits';
import type { Squad } from '@agent-remote-control/protocol/squad';
import { ArrowLeft, LoaderCircle, Minus, Plus, Trash2 } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useId, useState } from 'react';
import { Link, useLocation } from 'react-router';

import { agentIdentity } from '../../lib/agent-identity.js';
import { cn } from '../../lib/utils.js';
import { AgentMark } from '../agent/agent-mark.js';
import { IconButton } from '../icon-button.js';
import { completeChoice, draftOf, type ProfileChoice, type ProfileDraft } from '../settings/profile-choice.js';
import { RoleEditor } from '../settings/role-editor.js';
import type { AgentOptions } from '../settings/use-agent-options.js';
import { settingsState, squadsPath } from '../settings-hub/settings-paths.js';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '../ui/alert-dialog.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { Switch } from '../ui/switch.js';
import { Textarea } from '../ui/textarea.js';

import type { SquadRole } from './squad-roles.js';


type Drafts = Readonly<Record<string, ProfileDraft>>;

export type SquadSave = Omit<Extract<ClientCommand, { type: 'squads.save' }>, 'type'>;

function DeleteSquadButton({ name, onDelete }: { readonly name: string; readonly onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton variant="ghost" label="Delete" onClick={() => setOpen(true)} className="shrink-0 text-muted-foreground hover:text-destructive">
        <Trash2 />
      </IconButton>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{`Delete the squad ${name}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              Conversations that applied it keep their agents, models and efforts.
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

function draftsOf(squad: Squad | undefined, initial: Drafts | undefined): Drafts {
  return squad ? Object.fromEntries(squad.profiles.map(profile => [profile.role, draftOf(profile)])) : initial ?? {};
}

/**
 * A squad's name, description, default flag and the profile of each role it sets. A role left out is not in the
 * squad: applying it leaves that role of a conversation as it is.
 */
export function SquadEditor({ squad, initialProfiles, roles, agents, options, saving, error, onSave, onDelete }: {
  readonly squad?: Squad;
  readonly initialProfiles?: Drafts;
  readonly roles: readonly SquadRole[];
  readonly agents: readonly AgentOption[];
  readonly options: AgentOptions;
  readonly saving: boolean;
  readonly error: string | null;
  readonly onSave: (squad: SquadSave) => void;
  readonly onDelete?: () => void;
}) {
  const location = useLocation();
  const id = useId();
  const [name, setName] = useState(squad?.name ?? '');
  const [description, setDescription] = useState(squad?.description ?? '');
  const [isDefault, setIsDefault] = useState(squad?.isDefault ?? false);
  const [drafts, setDrafts] = useState<Drafts>(() => draftsOf(squad, initialProfiles));

  const included = roles.filter(({ role }) => drafts[role] !== undefined);
  const choices = included.map(({ role }) => [role, completeChoice(drafts[role]!, agents, options)] as const);
  const complete = choices.every(([, choice]) => choice !== null);
  const ready = name.trim() !== '' && included.length > 0 && complete;

  const setDraft = (role: string, draft: ProfileDraft | undefined) => setDrafts(({ [role]: _replaced, ...rest }) => (draft ? { ...rest, [role]: draft } : rest));

  const save = () => onSave({
    ...(squad && { id: squad.id }),
    name: name.trim(),
    ...(description.trim() && { description: description.trim() }),
    isDefault,
    profiles: Object.fromEntries(choices) as Record<string, ProfileChoice>,
  });

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 sm:p-6">
      <Link to={squadsPath()} state={settingsState(location)} className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground @3xl/hub:hidden">
        <ArrowLeft aria-hidden className="size-4" />
        Back
      </Link>
      <header className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <h4 className="font-heading text-lg font-semibold break-all">{squad?.name ?? 'New squad'}</h4>
          {squad?.isDefault && <Badge variant="secondary">Default</Badge>}
        </div>
        {squad && onDelete && <DeleteSquadButton name={squad.name} onDelete={onDelete} />}
      </header>

      <div className="flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-name`} className="text-sm font-medium">Name</label>
          <Input id={`${id}-name`} value={name} maxLength={MAX_SQUAD_NAME_LENGTH} disabled={saving} onChange={event => setName(event.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-description`} className="text-sm font-medium">Description</label>
          <Textarea
            id={`${id}-description`}
            value={description}
            maxLength={MAX_SQUAD_DESCRIPTION_LENGTH}
            placeholder="What this squad is good for"
            disabled={saving}
            onChange={event => setDescription(event.target.value)}
          />
        </div>
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span id={`${id}-default`} className="text-sm font-medium">Default for new conversations</span>
            <span id={`${id}-default-hint`} className="text-xs text-muted-foreground">
              Applied to every conversation that starts without settings. Only one squad is the default.
            </span>
          </div>
          <Switch
            aria-labelledby={`${id}-default`}
            aria-describedby={`${id}-default-hint`}
            checked={isDefault}
            disabled={saving}
            onCheckedChange={setIsDefault}
          />
        </div>
      </div>

      <section aria-labelledby={`${id}-roles`} className="flex flex-col gap-2">
        <h5 id={`${id}-roles`} className="px-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Roles</h5>
        <ul aria-label="Roles" className="flex flex-col gap-2">
          {roles.map(({ role, roleName }) => {
            const identity = agentIdentity(role, roleName);
            const draft = drafts[role];
            return (
              <li
                key={role}
                style={{ '--c': identity.color } as CSSProperties}
                className={cn(
                  'flex flex-col gap-3 rounded-xl border bg-card/60 p-3 transition-colors',
                  draft && 'border-[color-mix(in_oklab,var(--c)_40%,transparent)]',
                )}
              >
                <div className="flex items-center gap-3">
                  <AgentMark role={role} roleName={roleName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{identity.label}</p>
                    {!draft && <p className="text-xs text-muted-foreground">Not in this squad: a conversation keeps its own setup for this role.</p>}
                  </div>
                  {draft
                    ? (
                      <Button variant="ghost" size="sm" aria-label={`Leave ${identity.label} out`} disabled={saving} onClick={() => setDraft(role, undefined)}>
                        <Minus className="size-3.5" />
                        <span className="hidden sm:inline">Leave out</span>
                      </Button>
                    )
                    : (
                      <Button variant="outline" size="sm" aria-label={`Add ${identity.label}`} disabled={saving} onClick={() => setDraft(role, {})}>
                        <Plus className="size-3.5" />
                        <span className="hidden sm:inline">Add</span>
                      </Button>
                    )}
                </div>
                {draft && (
                  <RoleEditor label={identity.label} agents={agents} value={draft} options={options} onChange={value => setDraft(role, value)} />
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {error && <p role="alert" className="mr-auto min-w-0 text-sm text-destructive">{error}</p>}
        {!error && !complete && <p className="mr-auto text-xs text-muted-foreground">Pick the agent, model and effort of every role in the squad.</p>}
        <Button disabled={!ready || saving} aria-busy={saving} onClick={save}>
          {saving && <LoaderCircle className="animate-spin" />}
          {saving ? 'Saving…' : squad ? 'Save squad' : 'Create squad'}
        </Button>
      </div>
    </article>
  );
}
