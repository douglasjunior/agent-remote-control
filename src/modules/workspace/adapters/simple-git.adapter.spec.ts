import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SimpleGitAdapter } from './simple-git.adapter.js';

const mockClone = vi.fn();
const mockCheckout = vi.fn();
const mockCheckoutLocalBranch = vi.fn();
const mockStatus = vi.fn();
const mockCommit = vi.fn();
const mockPush = vi.fn();

vi.mock('simple-git', () => ({
  simpleGit: vi.fn((_baseDir?: string) => ({
    clone: mockClone,
    checkout: mockCheckout,
    checkoutLocalBranch: mockCheckoutLocalBranch,
    status: mockStatus,
    commit: mockCommit,
    push: mockPush,
  })),
}));

describe('SimpleGitAdapter', () => {
  let adapter: SimpleGitAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new SimpleGitAdapter();
  });

  describe('clone', () => {
    it('should clone repository without extra options', async () => {
      mockClone.mockResolvedValue(undefined);

      await adapter.clone('https://github.com/org/repo.git', '/path/to/target');

      expect(mockClone).toHaveBeenCalledWith(
        'https://github.com/org/repo.git',
        '/path/to/target',
        [],
      );
    });

    it('should clone repository with branch and depth options', async () => {
      mockClone.mockResolvedValue(undefined);

      await adapter.clone(
        'https://github.com/org/repo.git',
        '/path/to/target',
        {
          branch: 'feature-1',
          depth: 1,
        },
      );

      expect(mockClone).toHaveBeenCalledWith(
        'https://github.com/org/repo.git',
        '/path/to/target',
        ['--branch', 'feature-1', '--depth', '1'],
      );
    });
  });

  describe('checkout', () => {
    it('should checkout existing branch without creating a new branch', async () => {
      mockCheckout.mockResolvedValue(undefined);

      await adapter.checkout('/path/to/repo', 'main');

      expect(mockCheckout).toHaveBeenCalledWith('main');
      expect(mockCheckoutLocalBranch).not.toHaveBeenCalled();
    });

    it('should checkout and create a local branch when createBranch is true', async () => {
      mockCheckoutLocalBranch.mockResolvedValue(undefined);

      await adapter.checkout('/path/to/repo', 'new-feature', {
        createBranch: true,
      });

      expect(mockCheckoutLocalBranch).toHaveBeenCalledWith('new-feature');
      expect(mockCheckout).not.toHaveBeenCalled();
    });
  });

  describe('status', () => {
    it('should retrieve status with current branch, cleanliness, files, and tracking metrics', async () => {
      mockStatus.mockResolvedValue({
        current: 'main',
        isClean: () => false,
        files: [
          { path: 'src/index.ts', working_dir: 'M', index: ' ' },
          { path: 'README.md', working_dir: '?', index: '?' },
        ],
        ahead: 1,
        behind: 2,
      });

      const result = await adapter.status('/path/to/repo');

      expect(result.currentBranch).toBe('main');
      expect(result.isClean).toBe(false);
      expect(result.files).toEqual([
        { path: 'src/index.ts', workingDir: 'M', index: ' ' },
        { path: 'README.md', workingDir: '?', index: '?' },
      ]);
      expect(result.ahead).toBe(1);
      expect(result.behind).toBe(2);
    });

    it('should handle status when current branch is null or undefined', async () => {
      mockStatus.mockResolvedValue({
        current: null,
        isClean: () => true,
        files: [],
        ahead: 0,
        behind: 0,
      });

      const result = await adapter.status('/path/to/repo');

      expect(result.currentBranch).toBe('');
      expect(result.isClean).toBe(true);
      expect(result.files).toEqual([]);
    });
  });

  describe('commit', () => {
    it('should commit staged changes without all option', async () => {
      mockCommit.mockResolvedValue({
        commit: 'c0ffee',
        branch: 'main',
        summary: {
          changes: 2,
          insertions: 10,
          deletions: 3,
        },
      });

      const result = await adapter.commit(
        '/path/to/repo',
        'feat: adiciona modulo',
      );

      expect(mockCommit).toHaveBeenCalledWith('feat: adiciona modulo');
      expect(result).toEqual({
        commitId: 'c0ffee',
        branch: 'main',
        summary: {
          changes: 2,
          insertions: 10,
          deletions: 3,
        },
      });
    });

    it('should commit with all option including modified files', async () => {
      mockCommit.mockResolvedValue({
        commit: 'abc1234',
        branch: 'feature',
        summary: {
          changes: 1,
          insertions: 5,
          deletions: 0,
        },
      });

      const result = await adapter.commit(
        '/path/to/repo',
        'fix: corrige erro',
        { all: true },
      );

      expect(mockCommit).toHaveBeenCalledWith('fix: corrige erro', ['-a']);
      expect(result.commitId).toBe('abc1234');
    });
  });

  describe('push', () => {
    it('should push changes without extra options', async () => {
      mockPush.mockResolvedValue(undefined);

      await adapter.push('/path/to/repo');

      expect(mockPush).toHaveBeenCalledWith(undefined, undefined, undefined);
    });

    it('should push changes with setUpstream, remote, and branch options', async () => {
      mockPush.mockResolvedValue(undefined);

      await adapter.push('/path/to/repo', {
        remote: 'origin',
        branch: 'feature',
        setUpstream: true,
      });

      expect(mockPush).toHaveBeenCalledWith('origin', 'feature', ['-u']);
    });
  });
});
