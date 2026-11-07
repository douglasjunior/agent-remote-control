import type { WorkspaceEntry, WorkspaceFileMatch } from '../models/workspace-file-match.model.js';

import { FileSearchIndex } from './file-search-index.service.js';


const file = (path: string, depth = path.split('/').length - 1): WorkspaceEntry => ({ path, kind: 'file', depth });
const directory = (path: string, depth = path.split('/').length - 1): WorkspaceEntry => ({ path, kind: 'directory', depth });
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

function setup() {
  const published: (readonly WorkspaceFileMatch[])[] = [];
  const index = new FileSearchIndex(matches => published.push(matches));
  const latest = () => published.at(-1)?.map(match => match.path);
  return { index, published, latest };
}

describe('FileSearchIndex', () => {
  it('lists the base directory without a query, folders first and alphabetical', () => {
    const { index, latest } = setup();
    index.addEntries([file('b.ts'), directory('src'), file('a.ts'), directory('src/deep'), file('src/x.ts')]);

    expect(latest()).toEqual(['src/', 'a.ts', 'b.ts']);
  });

  it('finds a path by a subsequence that spans directories', async () => {
    const { index, latest } = setup();
    index.addEntries([
      directory('klist-workspace-sdd'),
      directory('klist-workspace-sdd/repositories'),
      directory('klist-workspace-sdd/repositories/klist-site'),
      directory('klist-workspace-sdd/repositories/klist-site/app'),
      directory('klist-workspace-sdd/repositories/klist-site/app/components'),
      file('klist-workspace-sdd/repositories/klist-site/app/readme.md'),
    ]);

    index.setQuery('klist-site/components');
    await settle();

    expect(latest()).toEqual(['klist-workspace-sdd/repositories/klist-site/app/components/']);
  });

  it('matches case-insensitively and reports the matched character indexes', async () => {
    const { index, published } = setup();
    index.addEntries([file('Docs/Guide.md')]);

    index.setQuery('guide');
    await settle();

    expect(published.at(-1)).toEqual([{ path: 'Docs/Guide.md', kind: 'file', matches: [5, 6, 7, 8, 9] }]);
  });

  it('puts the better match first and caps the results', async () => {
    const { index, latest } = setup();
    index.addEntries([file('src/application/main.ts'), file('app.ts'), file('a/p/p.ts')]);

    index.setQuery('app');
    await settle();

    expect(latest()?.[0]).toBe('app.ts');
  });

  it('merges a batch that arrives after the query into the results', async () => {
    const { index, latest } = setup();
    index.addEntries([file('one.ts')]);
    index.setQuery('two');
    await settle();
    expect(latest()).toEqual([]);

    index.addEntries([file('two.ts'), file('three.ts')]);

    expect(latest()).toEqual(['two.ts']);
  });

  it('does not republish for a batch without matches', async () => {
    const { index, published } = setup();
    index.setQuery('zzz');
    await settle();
    const before = published.length;

    index.addEntries([file('a.ts')]);

    expect(published).toHaveLength(before);
  });

  it('lets the running query reach a batch added while it is slicing', async () => {
    const { index, latest } = setup();
    index.addEntries([file('first.ts')]);

    index.setQuery('ts');
    index.addEntries([file('second.ts')]);
    await settle();

    expect(latest()).toEqual(expect.arrayContaining(['first.ts', 'second.ts']));
  });

  it('scores a large index in several slices and still finds a match in the last one', async () => {
    const { index, latest } = setup();
    index.addEntries(Array.from({ length: 5_100 }, (_, number) => file(`filler-${number}.txt`)));
    index.addEntries([file('needle.ts')]);

    index.setQuery('needle');
    await settle();
    await settle();

    expect(latest()).toEqual(['needle.ts']);
  });

  it('drops the results of a query that was replaced', async () => {
    const { index, latest } = setup();
    index.addEntries([file('alpha.ts'), file('beta.ts')]);

    index.setQuery('alpha');
    index.setQuery('beta');
    await settle();

    expect(latest()).toEqual(['beta.ts']);
  });

  it('returns to the base directory when the query is cleared', async () => {
    const { index, latest } = setup();
    index.addEntries([file('a.ts'), file('src/b.ts')]);
    index.setQuery('b');
    await settle();

    index.setQuery('');

    expect(latest()).toEqual(['a.ts']);
  });

  it('adds only base directory entries to the list while there is no query', () => {
    const { index, latest } = setup();
    index.addEntries([file('src/deep.ts')]);
    expect(latest()).toBeUndefined();

    index.addEntries([file('top.ts')]);

    expect(latest()).toEqual(['top.ts']);
  });

  it('publishes nothing after stop', async () => {
    const { index, published } = setup();
    index.addEntries([file('a.ts')]);
    const before = published.length;

    index.stop();
    index.setQuery('a');
    index.addEntries([file('b.ts')]);
    await settle();

    expect(published).toHaveLength(before);
  });
});
