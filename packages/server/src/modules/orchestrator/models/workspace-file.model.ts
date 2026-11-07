export interface WorkspaceFile {
  /** Relative to the workspaces root. */
  readonly path: string;
  readonly content: string;
}
