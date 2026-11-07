import { afterEach, describe, expect, it } from 'vitest';

import { resolveFromRepositoryRoot } from '../../../repository-root.util.js';

import { WorkspaceDirectoryService } from './workspace-directory.service.js';


describe('WorkspaceDirectoryService', () => {
  const originalWorkspaceDir = process.env.WORKSPACE_DIR;

  afterEach(() => {
    if (originalWorkspaceDir === undefined) {
      delete process.env.WORKSPACE_DIR;
    } else {
      process.env.WORKSPACE_DIR = originalWorkspaceDir;
    }
  });

  it('should use WORKSPACE_DIR from the environment', () => {
    process.env.WORKSPACE_DIR = ' /env/workspaces ';

    expect(new WorkspaceDirectoryService().resolve()).toBe('/env/workspaces');
  });

  it('should resolve a relative WORKSPACE_DIR from the repository root', () => {
    process.env.WORKSPACE_DIR = './my-workspaces';

    expect(new WorkspaceDirectoryService().resolve()).toBe(resolveFromRepositoryRoot('my-workspaces'));
  });

  it.each([['blank', '   '], ['unset', undefined]])('should fall back to the workspaces folder at the repository root when WORKSPACE_DIR is %s', (_case, value) => {
    if (value === undefined) {
      delete process.env.WORKSPACE_DIR;
    } else {
      process.env.WORKSPACE_DIR = value;
    }

    expect(new WorkspaceDirectoryService().resolve()).toBe(resolveFromRepositoryRoot('workspaces'));
  });
});
