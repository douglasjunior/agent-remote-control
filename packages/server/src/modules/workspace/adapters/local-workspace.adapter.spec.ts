import { beforeEach, describe, expect, it, vi } from 'vitest';

import { workspaceDirectoryAt } from '../../paths/testing/fixed-directories.js';

import { LocalWorkspaceAdapter } from './local-workspace.adapter.js';


vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
}));

const { mkdir, readdir, stat } = await import('node:fs/promises');

function errnoError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

function dirent(name: string, isDirectory: boolean, isSymbolicLink = false) {
  return { name, isDirectory: () => isDirectory, isSymbolicLink: () => isSymbolicLink };
}

describe('LocalWorkspaceAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should report the directory the workspace directory service resolves', () => {
    expect(new LocalWorkspaceAdapter(workspaceDirectoryAt('/custom/workspace/dir')).getBaseDirectory()).toBe('/custom/workspace/dir');
  });

  describe('project directories', () => {
    let adapter: LocalWorkspaceAdapter;

    beforeEach(() => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      adapter = new LocalWorkspaceAdapter(workspaceDirectoryAt('/test/workspaces'));
    });

    it('should resolve repository path relative to base directory', () => {
      const resolved = adapter.resolveRepositoryPath('project-alpha');
      expect(resolved).toBe('/test/workspaces/project-alpha');
    });

    it('should reject repository names that escape or equal the base directory', () => {
      expect(() => adapter.resolveRepositoryPath('../outside')).toThrow(
        'Path is outside the workspace directory: /test/outside',
      );
      expect(() => adapter.resolveRepositoryPath('/etc')).toThrow(
        'Path is outside the workspace directory: /etc',
      );
      expect(() => adapter.resolveRepositoryPath('.')).toThrow(
        'Invalid repository name: "."',
      );
    });

    it('should reject nested repository paths', () => {
      expect(() => adapter.resolveRepositoryPath('project-alpha/src')).toThrow(
        'Repository name must be a direct subfolder of the workspace, not a nested path: "project-alpha/src"',
      );
    });

    it('should create directories inside the base directory recursively', async () => {
      await adapter.ensureDirectory('/test/workspaces');
      await adapter.ensureDirectory('/test/workspaces/project-alpha');

      expect(mkdir).toHaveBeenCalledWith('/test/workspaces', { recursive: true });
      expect(mkdir).toHaveBeenCalledWith('/test/workspaces/project-alpha', { recursive: true });
    });

    it('should refuse to create directories outside the base directory', async () => {
      await expect(adapter.ensureDirectory('/test/other')).rejects.toThrow(
        'Path is outside the workspace directory: /test/other',
      );
      expect(mkdir).not.toHaveBeenCalled();
    });
  });

  describe('listProjectFolders', () => {
    const adapter = new LocalWorkspaceAdapter(workspaceDirectoryAt('/test/workspaces'));

    it('should list the visible direct subfolders in alphabetical order', async () => {
      vi.mocked(readdir).mockResolvedValue([
        dirent('zeta', true),
        dirent('.agents', true),
        dirent('AGENTS.md', false),
        dirent('alpha', true),
      ] as never);

      await expect(adapter.listProjectFolders()).resolves.toEqual(['alpha', 'zeta']);
      expect(readdir).toHaveBeenCalledWith('/test/workspaces', { withFileTypes: true });
    });

    it('should list symlinked folders and skip broken links or links to files', async () => {
      vi.mocked(readdir).mockResolvedValue([
        dirent('linked', false, true),
        dirent('file-link', false, true),
        dirent('broken', false, true),
      ] as never);
      vi.mocked(stat).mockImplementation((path) => {
        if (path === '/test/workspaces/broken') {
          return Promise.reject(errnoError('ENOENT'));
        }
        return Promise.resolve({ isDirectory: () => path === '/test/workspaces/linked' } as never);
      });

      await expect(adapter.listProjectFolders()).resolves.toEqual(['linked']);
    });

    it('should return no folders when the base directory does not exist', async () => {
      vi.mocked(readdir).mockRejectedValue(errnoError('ENOENT'));

      await expect(adapter.listProjectFolders()).resolves.toEqual([]);
    });

    it('should propagate other read errors', async () => {
      vi.mocked(readdir).mockRejectedValue(errnoError('EACCES'));

      await expect(adapter.listProjectFolders()).rejects.toThrow('EACCES');
    });
  });
});
