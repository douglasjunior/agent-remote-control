export interface IWorkspacePort {
  getBaseDirectory(): string;
  resolveRepositoryPath(repositoryName: string): string;
  ensureDirectory(path: string): Promise<void>;
}

export const IWorkspacePort = Symbol('IWorkspacePort');
