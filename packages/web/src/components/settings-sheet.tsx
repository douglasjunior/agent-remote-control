import type { RoleProfile } from '@agent-remote-control/protocol/agent-profile';
import { Pencil, Users } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useConnection } from '../connection/connection-context.js';
import { useConversations } from '../conversations/conversations-context.js';
import { emptyConversationView } from '../conversations/conversations-reducer.js';
import { agentIdentity } from '../lib/agent-identity.js';
import { cn } from '../lib/utils.js';

import { AgentMark } from './agent/agent-mark.js';
import { type ProfileChoice, RoleEditor } from './settings/role-editor.js';
import { useAgentOptions } from './settings/use-agent-options.js';
import { Badge } from './ui/badge.js';
import { Button } from './ui/button.js';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet.js';


/** The editor open in the sheet: one role's, or the one that applies to every role. */
const EVERY_ROLE = '*';

function summaryOf(profile: RoleProfile) {
  return profile.agent
    ? [profile.agent.name, profile.model?.name, profile.effort?.name].filter(Boolean).join(' · ')
    : 'Not configured';
}

export function SettingsSheet({ conversationId, open, onOpenChange }: {
  readonly conversationId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { connection } = useConnection();
  const { state } = useConversations();
  const view = state.byId[conversationId] ?? emptyConversationView;
  const options = useAgentOptions();
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingLabel = useRef('');
  const firstSetup = !view.configured;
  const openEditor = editing ?? (firstSetup ? EVERY_ROLE : null);

  useEffect(() => connection.onEvent((event) => {
    if (event.type === 'error' && (!event.conversationId || event.conversationId === conversationId)) {
      setError(event.message);
      savingLabel.current = '';
      setSaving(false);
    } else if (event.type === 'profiles' && event.conversationId === conversationId && savingLabel.current) {
      toast.success(`${savingLabel.current} saved`);
      savingLabel.current = '';
      setSaving(false);
      setEditing(null);
    }
  }), [connection, conversationId]);

  const edit = (target: string | null) => {
    setError(null);
    setEditing(target);
  };

  const save = (roles: readonly string[] | undefined, label: string) => (choice: ProfileChoice) => {
    setError(null);
    setSaving(true);
    savingLabel.current = label;
    connection.send({ type: 'profiles.set', conversationId, ...(roles && { roles: [...roles] }), ...choice });
  };

  const editorFor = (target: string, label: string, initial: Partial<ProfileChoice>, roles: readonly string[] | undefined, saveLabel: string) => (
    <RoleEditor
      key={target}
      label={label}
      agents={state.agents}
      initial={initial}
      options={options}
      saving={saving}
      error={error}
      saveLabel={saveLabel}
      onSave={save(roles, label)}
      onCancel={() => (target === EVERY_ROLE && firstSetup ? onOpenChange(false) : edit(null))}
    />
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>The coding agent, model and effort each role runs on in this conversation.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 pb-6">
          <section
            aria-label="Every role"
            className={cn('rounded-xl border bg-card/60 p-3 transition-colors', openEditor === EVERY_ROLE && 'border-primary/50')}
          >
            <div className="flex items-center gap-3">
              <span className="grid size-[26px] shrink-0 place-items-center rounded-full border bg-muted text-muted-foreground">
                <Users className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Every role</p>
                <p className="text-xs text-muted-foreground">
                  {firstSetup
                    ? 'Choose what the team runs on to start this conversation.'
                    : `One agent, model and effort for all ${view.profiles.length} roles.`}
                </p>
              </div>
              {openEditor !== EVERY_ROLE && (
                <Button variant="outline" size="sm" onClick={() => edit(EVERY_ROLE)}>Set for every role</Button>
              )}
            </div>
            {openEditor === EVERY_ROLE && editorFor(EVERY_ROLE, 'Every role', {}, undefined, `Apply to all ${view.profiles.length} roles`)}
          </section>
          <ul aria-label="Roles" className="flex flex-col gap-2">
            {view.profiles.map((profile) => {
              const identity = agentIdentity(profile.role, profile.roleName);
              const isOpen = openEditor === profile.role;
              return (
                <li
                  key={profile.role}
                  style={{ '--c': identity.color } as CSSProperties}
                  className={cn(
                    'rounded-xl border bg-card/60 p-3 transition-colors',
                    isOpen && 'border-[color-mix(in_oklab,var(--c)_55%,transparent)] bg-[color-mix(in_oklab,var(--c)_6%,var(--card))]',
                  )}
                >
                  <div className="flex items-center gap-3">
                    <AgentMark role={profile.role} roleName={profile.roleName} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{identity.label}</p>
                      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <span className="truncate">{summaryOf(profile)}</span>
                        {profile.agent && !profile.agent.available && <Badge variant="destructive">not installed</Badge>}
                      </p>
                    </div>
                    {!isOpen && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Change ${identity.label}`}
                        onClick={() => edit(profile.role)}
                      >
                        <Pencil className="size-3.5" />
                        <span className="hidden sm:inline">Change</span>
                      </Button>
                    )}
                  </div>
                  {isOpen && editorFor(
                    profile.role,
                    identity.label,
                    { agentId: profile.agent?.id, modelId: profile.model?.id, effortId: profile.effort?.id },
                    [profile.role],
                    'Save',
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  );
}
