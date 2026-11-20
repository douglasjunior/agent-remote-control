export type FileLockOptions = {
  /** How long a caller waits for the lock, queued in this process or contending with another one. */
  readonly timeoutMs?: number;
  /** Age after which a lockfile is taken as abandoned and taken over, whatever its owner. */
  readonly staleMs?: number;
};

/** The lock was not taken within `timeoutMs`; the work did not run. */
export class FileLockTimeoutError extends Error {
  constructor(readonly lockPath: string, readonly timeoutMs: number) {
    super(`Timed out after ${timeoutMs}ms waiting for the lock ${lockPath}`);
    this.name = 'FileLockTimeoutError';
  }
}

/** Mutual exclusion over a lockfile, between the callers of this process and between processes sharing the disk. */
export interface IFileLockPort {
  /**
   * Runs `work` while holding the lock at `lockPath` and releases it afterwards, even when `work` throws. Callers of the
   * same path in this process run in the order they called. Rejects with {@link FileLockTimeoutError} when the lock is
   * not taken in time; otherwise settles as `work` does.
   */
  withLock<T>(lockPath: string, work: () => Promise<T>, options?: FileLockOptions): Promise<T>;
}

export const IFileLockPort = Symbol('IFileLockPort');
