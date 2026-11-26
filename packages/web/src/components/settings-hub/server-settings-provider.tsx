import type { SettingView } from '@agent-remote-control/protocol/settings';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useConnection } from '../../connection/connection-context.js';
import type { DiscordTestState } from '../server-settings/discord-connection-test.js';
import { checkDraft, isChanged, type SettingDraft } from '../server-settings/setting-drafts.js';

import { type ServerSectionId, sectionOf } from './settings-sections.js';


type Drafts = Readonly<Record<string, SettingDraft>>;
export type SectionMark = 'invalid' | 'unsaved';
type DraftCheck = ReturnType<typeof checkDraft>;

export type ServerSettings = {
  /** `null` until the first `settings`. */
  readonly views: readonly SettingView[] | null;
  readonly drafts: Drafts;
  /** The check of each changed setting, by key. */
  readonly checks: ReadonlyMap<string, DraftCheck>;
  readonly changes: readonly SettingView[];
  readonly invalid: boolean;
  /** What the unsaved drafts of each section amount to: an invalid one outweighs the others. */
  readonly marks: ReadonlyMap<ServerSectionId, SectionMark>;
  readonly saving: boolean;
  /** Counts the saves, so a secret field opened for a new value closes once it is saved. */
  readonly saves: number;
  readonly failure: string | null;
  /** The keys saved since the hub opened that apply when the server restarts. */
  readonly restartKeys: readonly string[];
  readonly discordTest: DiscordTestState;
  readonly draft: (key: string, value: SettingDraft | undefined) => void;
  readonly discard: () => void;
  readonly reset: (key: string) => void;
  readonly save: () => void;
  readonly testDiscord: () => void;
};

const ServerSettingsContext = createContext<ServerSettings | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useServerSettings(): ServerSettings {
  return useContext(ServerSettingsContext)!;
}

function without(drafts: Drafts, keys: readonly string[]): Drafts {
  return Object.fromEntries(Object.entries(drafts).filter(([key]) => !keys.includes(key)));
}

/**
 * The settings of the server and the drafts being typed, kept above the sections of the hub so a draft survives
 * switching sections. A change is saved with the others and reaches every open hub.
 */
export function ServerSettingsProvider({ children }: { readonly children: ReactNode }) {
  const { connection, status } = useConnection();
  const [views, setViews] = useState<readonly SettingView[] | null>(null);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [restartKeys, setRestartKeys] = useState<readonly string[]>([]);
  const [discordTest, setDiscordTest] = useState<DiscordTestState>({ status: 'idle' });
  const [saves, setSaves] = useState(0);
  /** The save or reset waiting for its `settings.result`, with the keys it changes. */
  const pending = useRef<{ readonly requestId: string; readonly keys: readonly string[] } | null>(null);
  const latestViews = useRef<readonly SettingView[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => connection.onEvent((event) => {
    if (event.type === 'settings') {
      latestViews.current = event.settings;
      setViews(event.settings);
    } else if (event.type === 'settings.result' && event.requestId === pending.current?.requestId) {
      const saved = pending.current.keys;
      pending.current = null;
      setSaving(false);
      if (!event.ok) {
        setFailure(event.error);
        return;
      }
      setDrafts(current => without(current, saved));
      setSaves(count => count + 1);
      const restart = latestViews.current.filter(view => view.apply === 'restart' && saved.includes(view.key)).map(view => view.key);
      setRestartKeys(current => [...new Set([...current, ...restart])]);
      toast.success('Settings saved');
    } else if (event.type === 'settings.discord.test.result') {
      const { type: _type, ...result } = event;
      setDiscordTest({ status: 'done', result });
    }
  }), [connection]);

  useEffect(() => {
    if (status === 'open') {
      connection.send({ type: 'settings.get' });
    } else if (pending.current) {
      pending.current = null;
      setSaving(false);
      setFailure('The connection closed before the server confirmed the change. Check the values and try again.');
    }
  }, [connection, status]);

  const changes = useMemo(() => (views ?? []).filter(view => isChanged(view, drafts[view.key])), [views, drafts]);
  const checks = useMemo(() => new Map(changes.map(view => [view.key, checkDraft(view, drafts[view.key]!)])), [changes, drafts]);
  const invalid = [...checks.values()].some(check => !check.ok);
  const marks = useMemo(() => {
    const result = new Map<ServerSectionId, SectionMark>();
    for (const view of changes) {
      const mark: SectionMark = checks.get(view.key)!.ok ? 'unsaved' : 'invalid';
      const section = sectionOf(view);
      result.set(section, result.get(section) === 'invalid' ? 'invalid' : mark);
    }
    return result;
  }, [changes, checks]);

  const send = (keys: readonly string[], command: (requestId: string) => Parameters<typeof connection.send>[0]) => {
    const requestId = crypto.randomUUID();
    pending.current = { requestId, keys };
    setSaving(true);
    setFailure(null);
    connection.send(command(requestId));
  };

  const value: ServerSettings = {
    views,
    drafts,
    checks,
    changes,
    invalid,
    marks,
    saving,
    saves,
    failure,
    restartKeys,
    discordTest,
    draft: (key, draft) => setDrafts(current => (draft === undefined ? without(current, [key]) : { ...current, [key]: draft })),
    discard: () => setDrafts({}),
    reset: (key) => {
      setDrafts(current => without(current, [key]));
      send([key], requestId => ({ type: 'settings.reset', requestId, keys: [key] }));
    },
    save: () => {
      const values = Object.fromEntries([...checks]
        .filter(([, check]) => check.ok)
        .map(([key, check]) => [key, (check as Extract<typeof check, { ok: true }>).value]));
      send(Object.keys(values), requestId => ({ type: 'settings.set', requestId, changes: values }));
    },
    testDiscord: () => {
      const token = drafts.DISCORD_BOT_TOKEN;
      const guild = views?.find(view => view.key === 'DISCORD_GUILD_ID');
      const guildId = drafts.DISCORD_GUILD_ID ?? (guild?.kind === 'text' ? guild.value : undefined);
      setDiscordTest({ status: 'testing' });
      connection.send({
        type: 'settings.discord.test',
        ...(typeof token === 'string' && token.trim() ? { token } : {}),
        ...(typeof guildId === 'string' ? { guildId } : {}),
      });
    },
  };

  return <ServerSettingsContext.Provider value={value}>{children}</ServerSettingsContext.Provider>;
}
