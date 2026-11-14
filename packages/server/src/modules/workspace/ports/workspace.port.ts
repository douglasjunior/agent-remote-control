export interface IWorkspacePort {
  getBaseDirectory(): string;
  resolveRepositoryPath(repositoryName: string): string;
  ensureDirectory(path: string): Promise<void>;
  listProjectFolders(): Promise<readonly string[]>;
}

export const IWorkspacePort = Symbol('IWorkspacePort');
