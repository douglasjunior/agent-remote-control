import type { SettingKey, SettingSource, SettingValues } from '@agent-remote-control/protocol/settings';


/** The value a setting takes now and where it comes from. */
export type ResolvedSetting<Key extends SettingKey = SettingKey> = {
  readonly value: SettingValues[Key];
  readonly source: SettingSource;
};

/** The values saved from the web interface, by key, as stored; a value the catalog no longer accepts is ignored. */
export type SavedSettings = Readonly<Record<string, unknown>>;
