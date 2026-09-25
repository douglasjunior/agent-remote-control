export interface RepositoryMetadata {
  name: string;
  url: string;
  path: string;
  defaultBranch?: string;
  lastPreparedAt?: string;
}

export interface IWorkspacePort {
  getBaseDirectory(): string;
  resolveRepositoryPath(repositoryName: string): string;
  ensureDirectory(path: string): Promise<void>;
  registerRepository(metadata: RepositoryMetadata): Promise<void>;
  getRepository(repositoryName: string): Promise<RepositoryMetadata | null>;
  listRepositories(): Promise<RepositoryMetadata[]>;
  hasRepository(repositoryName: string): Promise<boolean>;
}

export const IWorkspacePort = Symbol('IWorkspacePort');
