import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalWorkspaceAdapter } from './local-workspace.adapter.js';


vi.mock('node:fs/promises', () => ({
  lstat: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
  readlink: vi.fn(),
  symlink: vi.fn(),
  unlink: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('node:os', () => ({
  platform: vi.fn(() => 'linux'),
}));

const { lstat, mkdir, readdir, readlink, symlink, unlink, writeFile } = await import('node:fs/promises');
const { platform } = await import('node:os');

function errnoError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

function dirent(name: string, isDirectory: boolean) {
  return { name, isDirectory: () => isDirectory };
}

function stats(isSymbolicLink: boolean) {
  return { isSymbolicLink: () => isSymbolicLink } as Awaited<ReturnType<typeof lstat>>;
}

describe('LocalWorkspaceAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(platform).mockReturnValue('linux');
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
    const adapter = new LocalWorkspaceAdapter('/test/workspaces');

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

    it('should return no folders when the base directory does not exist', async () => {
      vi.mocked(readdir).mockRejectedValue(errnoError('ENOENT'));

      await expect(adapter.listProjectFolders()).resolves.toEqual([]);
    });

    it('should propagate other read errors', async () => {
      vi.mocked(readdir).mockRejectedValue(errnoError('EACCES'));

      await expect(adapter.listProjectFolders()).rejects.toThrow('EACCES');
    });
  });

  describe('writeFile', () => {
    const adapter = new LocalWorkspaceAdapter('/test/workspaces');

    it('should create the parent directories and write the content', async () => {
      await adapter.writeFile('.agents/skills/x/SKILL.md', 'content');

      expect(mkdir).toHaveBeenCalledWith('/test/workspaces/.agents/skills/x', { recursive: true });
      expect(writeFile).toHaveBeenCalledWith('/test/workspaces/.agents/skills/x/SKILL.md', 'content', 'utf8');
    });

    it('should refuse paths outside the base directory', async () => {
      await expect(adapter.writeFile('../escape.md', 'x')).rejects.toThrow(
        'Path is outside the workspace directory: /test/escape.md',
      );
      expect(writeFile).not.toHaveBeenCalled();
    });
  });

  describe('ensureSymlink', () => {
    const adapter = new LocalWorkspaceAdapter('/test/workspaces');

    describe.each(['linux', 'darwin'] as const)('on %s', (os) => {
      beforeEach(() => {
        vi.mocked(platform).mockReturnValue(os);
      });

      it('should create a relative directory symlink and its parent directory when nothing exists', async () => {
        vi.mocked(lstat).mockRejectedValue(errnoError('ENOENT'));

        await adapter.ensureSymlink('.claude/skills', '../.agents/skills');

        expect(mkdir).toHaveBeenCalledWith('/test/workspaces/.claude', { recursive: true });
        expect(symlink).toHaveBeenCalledWith('../.agents/skills', '/test/workspaces/.claude/skills', 'dir');
      });

      it('should keep a link that already points to the target', async () => {
        vi.mocked(lstat).mockResolvedValue(stats(true));
        vi.mocked(readlink).mockResolvedValue('../.agents/skills' as never);

        await adapter.ensureSymlink('.claude/skills', '../.agents/skills');

        expect(unlink).not.toHaveBeenCalled();
        expect(symlink).not.toHaveBeenCalled();
      });

      it('should treat paths that differ only in case as different targets', async () => {
        vi.mocked(lstat).mockResolvedValue(stats(true));
        vi.mocked(readlink).mockResolvedValue('../.Agents/Skills' as never);

        await adapter.ensureSymlink('.claude/skills', '../.agents/skills');

        expect(unlink).toHaveBeenCalledWith('/test/workspaces/.claude/skills');
      });
    });

    describe('on win32', () => {
      beforeEach(() => {
        vi.mocked(platform).mockReturnValue('win32');
      });

      it('should create a junction with an absolute target, which needs no elevated rights', async () => {
        vi.mocked(lstat).mockRejectedValue(errnoError('ENOENT'));

        await adapter.ensureSymlink('.claude/skills', '../.agents/skills');

        expect(symlink).toHaveBeenCalledWith('/test/workspaces/.agents/skills', '/test/workspaces/.claude/skills', 'junction');
      });

      it('should keep a junction whose absolute target has the extended-length prefix and another case', async () => {
        vi.mocked(lstat).mockResolvedValue(stats(true));
        vi.mocked(readlink).mockResolvedValue('\\\\?\\/TEST/workspaces/.agents/skills' as never);

        await adapter.ensureSymlink('.claude/skills', '../.agents/skills');

        expect(unlink).not.toHaveBeenCalled();
        expect(symlink).not.toHaveBeenCalled();
      });

      it('should replace a junction that points elsewhere', async () => {
        vi.mocked(lstat).mockResolvedValue(stats(true));
        vi.mocked(readlink).mockResolvedValue('/old/target' as never);

        await adapter.ensureSymlink('.claude/skills', '../.agents/skills');

        expect(unlink).toHaveBeenCalledWith('/test/workspaces/.claude/skills');
        expect(symlink).toHaveBeenCalledWith('/test/workspaces/.agents/skills', '/test/workspaces/.claude/skills', 'junction');
      });
    });

    it('should replace a link that points elsewhere', async () => {
      vi.mocked(lstat).mockResolvedValue(stats(true));
      vi.mocked(readlink).mockResolvedValue('/old/target' as never);

      await adapter.ensureSymlink('.claude/skills', '../.agents/skills');

      expect(unlink).toHaveBeenCalledWith('/test/workspaces/.claude/skills');
      expect(symlink).toHaveBeenCalledWith('../.agents/skills', '/test/workspaces/.claude/skills', 'dir');
    });

    it('should refuse a target outside the base directory', async () => {
      await expect(adapter.ensureSymlink('.claude/skills', '../../../etc')).rejects.toThrow(
        'Path is outside the workspace directory: /etc',
      );
      expect(symlink).not.toHaveBeenCalled();
    });

    it('should refuse to replace a real file or directory', async () => {
      vi.mocked(lstat).mockResolvedValue(stats(false));

      await expect(adapter.ensureSymlink('.claude/skills', '../.agents/skills')).rejects.toThrow(
        'Cannot create symlink, a file or directory already exists: /test/workspaces/.claude/skills',
      );
      expect(symlink).not.toHaveBeenCalled();
    });

    it('should propagate unexpected errors while inspecting the link path', async () => {
      vi.mocked(lstat).mockRejectedValue(errnoError('EACCES'));

      await expect(adapter.ensureSymlink('.claude/skills', '../.agents/skills')).rejects.toThrow('EACCES');
    });
  });
});
