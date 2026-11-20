import { describe, expect, it } from '@rstest/core';

import { StubFileLock } from './stub-file-lock.js';


describe('StubFileLock', () => {
  it('should run the work, record the lock and fail only the next call when asked', async () => {
    const lock = new StubFileLock();
    lock.failNext = new Error('timed out');

    await expect(lock.withLock('/data/a.lock', async () => 'never')).rejects.toThrow('timed out');
    await expect(lock.withLock('/data/b.lock', async () => 'ran')).resolves.toBe('ran');

    expect(lock.lockPaths).toEqual(['/data/a.lock', '/data/b.lock']);
  });
});
