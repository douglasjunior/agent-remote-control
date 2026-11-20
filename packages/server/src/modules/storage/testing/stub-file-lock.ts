import type { FileLockOptions, IFileLockPort } from '../ports/file-lock.port.js';


/** Runs each work at once, without a lockfile, and records the lock it asked for. */
export class StubFileLock implements IFileLockPort {
  readonly lockPaths: string[] = [];
  /** Rejects the next call with this error instead of running its work. */
  failNext?: Error;

  async withLock<T>(lockPath: string, work: () => Promise<T>, _options?: FileLockOptions): Promise<T> {
    this.lockPaths.push(lockPath);
    const failure = this.failNext;
    if (failure) {
      this.failNext = undefined;
      throw failure;
    }
    return work();
  }
}
