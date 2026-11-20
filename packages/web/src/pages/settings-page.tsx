import type { SettingView } from '@agent-remote-control/protocol/settings';
import { RotateCw, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';

import { IconButton } from '../components/icon-button.js';
import { DiscordConnectionTest, type DiscordTestState } from '../components/server-settings/discord-connection-test.js';
import { checkDraft, isChanged, type SettingDraft } from '../components/server-settings/setting-drafts.js';
import { SettingField } from '../components/server-settings/setting-field.js';
import { GROUP_TITLES, settingText } from '../components/server-settings/setting-texts.js';
import type { SettingsState } from '../components/server-settings/settings-paths.js';
import { Button } from '../components/ui/button.js';
import { useConnection } from '../connection/connection-context.js';


type Drafts = Readonly<Record<string, SettingDraft>>;

/** The sections in the order their first setting comes from the server. */
function groupsOf(views: readonly SettingView[]): [string, SettingView[]][] {
  const groups = new Map<string, SettingView[]>();
  for (const view of views) {
    groups.set(view.group, [...groups.get(view.group) ?? [], view]);
  }
  return [...groups];
}

function without(drafts: Drafts, keys: readonly string[]): Drafts {
  return Object.fromEntries(Object.entries(drafts).filter(([key]) => !keys.includes(key)));
}

/**
 * The settings of the server, by section: each field shows where its value comes from, a change is saved with the
 * others and reaches every open settings page, and a setting that applies on restart says so.
 */
export function SettingsPage() {
  const { connection, status } = useConnection();
  const location = useLocation();
  const navigate = useNavigate();
  const close = () => void navigate((location.state as SettingsState | null)?.returnTo ?? '/');
  const [views, setViews] = useState<readonly SettingView[] | null>(null);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [restartKeys, setRestartKeys] = useState<readonly string[]>([]);
  const [discordTest, setDiscordTest] = useState<DiscordTestState>({ status: 'idle' });
  /** Counts the saves of this page, so a secret field opened for a new value closes once it is saved. */
  const [saves, setSaves] = useState(0);
  /** The keys a save or a reset of this page is waiting for, until the next `settings` or `error`. */
  const pending = useRef<readonly string[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => connection.onEvent((event) => {
    if (event.type === 'settings') {
      setViews(event.settings);
      const saved = pending.current;
      if (saved) {
        pending.current = null;
        setSaving(false);
        setDrafts(current => without(current, saved));
        setSaves(count => count + 1);
        const restart = event.settings.filter(view => view.apply === 'restart' && saved.includes(view.key)).map(view => view.key);
        setRestartKeys(current => [...new Set([...current, ...restart])]);
        toast.success('Settings saved');
      }
    } else if (event.type === 'error' && !event.conversationId && pending.current) {
      pending.current = null;
      setSaving(false);
      setFailure(event.message);
    } else if (event.type === 'settings.discord.test.result') {
      const { type: _type, ...result } = event;
      setDiscordTest({ status: 'done', result });
    }
  }), [connection]);

  useEffect(() => {
    if (status === 'open') {
      connection.send({ type: 'settings.get' });
    }
  }, [connection, status]);

  const changes = useMemo(() => (views ?? []).filter(view => isChanged(view, drafts[view.key])), [views, drafts]);
  const checks = useMemo(() => new Map(changes.map(view => [view.key, checkDraft(view, drafts[view.key]!)])), [changes, drafts]);
  const invalid = [...checks.values()].some(check => !check.ok);

  const send = (keys: readonly string[], command: Parameters<typeof connection.send>[0]) => {
    pending.current = keys;
    setSaving(true);
    setFailure(null);
    connection.send(command);
  };

  const save = () => {
    const values = Object.fromEntries([...checks]
      .filter(([, check]) => check.ok)
      .map(([key, check]) => [key, (check as Extract<typeof check, { ok: true }>).value]));
    send(Object.keys(values), { type: 'settings.set', changes: values });
  };

  const reset = (key: string) => {
    setDrafts(current => without(current, [key]));
    send([key], { type: 'settings.reset', keys: [key] });
  };

  const draft = (key: string, value: SettingDraft | undefined) => {
    setDrafts(current => (value === undefined ? without(current, [key]) : { ...current, [key]: value }));
  };

  const testDiscord = () => {
    const token = drafts.DISCORD_BOT_TOKEN;
    const guild = views?.find(view => view.key === 'DISCORD_GUILD_ID');
    const guildId = drafts.DISCORD_GUILD_ID ?? (guild?.kind === 'text' ? guild.value : undefined);
    setDiscordTest({ status: 'testing' });
    connection.send({
      type: 'settings.discord.test',
      ...(typeof token === 'string' && token.trim() ? { token } : {}),
      ...(typeof guildId === 'string' ? { guildId } : {}),
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-5 sm:px-6">
          <header className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="font-heading text-lg font-semibold">Settings</h2>
              <p className="text-sm text-muted-foreground">
                A value saved here takes the place of its environment variable; reset it to use the variable or the default again.
              </p>
            </div>
            <IconButton variant="ghost" size="icon-sm" label="Close settings" onClick={close}>
              <X />
            </IconButton>
          </header>

          {restartKeys.length > 0 && (
            <p role="status" className="flex items-start gap-2 rounded-xl border border-attention bg-[color-mix(in_oklab,var(--attention)_9%,var(--card))] px-3 py-2.5 text-sm">
              <RotateCw aria-hidden className="mt-0.5 size-4 shrink-0" />
              {`Restart the server to apply ${restartKeys.map(key => settingText(key).label).join(', ')}.`}
            </p>
          )}

          {views === null
            ? <p role="status" className="text-sm text-muted-foreground">Loading settings…</p>
            : groupsOf(views).map(([group, members]) => (
              <section key={group} aria-labelledby={`settings-group-${group}`} className="flex flex-col gap-2">
                <h3 id={`settings-group-${group}`} className="px-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  {GROUP_TITLES[group] ?? group}
                </h3>
                <div className="divide-y rounded-xl bg-card ring-1 ring-foreground/10">
                  {members.map((view) => {
                    const check = checks.get(view.key);
                    return (
                      <SettingField
                        key={view.kind === 'secret' ? `${view.key}:${saves}` : view.key}
                        view={view}
                        draft={drafts[view.key]}
                        error={check && !check.ok ? check.error : undefined}
                        disabled={saving}
                        onDraft={value => draft(view.key, value)}
                        onReset={() => reset(view.key)}
                      />
                    );
                  })}
                  {group === 'discord' && <DiscordConnectionTest state={discordTest} onTest={testDiscord} />}
                </div>
              </section>
            ))}
        </div>
      </div>
      {(changes.length > 0 || failure) && (
        <div className="border-t bg-background/95 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-2">
            {failure
              ? <p role="alert" className="min-w-0 text-sm text-destructive">{failure}</p>
              : <p className="text-sm text-muted-foreground">{changes.length === 1 ? '1 unsaved change' : `${changes.length} unsaved changes`}</p>}
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" size="sm" disabled={saving} onClick={() => setDrafts({})}>Discard</Button>
              <Button size="sm" disabled={saving || invalid || changes.length === 0} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
