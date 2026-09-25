import { Inject, Injectable } from '@nestjs/common';

import { IGitPort } from '../ports/git.port.js';
import { IWorkspacePort } from '../ports/workspace.port.js';


export interface PrepareWorkspaceInput {
  repositoryUrl: string;
  repositoryName?: string;
  branch?: string;
}

export interface PrepareWorkspaceOutput {
  repositoryName: string;
  workspacePath: string;
  currentBranch: string;
  isCloned: boolean;
}

@Injectable()
export class PrepareWorkspaceUseCase {
  constructor(
    @Inject(IGitPort)
    private readonly gitPort: IGitPort,
    @Inject(IWorkspacePort)
    private readonly workspacePort: IWorkspacePort,
  ) {}

  async execute(input: PrepareWorkspaceInput): Promise<PrepareWorkspaceOutput> {
    if (!input.repositoryUrl || !input.repositoryUrl.trim()) {
      throw new Error('Repository URL cannot be empty');
    }

    const repositoryName = this.resolveName(input);
    if (!repositoryName) {
      throw new Error('Could not determine repository name from URL');
    }

    const workspacePath =
      this.workspacePort.resolveRepositoryPath(repositoryName);
    const exists = await this.workspacePort.hasRepository(repositoryName);

    if (!exists) {
      await this.gitPort.clone(
        input.repositoryUrl,
        workspacePath,
        input.branch ? { branch: input.branch } : undefined,
      );

      const status = await this.gitPort.status(workspacePath);
      const currentBranch = status.currentBranch;

      await this.workspacePort.registerRepository({
        name: repositoryName,
        url: input.repositoryUrl,
        path: workspacePath,
        defaultBranch: currentBranch,
        lastPreparedAt: new Date().toISOString(),
      });

      return {
        repositoryName,
        workspacePath,
        currentBranch,
        isCloned: true,
      };
    }

    const status = await this.gitPort.status(workspacePath);
    let currentBranch = status.currentBranch;

    if (input.branch && input.branch !== currentBranch) {
      await this.gitPort.checkout(workspacePath, input.branch);
      const updatedStatus = await this.gitPort.status(workspacePath);
      currentBranch = updatedStatus.currentBranch;
    }

    await this.workspacePort.registerRepository({
      name: repositoryName,
      url: input.repositoryUrl,
      path: workspacePath,
      defaultBranch: currentBranch,
      lastPreparedAt: new Date().toISOString(),
    });

    return {
      repositoryName,
      workspacePath,
      currentBranch,
      isCloned: false,
    };
  }

  private resolveName(input: PrepareWorkspaceInput): string {
    if (input.repositoryName && input.repositoryName.trim()) {
      return input.repositoryName.trim();
    }
    const sanitized = input.repositoryUrl.trim().replace(/\/+$/, '');
    const segments = sanitized.split(/[\\/:]+/).filter(Boolean);
    const lastSegment = segments[segments.length - 1] ?? '';
    return lastSegment.replace(/\.git$/i, '');
  }
}
