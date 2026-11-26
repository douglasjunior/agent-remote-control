import type { SettingKey, SettingView } from '@agent-remote-control/protocol/settings';
import { Inject, Injectable } from '@nestjs/common';

import { SETTING_KEYS, SETTINGS_CATALOG } from '../constants/settings-catalog.constant.js';
import { IRuntimeSettingsPort } from '../ports/runtime-settings.port.js';


/** Every setting with its value and where it comes from; a secret says only whether it holds a value. */
@Injectable()
export class GetSettingsUseCase {
  constructor(@Inject(IRuntimeSettingsPort) private readonly settings: IRuntimeSettingsPort) {}

  execute(): SettingView[] {
    return SETTING_KEYS.map(key => this.view(key));
  }

  private view(key: SettingKey): SettingView {
    const { group, apply, kind, defaultValue, options, env, envOnly = false } = SETTINGS_CATALOG[key];
    const { value, source } = this.settings.resolve(key);
    const base = { key, group, apply, source, env, envOnly };
    switch (kind) {
      case 'secret':
        return { ...base, kind, value: { set: value !== '' } };
      case 'choice':
        return { ...base, kind, value: value as string, defaultValue: defaultValue as string, options: [...options!] };
      case 'boolean':
        return { ...base, kind, value: value as boolean, defaultValue: defaultValue as boolean };
      case 'integer':
        return { ...base, kind, value: value as number, defaultValue: defaultValue as number };
      case 'text':
        return { ...base, kind, value: value as string, defaultValue: defaultValue as string };
    }
  }
}
