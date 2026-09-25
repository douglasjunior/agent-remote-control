import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalWorkspaceAdapter } from './local-workspace.adapter.js';


vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

const { existsSync } = await import('node:fs');
const { mkdir, readFile, writeFile } = await import('node:fs/promises');

describe('LocalWorkspaceAdapter', () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    debugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(vi.fn());
  });

  afterEach(() => {
    debugSpy.mockRestore();
  });

  describe('constructor and base directory resolution', () => {
    const originalEnv = process.env.WORKSPACE_DIR;

    afterEach(() => {
      process.env.WORKSPACE_DIR = originalEnv;
    });

    it('should use customBaseDir when explicitly provided', () => {
      const adapter = new LocalWorkspaceAdapter('/custom/workspace/dir');
      expect(adapter.getBaseDirectory()).toBe('/custom/workspace/dir');
    });

    it('should use WORKSPACE_DIR from environment when provided', () => {
      process.env.WORKSPACE_DIR = '/env/workspaces';
      const adapter = new LocalWorkspaceAdapter();
      expect(adapter.getBaseDirectory()).toBe('/env/workspaces');
    });

    it('should use default workspaces folder when no custom dir or env is set', () => {
      delete process.env.WORKSPACE_DIR;
      const adapter = new LocalWorkspaceAdapter();
      expect(adapter.getBaseDirectory()).toContain('workspaces');
    });

    it('should ignore empty or whitespace WORKSPACE_DIR and use default', () => {
      process.env.WORKSPACE_DIR = '   ';
      const adapter = new LocalWorkspaceAdapter();
      expect(adapter.getBaseDirectory()).toContain('workspaces');
    });
  });

  describe('repository operations', () => {
    let adapter: LocalWorkspaceAdapter;

    beforeEach(() => {
      vi.mocked(readFile).mockRejectedValue(new Error('ENOENT: no such file'));
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue(undefined);
      adapter = new LocalWorkspaceAdapter('/test/workspaces');
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

    it('should register repository and persist manifest file', async () => {
      const metadata = {
        name: 'repo-1',
        url: 'https://github.com/org/repo-1.git',
        path: '/test/workspaces/repo-1',
        defaultBranch: 'main',
        lastPreparedAt: '2026-09-25T12:00:00Z',
      };

      await adapter.registerRepository(metadata);

      expect(mkdir).toHaveBeenCalledWith('/test/workspaces', {
        recursive: true,
      });
      expect(writeFile).toHaveBeenCalledWith(
        '/test/workspaces/workspace-manifest.json',
        expect.stringContaining('repo-1'),
        'utf-8',
      );

      const found = await adapter.getRepository('repo-1');
      expect(found).toEqual(metadata);

      const all = await adapter.listRepositories();
      expect(all).toHaveLength(1);
      expect(all[0]).toEqual(metadata);
    });

    it('should return null when repository is not found', async () => {
      const found = await adapter.getRepository('non-existent');
      expect(found).toBeNull();
    });

    it('should return true for hasRepository if in manifest or if directory exists on disk', async () => {
      vi.mocked(existsSync).mockReturnValueOnce(true);

      const existsOnDisk = await adapter.hasRepository('existing-on-disk');
      expect(existsOnDisk).toBe(true);

      await adapter.registerRepository({
        name: 'in-manifest',
        url: 'https://github.com/org/repo.git',
        path: '/test/workspaces/in-manifest',
      });

      const existsInManifest = await adapter.hasRepository('in-manifest');
      expect(existsInManifest).toBe(true);

      vi.mocked(existsSync).mockReturnValueOnce(false);
      const notFound = await adapter.hasRepository('completely-missing');
      expect(notFound).toBe(false);
    });

    it('should load pre-existing repositories from manifest file', async () => {
      const preExisting = [
        {
          name: 'preloaded-repo',
          url: 'https://github.com/org/preloaded.git',
          path: '/test/workspaces/preloaded-repo',
          defaultBranch: 'main',
        },
      ];
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(preExisting));

      const newAdapter = new LocalWorkspaceAdapter('/test/workspaces');
      const list = await newAdapter.listRepositories();

      expect(list).toHaveLength(1);
      expect(list[0]?.name).toBe('preloaded-repo');
    });

    it('should gracefully handle malformed or empty manifest items', async () => {
      const corruptData = [null, { name: '' }, { name: 'valid-repo' }];
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(corruptData));

      const newAdapter = new LocalWorkspaceAdapter('/test/workspaces');
      const list = await newAdapter.listRepositories();

      expect(list).toHaveLength(1);
      expect(list[0]?.name).toBe('valid-repo');
    });
  });
});
