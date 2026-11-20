import type { SettingKey, SettingValues } from '@agent-remote-control/protocol/settings';
import { Injectable, Logger } from '@nestjs/common';

import { SETTINGS_CATALOG } from '../constants/settings-catalog.constant.js';
import type { ResolvedSetting, SavedSettings } from '../models/resolved-setting.model.js';
import type { SettingDefinition } from '../models/setting-definition.model.js';
import type { IRuntimeSettingsPort } from '../ports/runtime-settings.port.js';


const DIGITS = /^\d+$/;
const BOOLEANS: ReadonlyMap<string, boolean> = new Map([['true', true], ['false', false]]);

/**
 * Resolves each setting from the saved values it holds, which `SettingsModule` loads before any provider reads them
 * and every change replaces, then from `process.env`, then from the catalog default. A variable set to an empty text is
 * a value for a text or a secret, which is how an empty `DISCORD_BOT_TOKEN` turns the bot off; for any other kind it
 * reads as unset. A value that does not parse is logged once and skipped.
 */
@Injectable()
export class RuntimeSettingsService implements IRuntimeSettingsPort {
  private readonly logger = new Logger(RuntimeSettingsService.name);
  private readonly reported = new Set<string>();
  private saved: SavedSettings = {};

  get<Key extends SettingKey>(key: Key): SettingValues[Key] {
    return this.resolve(key).value;
  }

  resolve<Key extends SettingKey>(key: Key): ResolvedSetting<Key> {
    const definition: SettingDefinition<Key> = SETTINGS_CATALOG[key];
    if (key in this.saved) {
      const saved = definition.schema.safeParse(this.saved[key]);
      if (saved.success) {
        return { value: saved.data, source: 'saved' };
      }
      this.reportOnce(`saved:${key}`, `setting_invalid: the saved ${key} is not valid; ignored`);
    }
    const raw = process.env[definition.env];
    const fromEnv = raw === undefined ? undefined : this.parseEnv(definition, raw);
    return fromEnv === undefined ? { value: definition.defaultValue, source: 'default' } : { value: fromEnv, source: 'env' };
  }

  replaceSaved(saved: SavedSettings): void {
    this.saved = saved;
  }

  private parseEnv<Key extends SettingKey>(definition: SettingDefinition<Key>, raw: string): SettingValues[Key] | undefined {
    const text = raw.trim();
    const emptyIsValue = definition.kind === 'text' || definition.kind === 'secret';
    if (!text && !emptyIsValue) {
      return undefined;
    }
    const parsed = definition.schema.safeParse(this.coerce(definition, text));
    if (parsed.success) {
      return parsed.data;
    }
    const secret = definition.kind === 'secret';
    this.reportOnce(
      `env:${definition.env}:${secret ? '' : text}`,
      `setting_invalid: ${definition.env}${secret ? '' : `="${text}"`} is not valid; using ${secret ? 'the default' : JSON.stringify(definition.defaultValue)}`,
    );
    return undefined;
  }

  private coerce(definition: SettingDefinition, text: string): unknown {
    switch (definition.kind) {
      case 'boolean':
        return BOOLEANS.get(text.toLowerCase()) ?? text;
      case 'integer':
        return DIGITS.test(text) ? Number(text) : text;
      case 'choice':
        return text.toLowerCase();
      default:
        return text;
    }
  }

  private reportOnce(id: string, message: string): void {
    if (!this.reported.has(id)) {
      this.reported.add(id);
      this.logger.warn(message);
    }
  }
}
