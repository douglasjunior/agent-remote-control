export interface GitCloneOptions {
  branch?: string;
  depth?: number;
}

export interface GitCheckoutOptions {
  createBranch?: boolean;
}

export interface GitCommitOptions {
  all?: boolean;
}

export interface GitPushOptions {
  remote?: string;
  branch?: string;
  setUpstream?: boolean;
}

export interface GitStatusFile {
  path: string;
  workingDir: string;
  index: string;
}

export interface GitStatusResult {
  currentBranch: string;
  isClean: boolean;
  files: GitStatusFile[];
  ahead: number;
  behind: number;
}

export interface GitCommitSummary {
  changes: number;
  insertions: number;
  deletions: number;
}

export interface GitCommitResult {
  commitId: string;
  branch: string;
  summary: GitCommitSummary;
}

export interface IGitPort {
  clone(
    repositoryUrl: string,
    targetPath: string,
    options?: GitCloneOptions,
  ): Promise<void>;
  checkout(
    workingDirectory: string,
    branchOrCommit: string,
    options?: GitCheckoutOptions,
  ): Promise<void>;
  status(workingDirectory: string): Promise<GitStatusResult>;
  commit(
    workingDirectory: string,
    message: string,
    options?: GitCommitOptions,
  ): Promise<GitCommitResult>;
  push(workingDirectory: string, options?: GitPushOptions): Promise<void>;
}

export const IGitPort = Symbol('IGitPort');
