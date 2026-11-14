import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { workspaceDirectoryAt } from '../../paths/testing/fixed-directories.js';

import { LocalWorkspaceAdapter } from './local-workspace.adapter.js';


describe('LocalWorkspaceAdapter on the real file system', () => {
  let baseDirectory: string;
  let adapter: LocalWorkspaceAdapter;

  beforeEach(() => {
    baseDirectory = mkdtempSync(join(tmpdir(), 'arc-workspace-'));
    adapter = new LocalWorkspaceAdapter(workspaceDirectoryAt(baseDirectory));
  });

  afterEach(() => {
    rmSync(baseDirectory, { recursive: true, force: true });
  });

  it('should list only visible project folders', async () => {
    mkdirSync(join(baseDirectory, 'my-app'));
    mkdirSync(join(baseDirectory, '.agents'));
    writeFileSync(join(baseDirectory, 'AGENTS.md'), 'guide');

    await expect(adapter.listProjectFolders()).resolves.toEqual(['my-app']);
  });
});
