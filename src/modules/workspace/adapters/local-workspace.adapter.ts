import { Injectable, Optional } from '@nestjs/common';
import { lstat, mkdir, readdir, readlink, symlink, unlink, writeFile } from 'node:fs/promises';
import { platform } from 'node:os';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

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
      return entries
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
        .map(entry => entry.name)
        .sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async writeFile(relativePath: string, content: string): Promise<void> {
    const target = this.resolveInside(relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }

  async ensureSymlink(relativeLinkPath: string, target: string): Promise<void> {
    const linkPath = this.resolveInside(relativeLinkPath);
    const linkDirectory = dirname(linkPath);
    const targetPath = resolve(linkDirectory, target);
    this.assertInsideBaseDirectory(targetPath);

    const existing = await lstat(linkPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return undefined;
      }
      throw error;
    });

    if (existing && !existing.isSymbolicLink()) {
      throw new Error(`Cannot create symlink, a file or directory already exists: ${linkPath}`);
    }
    if (existing) {
      if (this.pointsTo(linkDirectory, await readlink(linkPath), targetPath)) {
        return;
      }
      await unlink(linkPath);
    }

    await mkdir(linkDirectory, { recursive: true });
    // Windows only creates directory symlinks with admin rights or Developer Mode; a junction needs neither but takes an absolute target.
    if (platform() === 'win32') {
      await symlink(targetPath, linkPath, 'junction');
    } else {
      await symlink(target, linkPath, 'dir');
    }
  }

  /** Windows reports a junction target as an absolute path, possibly with the `\\?\` prefix, and compares paths case-insensitively. */
  private pointsTo(linkDirectory: string, linkTarget: string, targetPath: string): boolean {
    const current = resolve(linkDirectory, linkTarget.replace(/^\\\\\?\\/, ''));
    return platform() === 'win32'
      ? current.toLowerCase() === targetPath.toLowerCase()
      : current === targetPath;
  }

  private resolveInside(relativePath: string): string {
    const target = resolve(this.baseDirectory, relativePath);
    this.assertInsideBaseDirectory(target);
    return target;
  }

  private assertInsideBaseDirectory(path: string): void {
    const relativePath = relative(this.baseDirectory, path);
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      throw new Error(`Path is outside the workspace directory: ${path}`);
    }
  }
}
