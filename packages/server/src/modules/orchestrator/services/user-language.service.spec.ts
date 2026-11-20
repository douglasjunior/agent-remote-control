import { beforeEach, describe, expect, it } from '@rstest/core';

import { StubPreferencesStore } from '../testing/stub-preferences-store.js';

import { UserLanguageService } from './user-language.service.js';


describe('UserLanguageService', () => {
  let store: StubPreferencesStore;
  let service: UserLanguageService;

  beforeEach(() => {
    store = new StubPreferencesStore();
    service = new UserLanguageService(store);
  });

  it('should report English while no language is stored, and the stored one afterwards', async () => {
    await expect(service.get()).resolves.toBe('English');
    await expect(service.getStored()).resolves.toBeUndefined();

    store.preferences = { language: 'Spanish' };

    await expect(service.get()).resolves.toBe('Spanish');
    await expect(service.getStored()).resolves.toBe('Spanish');
  });

  it('should forget a stored language, and change nothing when none is stored', async () => {
    await service.reset();
    expect(store.updates).toEqual([]);

    store.preferences = { language: 'Spanish' };
    await service.reset();

    expect(store.updates).toEqual([{ language: undefined }]);
    await expect(service.getStored()).resolves.toBeUndefined();
  });

  it('should store the normalized language', async () => {
    await expect(service.set('  Brazilian   Portuguese ')).resolves.toBe('Brazilian Portuguese');

    expect(store.updates).toEqual([{ language: 'Brazilian Portuguese' }]);
  });

  it('should refuse an invalid language without storing anything', async () => {
    await expect(service.set('<script>')).resolves.toBeUndefined();

    expect(store.updates).toEqual([]);
  });
});
