import type { WorkspaceEntry, WorkspaceFileMatch } from '../models/workspace-file-match.model.js';

import { FileSearchIndex } from './file-search-index.service.js';


const file = (path: string, depth = path.split('/').length - 1): WorkspaceEntry => ({ path, kind: 'file', depth });
const directory = (path: string, depth = path.split('/').length - 1): WorkspaceEntry => ({ path, kind: 'directory', depth });

function setup() {
  const published: (readonly WorkspaceFileMatch[])[] = [];
  const index = new FileSearchIndex(matches => published.push(matches));
  const latest = () => published.at(-1)?.map(match => match.path);
  return { index, published, latest };
}

describe('FileSearchIndex', () => {
  it('should list the base directory without a query, folders first and alphabetical', () => {
    const { index, latest } = setup();
    index.addEntries([file('b.ts'), directory('src'), file('a.ts'), directory('src/deep'), file('src/x.ts')]);

    expect(latest()).toEqual(['src/', 'a.ts', 'b.ts']);
  });

  it('should find a path by a subsequence that spans directories', async () => {
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
    await rs.waitFor(() => expect(latest()).toEqual(['klist-workspace-sdd/repositories/klist-site/app/components/']));
  });

  it('should match case-insensitively and report the matched character indexes', async () => {
    const { index, published } = setup();
    index.addEntries([file('Docs/Guide.md')]);

    index.setQuery('guide');
    await rs.waitFor(() => expect(published.at(-1)).toEqual([{ path: 'Docs/Guide.md', kind: 'file', matches: [5, 6, 7, 8, 9] }]));
  });

  it('should put the better match first and cap the results', async () => {
    const { index, latest } = setup();
    index.addEntries([file('src/application/main.ts'), file('app.ts'), file('a/p/p.ts')]);

    index.setQuery('app');
    await rs.waitFor(() => expect(latest()?.[0]).toBe('app.ts'));
  });

  it('should merge a batch that arrives after the query into the results', async () => {
    const { index, latest } = setup();
    index.addEntries([file('one.ts')]);
    index.setQuery('two');
    await rs.waitFor(() => expect(latest()).toEqual([]));

    index.addEntries([file('two.ts'), file('three.ts')]);

    expect(latest()).toEqual(['two.ts']);
  });

  it('should not republish for a batch without matches', async () => {
    const { index, published } = setup();
    index.setQuery('zzz');
    await rs.waitFor(() => expect(published).toHaveLength(1));
    const before = published.length;

    index.addEntries([file('a.ts')]);

    expect(published).toHaveLength(before);
  });

  it('should let the running query reach a batch added while it is slicing', async () => {
    const { index, latest } = setup();
    index.addEntries([file('first.ts')]);

    index.setQuery('ts');
    index.addEntries([file('second.ts')]);
    await rs.waitFor(() => expect(latest()).toEqual(expect.arrayContaining(['first.ts', 'second.ts'])));
  });

  it('should score a large index in several slices and still finds a match in the last one', async () => {
    const { index, latest } = setup();
    index.addEntries(Array.from({ length: 5_100 }, (_, number) => file(`filler-${number}.txt`)));
    index.addEntries([file('needle.ts')]);

    index.setQuery('needle');
    await rs.waitFor(() => expect(latest()).toEqual(['needle.ts']));
  });

  it('should drop the results of a query that was replaced', async () => {
    const { index, latest } = setup();
    index.addEntries([file('alpha.ts'), file('beta.ts')]);

    index.setQuery('alpha');
    index.setQuery('beta');
    await rs.waitFor(() => expect(latest()).toEqual(['beta.ts']));
  });

  it('should return to the base directory when the query is cleared', async () => {
    const { index, latest } = setup();
    index.addEntries([file('a.ts'), file('src/b.ts')]);
    index.setQuery('b');
    await rs.waitFor(() => expect(latest()).toContain('src/b.ts'));

    index.setQuery('');

    expect(latest()).toEqual(['a.ts']);
  });

  it('should add only base directory entries to the list while there is no query', () => {
    const { index, latest } = setup();
    index.addEntries([file('src/deep.ts')]);
    expect(latest()).toBeUndefined();

    index.addEntries([file('top.ts')]);

    expect(latest()).toEqual(['top.ts']);
  });

  it('should publish nothing after stop', async () => {
    const { index, published } = setup();
    index.addEntries([file('a.ts')]);
    const before = published.length;

    index.stop();
    index.setQuery('a');
    index.addEntries([file('b.ts')]);
    await rs.waitFor(() => expect(published).toHaveLength(before));
  });
});
