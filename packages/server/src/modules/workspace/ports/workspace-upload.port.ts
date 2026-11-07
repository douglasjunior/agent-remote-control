export interface UploadWriter {
  append(bytes: Uint8Array): Promise<void>;
  /** Publishes the file under its final name and resolves with its path relative to the workspace base directory. */
  commit(): Promise<string>;
  /** Discards what was written so far. */
  abort(): Promise<void>;
}

export interface IWorkspaceUploadPort {
  /** Opens a file to be written in pieces inside `directory`, relative to the workspace base directory. */
  begin(directory: string, name: string): Promise<UploadWriter>;
  /** The size in bytes of the file at `relativePath`, or `null` when it is not an existing file inside the workspace base directory. */
  fileSize(relativePath: string): Promise<number | null>;
}

export const IWorkspaceUploadPort = Symbol('IWorkspaceUploadPort');
