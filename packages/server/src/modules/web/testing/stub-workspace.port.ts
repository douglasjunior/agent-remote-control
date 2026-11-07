import type { IWorkspacePort } from '../../workspace/ports/workspace.port.js';


export class StubWorkspacePort implements IWorkspacePort {
  readonly ensuredDirectories: string[] = [];
  readonly writtenFiles: string[] = [];
  readonly symlinks: string[] = [];

  getBaseDirectory(): string {
    return '/workspaces';
  }

  resolveRepositoryPath(repositoryName: string): string {
    return `/workspaces/${repositoryName}`;
  }

  async ensureDirectory(path: string): Promise<void> {
    this.ensuredDirectories.push(path);
  }

  async listProjectFolders(): Promise<readonly string[]> {
    return [];
  }

  async writeFile(relativePath: string): Promise<void> {
    this.writtenFiles.push(relativePath);
  }

  async ensureSymlink(relativeLinkPath: string): Promise<void> {
    this.symlinks.push(relativeLinkPath);
  }
}
