import type { IWorkspacePort } from '../ports/workspace.port.js';


export class StubWorkspacePort implements IWorkspacePort {
  readonly ensuredDirectories: string[] = [];
  folders: readonly string[] = [];

  constructor(folders: readonly string[] = []) {
    this.folders = folders;
  }

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
    return this.folders;
  }
}
