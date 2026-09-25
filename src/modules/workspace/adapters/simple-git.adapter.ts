import { Injectable } from '@nestjs/common';
import { simpleGit } from 'simple-git';
import type {
  GitCheckoutOptions,
  GitCloneOptions,
  GitCommitOptions,
  GitCommitResult,
  GitPushOptions,
  GitStatusResult,
  IGitPort,
} from '../ports/git.port.js';

@Injectable()
export class SimpleGitAdapter implements IGitPort {
  async clone(
    repositoryUrl: string,
    targetPath: string,
    options?: GitCloneOptions,
  ): Promise<void> {
    const flags: string[] = [];
    if (options?.branch) {
      flags.push('--branch', options.branch);
    }
    if (options?.depth !== undefined) {
      flags.push('--depth', String(options.depth));
    }

    await simpleGit().clone(repositoryUrl, targetPath, flags);
  }

  async checkout(
    workingDirectory: string,
    branchOrCommit: string,
    options?: GitCheckoutOptions,
  ): Promise<void> {
    const git = simpleGit(workingDirectory);
    if (options?.createBranch) {
      await git.checkoutLocalBranch(branchOrCommit);
      return;
    }

    await git.checkout(branchOrCommit);
  }

  async status(workingDirectory: string): Promise<GitStatusResult> {
    const git = simpleGit(workingDirectory);
    const result = await git.status();

    return {
      currentBranch: result.current ?? '',
      isClean: result.isClean(),
      files: result.files.map((file) => ({
        path: file.path,
        workingDir: file.working_dir,
        index: file.index,
      })),
      ahead: result.ahead,
      behind: result.behind,
    };
  }

  async commit(
    workingDirectory: string,
    message: string,
    options?: GitCommitOptions,
  ): Promise<GitCommitResult> {
    const git = simpleGit(workingDirectory);
    const flags: string[] = [];
    if (options?.all) {
      flags.push('-a');
    }

    const result =
      flags.length > 0
        ? await git.commit(message, flags)
        : await git.commit(message);

    return {
      commitId: result.commit,
      branch: result.branch,
      summary: {
        changes: result.summary.changes,
        insertions: result.summary.insertions,
        deletions: result.summary.deletions,
      },
    };
  }

  async push(
    workingDirectory: string,
    options?: GitPushOptions,
  ): Promise<void> {
    const git = simpleGit(workingDirectory);
    const flags: string[] = [];
    if (options?.setUpstream) {
      flags.push('-u');
    }

    await git.push(
      options?.remote,
      options?.branch,
      flags.length > 0 ? flags : undefined,
    );
  }
}
