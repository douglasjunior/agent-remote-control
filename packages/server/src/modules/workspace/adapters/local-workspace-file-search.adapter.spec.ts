import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { WorkspaceFileMatch } from '../models/workspace-file-match.model.js';
import type { FileSearchSession } from '../ports/workspace-file-search.port.js';

import { LocalWorkspaceFileSearchAdapter } from './local-workspace-file-search.adapter.js';
import { LocalWorkspaceAdapter } from './local-workspace.adapter.js';


describe('LocalWorkspaceFileSearchAdapter', () => {
  let baseDirectory: string;
  let search: LocalWorkspaceFileSearchAdapter;
  const sessions: FileSearchSession[] = [];

  const touch = (path: string) => {
    mkdirSync(join(baseDirectory, path, '..'), { recursive: true });
    writeFileSync(join(baseDirectory, path), '');
  };

  /** Runs a session to the end of its walk, optionally with a query, and returns the final results. */
  const run = async (query = '') => {
    let results: readonly WorkspaceFileMatch[] = [];
    const states: boolean[] = [];
    const finished = new Promise<void>((resolve) => {
      const session = search.start({
        onResults: (matches) => {
          results = matches;
        },
        onWalking: (walking) => {
          states.push(walking);
          if (!walking) {
            resolve();
          }
        },
      });
      sessions.push(session);
      session.setQuery(query);
    });
    await finished;
    await new Promise(resolve => setImmediate(resolve));
    return { paths: results.map(match => match.path), states };
  };

  beforeEach(() => {
    baseDirectory = mkdtempSync(join(tmpdir(), 'arc-file-search-'));
    search = new LocalWorkspaceFileSearchAdapter(new LocalWorkspaceAdapter(baseDirectory));
  });

  afterEach(() => {
    sessions.splice(0).forEach(session => session.stop());
    rmSync(baseDirectory, { recursive: true, force: true });
  });

  it('announces the walk and its end, and lists the base directory without a query', async () => {
    touch('app/src/main.ts');
    touch('README.md');

    const { paths, states } = await run();

    expect(states).toEqual([true, false]);
    expect(paths).toEqual(['app/', 'README.md']);
  });

  it('finds nested paths with a fuzzy query', async () => {
    touch('klist-workspace-sdd/repositories/klist-site/app/components/button.tsx');

    const { paths } = await run('klist-site/components');

    expect(paths).toContain('klist-workspace-sdd/repositories/klist-site/app/components/');
  });

  it('skips dot entries and node_modules', async () => {
    touch('.git/config');
    touch('app/node_modules/pkg/index.js');
    touch('app/index.ts');

    const { paths } = await run('i');

    expect(paths).toEqual(['app/index.ts']);
  });

  it('follows a link to a directory and does not loop on a link to an ancestor', async () => {
    touch('real/inner.ts');
    symlinkSync(join(baseDirectory, 'real'), join(baseDirectory, 'linked'), 'dir');
    symlinkSync(baseDirectory, join(baseDirectory, 'real', 'back'), 'dir');

    const { paths } = await run('inner');

    expect(paths).toEqual(expect.arrayContaining(['real/inner.ts', 'linked/inner.ts']));
  });

  it('skips a link whose target is gone', async () => {
    touch('a.ts');
    symlinkSync(join(baseDirectory, 'missing'), join(baseDirectory, 'broken'));

    const { paths } = await run();

    expect(paths).toEqual(['a.ts']);
  });

  it('finishes with nothing when the base directory does not exist', async () => {
    rmSync(baseDirectory, { recursive: true, force: true });

    const { paths, states } = await run();

    expect(paths).toEqual([]);
    expect(states).toEqual([true, false]);
  });

  it('does not report the end of the walk after stop', async () => {
    touch('a.ts');
    const states: boolean[] = [];
    const session = search.start({ onResults: () => undefined, onWalking: walking => states.push(walking) });

    session.stop();
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(states).toEqual([true]);
  });
});
