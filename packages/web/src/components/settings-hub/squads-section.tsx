import type { Squad } from '@agent-remote-control/protocol/squad';
import { Plus, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useMatch, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';

import { useConnection } from '../../connection/connection-context.js';
import { useConversations } from '../../conversations/conversations-context.js';
import { cn } from '../../lib/utils.js';
import { useAgentOptions } from '../settings/use-agent-options.js';
import { SquadEditor, type SquadSave } from '../squads/squad-editor.js';
import { SquadList } from '../squads/squad-list.js';
import { squadRoles } from '../squads/squad-roles.js';
import { buttonVariants } from '../ui/button.js';

import { NEW_SQUAD_PATH, type SettingsState, squadsPath, settingsState } from './settings-paths.js';
import { SettingsSectionHeader } from './settings-section-header.js';
import { sectionById } from './settings-sections.js';


/** What the section waits for after a command: the next `squads` settles it, an `error` without a conversation refuses it. */
type Pending = { readonly kind: 'save'; readonly name: string; readonly isNew: boolean; readonly target: string } | { readonly kind: 'delete'; readonly name: string };

/** The squads: the list beside the squad picked from it or a new one, asked for again on every reconnection. */
export function SquadsSection() {
  const { connection, status } = useConnection();
  const { state } = useConversations();
  const { squadId } = useParams();
  const creating = useMatch(NEW_SQUAD_PATH) !== null;
  const location = useLocation();
  const navigate = useNavigate();
  const draft = (location.state as SettingsState | null)?.draft;
  const options = useAgentOptions();
  const [squads, setSquads] = useState<readonly Squad[] | null>(null);
  const pending = useRef<Pending | null>(null);
  const [saving, setSaving] = useState(false);
  /** A refused save, shown in the editor it came from. */
  const [failure, setFailure] = useState<{ readonly target: string; readonly message: string } | null>(null);
  const selected = creating || squadId !== undefined;
  const target = creating ? '' : squadId;
  const error = failure && failure.target === target ? failure.message : null;
  const noAgents = state.agents.length === 0;
  const { label, description } = sectionById('squads');

  useEffect(() => connection.onEvent((event) => {
    if (event.type === 'squads') {
      setSquads(event.squads);
      const settled = pending.current;
      pending.current = null;
      setSaving(false);
      if (settled?.kind === 'save') {
        toast.success(`${settled.name} saved`);
        const created = event.squads.find(squad => squad.name === settled.name);
        if (settled.isNew && created) {
          void navigate(squadsPath(created.id), { state: settingsState(location) });
        }
      } else if (settled?.kind === 'delete') {
        toast.success(`${settled.name} deleted`);
        void navigate(squadsPath(), { state: settingsState(location) });
      }
    } else if (event.type === 'error' && !event.conversationId && pending.current) {
      const refused = pending.current;
      pending.current = null;
      setSaving(false);
      if (refused.kind === 'save') {
        setFailure({ target: refused.target, message: event.message });
      } else {
        toast.error(event.message);
      }
    }
  }), [connection, navigate, location]);

  useEffect(() => {
    if (status === 'open') {
      connection.send({ type: 'squads.list' });
    }
  }, [connection, status]);

  useEffect(() => {
    if (status === 'open' && noAgents) {
      connection.send({ type: 'agents.list' });
    }
  }, [connection, status, noAgents]);

  const save = (squad: SquadSave) => {
    pending.current = { kind: 'save', name: squad.name, isNew: squad.id === undefined, target: squad.id ?? '' };
    setSaving(true);
    setFailure(null);
    connection.send({ type: 'squads.save', ...squad });
  };

  const remove = (squad: Squad) => {
    pending.current = { kind: 'delete', name: squad.name };
    connection.send({ type: 'squads.delete', id: squad.id });
  };

  const renderDetail = () => {
    if (!selected) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground"><Users aria-hidden /></span>
          <p className="font-heading text-base font-medium">Pick a squad</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            A squad sets the agent, model and effort of several roles at once. Apply one from the settings of a conversation.
          </p>
        </div>
      );
    }
    if (squads === null) {
      return <p role="status" className="p-6 text-sm text-muted-foreground">Loading…</p>;
    }
    const views = Object.values(state.byId);
    if (creating) {
      return (
        <SquadEditor
          key="new"
          initialProfiles={draft?.profiles}
          roles={squadRoles(views)}
          agents={state.agents}
          options={options}
          saving={saving}
          error={error}
          onSave={save}
        />
      );
    }
    const squad = squads.find(candidate => candidate.id === squadId);
    if (!squad) {
      return <p className="p-6 text-sm text-muted-foreground">This squad does not exist anymore.</p>;
    }
    return (
      <SquadEditor
        key={squad.id}
        squad={squad}
        roles={squadRoles(views, squad)}
        agents={state.agents}
        options={options}
        saving={saving}
        error={error}
        onSave={save}
        onDelete={() => remove(squad)}
      />
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 py-5 sm:px-6">
        <SettingsSectionHeader
          title={label}
          description={description}
          action={(
            <Link to={NEW_SQUAD_PATH} state={settingsState(location)} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              <Plus />
              New squad
            </Link>
          )}
        />
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] border-t @3xl/hub:grid-cols-[minmax(17rem,22rem)_1fr]">
        <aside aria-label="Squads" className={cn('min-h-0 overflow-y-auto border-r', selected && 'hidden @3xl/hub:block')}>
          {squads === null
            ? <p role="status" className="p-6 text-sm text-muted-foreground">Loading squads…</p>
            : <SquadList squads={squads} />}
        </aside>
        <section aria-label="Squad" className={cn('@container min-h-0 overflow-y-auto', !selected && 'hidden @3xl/hub:block')}>
          {renderDetail()}
        </section>
      </div>
    </div>
  );
}
