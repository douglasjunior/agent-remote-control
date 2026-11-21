import type { SettingKey } from '@agent-remote-control/protocol/settings';


export type SettingsChangeListener = (keys: readonly SettingKey[]) => void | Promise<void>;

/** Tells the modules that act on a setting, such as the Discord client, that its value changed. */
export interface ISettingsChangeNotifierPort {
  /** Called with the keys whose value changed; returns the function that stops listening. */
  onChange(listener: SettingsChangeListener): () => void;
  notify(keys: readonly SettingKey[]): void;
}

export const ISettingsChangeNotifierPort = Symbol('ISettingsChangeNotifierPort');
