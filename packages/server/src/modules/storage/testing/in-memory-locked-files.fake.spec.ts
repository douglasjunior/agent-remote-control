import { describe, expect, it } from '@rstest/core';

import type { JsonFileOptions } from '../ports/locked-files.port.js';

import { InMemoryLockedFilesFake } from './in-memory-locked-files.fake.js';


const LIST: JsonFileOptions<readonly string[]> = {
  parse: content => (Array.isArray(content) ? content as string[] : []),
  empty: [],
};

describe('InMemoryLockedFilesFake', () => {
  it('should keep each JSON file as text and run concurrent updates one at a time', async () => {
    const files = new InMemoryLockedFilesFake();
    const file = files.json('/data/list.json', LIST);

    await Promise.all(['a', 'b', 'c'].map(item => file.update(async current => [...current, item])));

    expect(files.contents.get('/data/list.json')).toBe('["a","b","c"]');
    await expect(files.json('/data/list.json', LIST).read()).resolves.toEqual(['a', 'b', 'c']);
  });

  it('should read missing and invalid JSON as empty, and leave the file when the change returns undefined', async () => {
    const files = new InMemoryLockedFilesFake();
    const file = files.json('/data/list.json', LIST);

    await expect(file.read()).resolves.toEqual([]);
    files.contents.set('/data/list.json', '[not json');
    await expect(file.read()).resolves.toEqual([]);
    await expect(file.update(() => undefined)).resolves.toEqual([]);
    expect(files.contents.get('/data/list.json')).toBe('[not json');
  });

  it('should serialize JSON through the serialize option', async () => {
    const files = new InMemoryLockedFilesFake();

    await files.json<ReadonlyMap<string, number>>('/data/map.json', {
      parse: () => new Map(),
      empty: new Map(),
      serialize: value => Object.fromEntries(value),
    }).update(current => new Map(current).set('a', 1));

    expect(files.contents.get('/data/map.json')).toBe('{"a":1}');
  });

  it('should fail the next update when asked, and run the ones after it', async () => {
    const files = new InMemoryLockedFilesFake();
    const file = files.text('/data/token');
    files.failNextUpdate = new Error('timed out');

    await expect(file.update(() => 'first')).rejects.toThrow('timed out');
    await expect(file.read()).resolves.toBeUndefined();
    await expect(file.update(() => 'second')).resolves.toBe('second');
  });
});
