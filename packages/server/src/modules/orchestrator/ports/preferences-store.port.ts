import type { Preferences } from '../models/preferences.model.js';


export interface IPreferencesStorePort {
  load(): Promise<Preferences>;
  /** Merges `changes` into the stored preferences and stamps `updatedAt`. */
  update(changes: Omit<Preferences, 'updatedAt'>): Promise<Preferences>;
}

export const IPreferencesStorePort = Symbol('IPreferencesStorePort');
