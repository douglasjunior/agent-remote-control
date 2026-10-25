export interface IWorkspacePort {
  getBaseDirectory(): string;
  resolveRepositoryPath(repositoryName: string): string;
  ensureDirectory(path: string): Promise<void>;
  listProjectFolders(): Promise<readonly string[]>;
  writeFile(relativePath: string, content: string): Promise<void>;
  ensureSymlink(relativeLinkPath: string, target: string): Promise<void>;
}

export const IWorkspacePort = Symbol('IWorkspacePort');
