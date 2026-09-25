import { beforeEach, describe, expect, it } from 'vitest';
import type {
  GitCheckoutOptions,
  GitCloneOptions,
  GitCommitOptions,
  GitCommitResult,
  GitPushOptions,
  GitStatusResult,
  IGitPort,
} from '../ports/git.port.js';
import type {
  IWorkspacePort,
  RepositoryMetadata,
} from '../ports/workspace.port.js';
import { PrepareWorkspaceUseCase } from './prepare-workspace.use-case.js';

class StubGitPort implements IGitPort {
  cloneCalls: Array<{
    url: string;
    target: string;
    options?: GitCloneOptions;
  }> = [];
  checkoutCalls: Array<{
    dir: string;
    branch: string;
    options?: GitCheckoutOptions;
  }> = [];
  statusCalls: string[] = [];

  statusToReturn: GitStatusResult = {
    currentBranch: 'main',
    isClean: true,
    files: [],
    ahead: 0,
    behind: 0,
  };

  async clone(
    url: string,
    target: string,
    options?: GitCloneOptions,
  ): Promise<void> {
    this.cloneCalls.push({ url, target, options });
  }

  async checkout(
    dir: string,
    branch: string,
    options?: GitCheckoutOptions,
  ): Promise<void> {
    this.checkoutCalls.push({ dir, branch, options });
    this.statusToReturn.currentBranch = branch;
  }

  async status(dir: string): Promise<GitStatusResult> {
    this.statusCalls.push(dir);
    return { ...this.statusToReturn };
  }

  async commit(
    _dir: string,
    _message: string,
    _options?: GitCommitOptions,
  ): Promise<GitCommitResult> {
    return {
      commitId: 'stub',
      branch: 'main',
      summary: { changes: 0, insertions: 0, deletions: 0 },
    };
  }

  async push(_dir: string, _options?: GitPushOptions): Promise<void> {}
}

class StubWorkspacePort implements IWorkspacePort {
  repositories = new Map<string, RepositoryMetadata>();
  baseDirectory = '/mock/workspaces';

  getBaseDirectory(): string {
    return this.baseDirectory;
  }

  resolveRepositoryPath(repositoryName: string): string {
    return `${this.baseDirectory}/${repositoryName}`;
  }

  async registerRepository(metadata: RepositoryMetadata): Promise<void> {
    this.repositories.set(metadata.name, metadata);
  }

  async getRepository(
    repositoryName: string,
  ): Promise<RepositoryMetadata | null> {
    return this.repositories.get(repositoryName) ?? null;
  }

  async listRepositories(): Promise<RepositoryMetadata[]> {
    return Array.from(this.repositories.values());
  }

  async hasRepository(repositoryName: string): Promise<boolean> {
    return this.repositories.has(repositoryName);
  }
}

describe('PrepareWorkspaceUseCase', () => {
  let useCase: PrepareWorkspaceUseCase;
  let stubGitPort: StubGitPort;
  let stubWorkspacePort: StubWorkspacePort;

  beforeEach(() => {
    stubGitPort = new StubGitPort();
    stubWorkspacePort = new StubWorkspacePort();
    useCase = new PrepareWorkspaceUseCase(stubGitPort, stubWorkspacePort);
  });

  describe('validations', () => {
    it('should throw an error when repository URL is empty or whitespace', async () => {
      await expect(useCase.execute({ repositoryUrl: '' })).rejects.toThrow(
        'Repository URL cannot be empty',
      );

      await expect(useCase.execute({ repositoryUrl: '   ' })).rejects.toThrow(
        'Repository URL cannot be empty',
      );
    });

    it('should throw an error when repository name cannot be derived', async () => {
      await expect(useCase.execute({ repositoryUrl: '///' })).rejects.toThrow(
        'Could not determine repository name from URL',
      );
    });
  });

  describe('cloning new repository', () => {
    it('should clone repository and register it in workspace when not already present', async () => {
      stubGitPort.statusToReturn.currentBranch = 'develop';

      const result = await useCase.execute({
        repositoryUrl: 'https://github.com/my-org/backend-service.git',
        branch: 'develop',
      });

      expect(result).toEqual({
        repositoryName: 'backend-service',
        workspacePath: '/mock/workspaces/backend-service',
        currentBranch: 'develop',
        isCloned: true,
      });

      expect(stubGitPort.cloneCalls).toEqual([
        {
          url: 'https://github.com/my-org/backend-service.git',
          target: '/mock/workspaces/backend-service',
          options: { branch: 'develop' },
        },
      ]);

      const stored = await stubWorkspacePort.getRepository('backend-service');
      expect(stored).not.toBeNull();
      expect(stored?.name).toBe('backend-service');
      expect(stored?.defaultBranch).toBe('develop');
    });

    it('should clone repository without branch option when branch is omitted', async () => {
      const result = await useCase.execute({
        repositoryUrl: 'https://github.com/my-org/cli-tool.git',
      });

      expect(result.isCloned).toBe(true);
      expect(stubGitPort.cloneCalls[0]?.options).toBeUndefined();
    });

    it('should use explicit repositoryName when provided', async () => {
      const result = await useCase.execute({
        repositoryUrl: 'https://github.com/my-org/repo.git',
        repositoryName: 'custom-alias',
      });

      expect(result.repositoryName).toBe('custom-alias');
      expect(result.workspacePath).toBe('/mock/workspaces/custom-alias');
    });
  });

  describe('existing repository', () => {
    beforeEach(async () => {
      await stubWorkspacePort.registerRepository({
        name: 'existing-repo',
        url: 'https://github.com/my-org/existing-repo.git',
        path: '/mock/workspaces/existing-repo',
        defaultBranch: 'main',
      });
      stubGitPort.statusToReturn.currentBranch = 'main';
    });

    it('should return existing repository without checkout when requested branch matches current branch', async () => {
      const result = await useCase.execute({
        repositoryUrl: 'https://github.com/my-org/existing-repo.git',
        branch: 'main',
      });

      expect(result.isCloned).toBe(false);
      expect(result.currentBranch).toBe('main');
      expect(stubGitPort.cloneCalls).toHaveLength(0);
      expect(stubGitPort.checkoutCalls).toHaveLength(0);
    });

    it('should checkout specified branch when different from current branch', async () => {
      const result = await useCase.execute({
        repositoryUrl: 'https://github.com/my-org/existing-repo.git',
        branch: 'feature-branch',
      });

      expect(result.isCloned).toBe(false);
      expect(result.currentBranch).toBe('feature-branch');
      expect(stubGitPort.cloneCalls).toHaveLength(0);
      expect(stubGitPort.checkoutCalls).toEqual([
        {
          dir: '/mock/workspaces/existing-repo',
          branch: 'feature-branch',
          options: undefined,
        },
      ]);
    });
  });
});
