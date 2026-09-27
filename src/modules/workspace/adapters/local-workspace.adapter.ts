import { Injectable, Optional } from '@nestjs/common';
import { mkdir } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import type { IWorkspacePort } from '../ports/workspace.port.js';


@Injectable()
export class LocalWorkspaceAdapter implements IWorkspacePort {
  private readonly baseDirectory: string;

  constructor(@Optional() customBaseDir?: string) {
    if (customBaseDir) {
      this.baseDirectory = resolve(customBaseDir);
    } else if (process.env.WORKSPACE_DIR && process.env.WORKSPACE_DIR.trim()) {
      this.baseDirectory = resolve(process.env.WORKSPACE_DIR.trim());
    } else {
      this.baseDirectory = resolve(process.cwd(), 'workspaces');
    }
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
    return path;
  }

  async ensureDirectory(path: string): Promise<void> {
    const target = resolve(path);
    this.assertInsideBaseDirectory(target);
    await mkdir(target, { recursive: true });
  }

  private assertInsideBaseDirectory(path: string): void {
    const relativePath = relative(this.baseDirectory, path);
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      throw new Error(`Path is outside the workspace directory: ${path}`);
    }
  }
}
