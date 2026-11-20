import { describe, expect, it } from '@rstest/core';

import { StubPreferencesStore } from './stub-preferences-store.js';


describe('StubPreferencesStore', () => {
  it('should start empty and merge updates', async () => {
    const store = new StubPreferencesStore();
    await expect(store.load()).resolves.toEqual({});

    await store.update(() => ({ language: 'Spanish' }));

    await expect(store.load()).resolves.toEqual({ language: 'Spanish', updatedAt: '2026-01-01T00:00:00.000Z' });
    expect(store.updates).toEqual([{ language: 'Spanish' }]);
  });

  it('should leave the preferences alone when the change returns undefined', async () => {
    const store = new StubPreferencesStore();

    await expect(store.update(() => undefined)).resolves.toEqual({});
    expect(store.updates).toEqual([]);
  });
});
