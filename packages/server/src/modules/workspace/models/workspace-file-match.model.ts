export type WorkspaceFileMatch = {
  /** Relative to the workspace base directory, with `/` separators and a trailing `/` on directories. */
  readonly path: string;
  readonly kind: 'file' | 'directory';
  /** Indexes of the characters of `path` matched by the query, for highlighting. */
  readonly matches: readonly number[];
};

/** An entry found by the walk; `path` has no trailing `/`. */
export type WorkspaceEntry = {
  readonly path: string;
  readonly kind: 'file' | 'directory';
  /** Depth of the directory that holds the entry: `0` for the entries of the base directory. */
  readonly depth: number;
};
