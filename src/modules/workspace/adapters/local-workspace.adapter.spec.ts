import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalWorkspaceAdapter } from './local-workspace.adapter.js';


vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
}));

const { mkdir } = await import('node:fs/promises');

describe('LocalWorkspaceAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  describe('project directories', () => {
    let adapter: LocalWorkspaceAdapter;

    beforeEach(() => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
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
  });
});
