import type { Preferences } from '../models/preferences.model.js';
import type { IPreferencesStorePort } from '../ports/preferences-store.port.js';


export class StubPreferencesStore implements IPreferencesStorePort {
  preferences: Preferences = {};
  readonly updates: Omit<Preferences, 'updatedAt'>[] = [];

  async load(): Promise<Preferences> {
    return this.preferences;
  }

  async update(changes: Omit<Preferences, 'updatedAt'>): Promise<Preferences> {
    this.updates.push(changes);
    this.preferences = { ...this.preferences, ...changes, updatedAt: '2026-01-01T00:00:00.000Z' };
    return this.preferences;
  }
}
