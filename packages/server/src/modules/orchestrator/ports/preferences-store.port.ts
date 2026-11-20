import type { Preferences } from '../models/preferences.model.js';


/** Receives the stored preferences and returns the changes to merge into them, or `undefined` to leave them as they are. */
export type PreferencesChange = (current: Preferences) => Omit<Preferences, 'updatedAt'> | undefined;

export interface IPreferencesStorePort {
  load(): Promise<Preferences>;
  /** Merges what `change` returns into the stored preferences as one step and stamps `updatedAt`; resolves to the stored preferences. */
  update(change: PreferencesChange): Promise<Preferences>;
}

export const IPreferencesStorePort = Symbol('IPreferencesStorePort');
