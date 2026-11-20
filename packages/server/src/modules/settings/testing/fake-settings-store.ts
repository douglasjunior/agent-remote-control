import type { SavedSettings } from '../models/resolved-setting.model.js';
import type { ISettingsStorePort } from '../ports/settings-store.port.js';


export class FakeSettingsStore implements ISettingsStorePort {
  saved: Record<string, unknown> = {};
  failNextSave = false;

  async load(): Promise<SavedSettings> {
    return { ...this.saved };
  }

  async save(values: SavedSettings, removed: readonly string[]): Promise<SavedSettings> {
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error('disk full');
    }
    const next = { ...this.saved, ...values };
    removed.forEach(key => delete next[key]);
    this.saved = next;
    return { ...next };
  }
}
