import type { SettingKey, SettingValues } from '@agent-remote-control/protocol/settings';

import type { ResolvedSetting } from '../models/resolved-setting.model.js';


/**
 * The value each setting takes now: the one saved from the web interface, else its environment variable, else its
 * default. Read it whenever the value is used, so a saved change applies to the next use.
 */
export interface IRuntimeSettingsPort {
  get<Key extends SettingKey>(key: Key): SettingValues[Key];
  resolve<Key extends SettingKey>(key: Key): ResolvedSetting<Key>;
}

export const IRuntimeSettingsPort = Symbol('IRuntimeSettingsPort');
