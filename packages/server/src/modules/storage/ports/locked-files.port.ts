export type LockedFileOptions = {
  /** Mode of the file when a write creates it. */
  readonly mode?: number;
  /** Mode of the directories a write creates on the way to the file. */
  readonly directoryMode?: number;
  /** The lockfile that guards the file; `<path>.lock` by default. Files that change together share one. */
  readonly lockPath?: string;
};

export type JsonFileOptions<T> = LockedFileOptions & {
  /**
   * Turns the parsed content of the file into the value, or into `empty` when the content is not what the store
   * expects. Any copy of the value is shared with later reads, so callers never mutate it.
   */
  readonly parse: (content: unknown) => T;
  /** The value of a missing file, or of one that is not valid JSON. */
  readonly empty: T;
  /** The JSON written for the value; the value itself by default. */
  readonly serialize?: (value: T) => unknown;
};

/**
 * `change` receives the value on disk and returns the one to write, or `undefined` to leave the file as it is. It
 * runs while the lock is held, so it does only what the new value needs.
 */
export type LockedFileChange<T> = (current: T) => T | undefined | Promise<T | undefined>;

/** A file that is read freely and changed only under its lock. */
export interface LockedFile<T> {
  /** The value on disk. A copy cached from an earlier read or write is returned only while the file is unchanged. */
  read(): Promise<T>;
  /**
   * Takes the lock, reads the value on disk, applies `change` and, when it returns a value, writes it to a temporary
   * file renamed over the file, then releases the lock. Resolves to the value on disk afterwards; rejects with the
   * lock's timeout error or the write's error, leaving the file as it was.
   */
  update(change: LockedFileChange<T>): Promise<T>;
}

/** The files that hold data: every one that is read, changed and written back goes through here. */
export interface ILockedFilesPort {
  json<T>(path: string, options: JsonFileOptions<T>): LockedFile<T>;
  /** A text file, `undefined` while it does not exist. */
  text(path: string, options?: LockedFileOptions): LockedFile<string | undefined>;
}

export const ILockedFilesPort = Symbol('ILockedFilesPort');
