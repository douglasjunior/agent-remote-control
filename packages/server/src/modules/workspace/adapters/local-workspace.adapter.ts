import { Injectable } from '@nestjs/common';
import type { Dirent } from 'node:fs';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import { WorkspaceDirectoryService } from '../../paths/services/workspace-directory.service.js';
import type { IWorkspacePort } from '../ports/workspace.port.js';


@Injectable()
export class LocalWorkspaceAdapter implements IWorkspacePort {
  private readonly baseDirectory: string;

  constructor(workspaceDirectory: WorkspaceDirectoryService) {
    this.baseDirectory = workspaceDirectory.resolve();
  }

  getBaseDirectory(): string {
    return this.baseDirectory;
  }

  resolveRepositoryPath(repositoryName: string): string {
    const path = resolve(this.baseDirectory, repositoryName);
    if (path === this.baseDirectory) {
      throw new Error(`Invalid repository name: "${repositoryName}"`);
    }
    this.assertInsideBaseDirectory(path);
    if (dirname(path) !== this.baseDirectory) {
      throw new Error(`Repository name must be a direct subfolder of the workspace, not a nested path: "${repositoryName}"`);
    }
    return path;
  }

  async ensureDirectory(path: string): Promise<void> {
    const target = resolve(path);
    this.assertInsideBaseDirectory(target);
    await mkdir(target, { recursive: true });
  }

  async listProjectFolders(): Promise<readonly string[]> {
    try {
      const entries = await readdir(this.baseDirectory, { withFileTypes: true });
      const folders = await Promise.all(entries
        .filter(entry => !entry.name.startsWith('.'))
        .map(async entry => (await this.isDirectoryEntry(entry) ? [entry.name] : [])));
      return folders.flat().sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private async isDirectoryEntry(entry: Dirent): Promise<boolean> {
    if (!entry.isSymbolicLink()) {
      return entry.isDirectory();
    }
    return stat(resolve(this.baseDirectory, entry.name)).then(stats => stats.isDirectory(), () => false);
  }

  private assertInsideBaseDirectory(path: string): void {
    const relativePath = relative(this.baseDirectory, path);
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      throw new Error(`Path is outside the workspace directory: ${path}`);
    }
  }
}
