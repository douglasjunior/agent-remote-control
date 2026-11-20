import type { SavedSettings } from '../models/resolved-setting.model.js';


/** The settings saved from the web interface. */
export interface ISettingsStorePort {
  load(): Promise<SavedSettings>;
  /** Saves `values` and removes the `removed` keys as one step; resolves to every saved setting after it. */
  save(values: SavedSettings, removed: readonly string[]): Promise<SavedSettings>;
}

export const ISettingsStorePort = Symbol('ISettingsStorePort');
