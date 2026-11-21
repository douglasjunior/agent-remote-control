import type { SettingKey } from '@agent-remote-control/protocol/settings';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { SETTINGS_CATALOG } from '../constants/settings-catalog.constant.js';
import { ISettingsChangeNotifierPort } from '../ports/settings-change-notifier.port.js';
import { ISettingsStorePort } from '../ports/settings-store.port.js';
import { RuntimeSettingsService } from '../services/runtime-settings.service.js';


export type SettingsChange = {
  /** The values to save, by key, checked against the catalog. */
  readonly values?: Readonly<Record<string, unknown>>;
  /** The keys whose saved value is removed, so the environment variable or the default applies again. */
  readonly reset?: readonly string[];
};

export type SettingsChangeResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

/**
 * Saves a change whole or not at all, applies it to the running server and tells the modules that act on the settings
 * whose value changed. Values are never logged, since some are secrets.
 */
@Injectable()
export class ChangeSettingsUseCase {
  private readonly logger = new Logger(ChangeSettingsUseCase.name);

  constructor(
    @Inject(ISettingsStorePort) private readonly store: ISettingsStorePort,
    private readonly runtime: RuntimeSettingsService,
    @Inject(ISettingsChangeNotifierPort) private readonly notifier: ISettingsChangeNotifierPort,
  ) {}

  async execute({ values = {}, reset = [] }: SettingsChange): Promise<SettingsChangeResult> {
    const unknown = [...Object.keys(values), ...reset].find(key => !this.isKey(key));
    if (unknown !== undefined) {
      return { ok: false, error: `Unknown setting: ${unknown}` };
    }
    const envOnly = [...Object.keys(values), ...reset].find(key => SETTINGS_CATALOG[key as SettingKey].envOnly);
    if (envOnly !== undefined) {
      return { ok: false, error: `${envOnly} can only be set with its environment variable` };
    }
    const both = reset.find(key => key in values);
    if (both !== undefined) {
      return { ok: false, error: `${both} cannot be changed and reset at once` };
    }
    const parsed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
      const result = SETTINGS_CATALOG[key as SettingKey].schema.safeParse(value);
      if (!result.success) {
        return { ok: false, error: `${key}: ${result.error.issues[0].message}` };
      }
      parsed[key] = result.data;
    }
    const keys = [...Object.keys(parsed), ...reset] as SettingKey[];
    const before = new Map(keys.map(key => [key, this.runtime.get(key)]));
    this.runtime.replaceSaved(await this.store.save(parsed, reset));
    const changed = keys.filter(key => this.runtime.get(key) !== before.get(key));
    if (changed.length > 0) {
      this.logger.log(`[Settings Changed] ${changed.join(', ')}`);
      this.notifier.notify(changed);
    }
    return { ok: true };
  }

  private isKey(key: string): key is SettingKey {
    return Object.hasOwn(SETTINGS_CATALOG, key);
  }
}
