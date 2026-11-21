import type { SettingKey, SettingValues } from '@agent-remote-control/protocol/settings';

import { SETTINGS_CATALOG } from '../constants/settings-catalog.constant.js';
import type { ResolvedSetting } from '../models/resolved-setting.model.js';
import type { IRuntimeSettingsPort } from '../ports/runtime-settings.port.js';


/**
 * Each setting at its catalog default unless the spec gives it a value, which reads as saved: fixed values, or a
 * function read on every use for a spec that keeps them in variables.
 */
export class StubRuntimeSettings implements IRuntimeSettingsPort {
  private readonly changed: Partial<SettingValues> = {};
  private readonly given: () => Partial<SettingValues>;

  constructor(values: Partial<SettingValues> | (() => Partial<SettingValues>) = {}) {
    this.given = typeof values === 'function' ? values : () => values;
  }

  get<Key extends SettingKey>(key: Key): SettingValues[Key] {
    return this.resolve(key).value;
  }

  resolve<Key extends SettingKey>(key: Key): ResolvedSetting<Key> {
    const values = { ...this.given(), ...this.changed };
    return key in values
      ? { value: values[key] as SettingValues[Key], source: 'saved' }
      : { value: SETTINGS_CATALOG[key].defaultValue, source: 'default' };
  }

  set<Key extends SettingKey>(key: Key, value: SettingValues[Key]): void {
    this.changed[key] = value;
  }
}
