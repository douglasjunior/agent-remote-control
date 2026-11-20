import type { Preferences } from '../models/preferences.model.js';
import type { IPreferencesStorePort, PreferencesChange } from '../ports/preferences-store.port.js';


export class StubPreferencesStore implements IPreferencesStorePort {
  preferences: Preferences = {};
  /** The changes each update merged, in order. */
  readonly updates: Omit<Preferences, 'updatedAt'>[] = [];

  async load(): Promise<Preferences> {
    return this.preferences;
  }

  async update(change: PreferencesChange): Promise<Preferences> {
    const changes = change(this.preferences);
    if (changes) {
      this.updates.push(changes);
      this.preferences = { ...this.preferences, ...changes, updatedAt: '2026-01-01T00:00:00.000Z' };
    }
    return this.preferences;
  }
}
