import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';

import { FileLockTimeoutError } from '../ports/file-lock.port.js';

import { NodeFileLockAdapter } from './node-file-lock.adapter.js';


rs.mock('node:fs/promises', () => ({
  mkdir: rs.fn(),
  readFile: rs.fn(),
  rm: rs.fn(),
  stat: rs.fn(),
  writeFile: rs.fn(),
}));

const LOCK_PATH = '/data/agent-settings.json.lock';
const OTHER_PID = 424242;

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: simulated`), { code });
}

/** One lockfile on a fake disk; `exclusiveCreates` counts the attempts to create it. */
function installFakeDisk() {
  const disk = { present: false, data: '', mtimeMs: 0, exclusiveCreates: 0 };
  rs.mocked(mkdir).mockResolvedValue(undefined);
  rs.mocked(writeFile).mockImplementation(async (_path, data, options) => {
    const flag = typeof options === 'object' && options !== null ? options.flag : undefined;
    if (flag === 'wx') {
      disk.exclusiveCreates += 1;
      if (disk.present) {
        throw errno('EEXIST');
      }
    }
    Object.assign(disk, { present: true, data: String(data), mtimeMs: Date.now() });
  });
  rs.mocked(readFile).mockImplementation(async () => {
    if (!disk.present) {
      throw errno('ENOENT');
    }
    return disk.data;
  });
  rs.mocked(stat).mockImplementation(async () => {
    if (!disk.present) {
      throw errno('ENOENT');
    }
    return { mtimeMs: disk.mtimeMs } as Awaited<ReturnType<typeof stat>>;
  });
  rs.mocked(rm).mockImplementation(async () => {
    disk.present = false;
  });
  return {
    disk,
    holdByAnotherProcess: (payload = JSON.stringify({ pid: OTHER_PID, token: 'other' }), mtimeMs = Date.now()) => {
      Object.assign(disk, { present: true, data: payload, mtimeMs });
    },
  };
}

describe('NodeFileLockAdapter', () => {
  let adapter: NodeFileLockAdapter;
  let warn: ReturnType<typeof rs.spyOn>;

  beforeEach(() => {
    rs.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    rs.setSystemTime(1_000_000);
    warn = rs.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    adapter = new NodeFileLockAdapter();
  });

  afterEach(() => {
    rs.useRealTimers();
    rs.restoreAllMocks();
    for (const fn of [mkdir, readFile, rm, stat, writeFile]) {
      rs.mocked(fn).mockReset();
    }
  });

  it('should hold the lockfile, with the owner pid, only while the work runs', async () => {
    const { disk } = installFakeDisk();
    const seen: unknown[] = [];

    const result = await adapter.withLock(LOCK_PATH, async () => {
      seen.push(disk.present, JSON.parse(disk.data).pid);
      return 'value';
    });

    expect(result).toBe('value');
    expect(seen).toEqual([true, process.pid]);
    expect(disk.present).toBe(false);
    expect(mkdir).toHaveBeenCalledWith('/data', { recursive: true });
    expect(writeFile).toHaveBeenCalledWith(LOCK_PATH, expect.any(String), { flag: 'wx', mode: 0o600 });
  });

  it('should release the lockfile when the work throws', async () => {
    const { disk } = installFakeDisk();

    await expect(adapter.withLock(LOCK_PATH, async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');

    expect(disk.present).toBe(false);
  });

  it('should run the callers of one path in this process one at a time, in call order, without polling the disk', async () => {
    const { disk } = installFakeDisk();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const runs = [
      adapter.withLock(LOCK_PATH, async () => {
        order.push('first');
        await firstHeld;
      }),
      adapter.withLock(LOCK_PATH, async () => {
        order.push('second');
      }),
      adapter.withLock(LOCK_PATH, async () => {
        order.push('third');
      }),
    ];
    await rs.advanceTimersByTimeAsync(1_000);
    expect(order).toEqual(['first']);

    releaseFirst();
    await Promise.all(runs);

    expect(order).toEqual(['first', 'second', 'third']);
    expect(disk.exclusiveCreates).toBe(3);
    expect(disk.present).toBe(false);
  });

  it('should keep separate paths independent', async () => {
    installFakeDisk();
    rs.mocked(writeFile).mockResolvedValue(undefined);
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = adapter.withLock('/data/a.lock', async () => {
      await firstHeld;
      order.push('a');
    });
    await adapter.withLock('/data/b.lock', async () => {
      order.push('b');
    });
    releaseFirst();
    await first;

    expect(order).toEqual(['b', 'a']);
  });

  it('should wait for the lockfile of another process and take it once released', async () => {
    const { disk, holdByAnotherProcess } = installFakeDisk();
    holdByAnotherProcess();
    rs.spyOn(process, 'kill').mockReturnValue(true);
    let ran = false;

    const run = adapter.withLock(LOCK_PATH, async () => {
      ran = true;
    });
    await rs.advanceTimersByTimeAsync(500);
    expect(ran).toBe(false);

    disk.present = false;
    await rs.advanceTimersByTimeAsync(50);
    await run;

    expect(ran).toBe(true);
    expect(disk.present).toBe(false);
  });

  it('should drop at once a lockfile whose owner process no longer exists', async () => {
    const { holdByAnotherProcess } = installFakeDisk();
    holdByAnotherProcess();
    const kill = rs.spyOn(process, 'kill').mockImplementation(() => {
      throw errno('ESRCH');
    });

    await expect(adapter.withLock(LOCK_PATH, async () => 'ok', { timeoutMs: 10 })).resolves.toBe('ok');

    expect(kill).toHaveBeenCalledWith(OTHER_PID, 0);
    expect(warn).toHaveBeenCalledWith(`[Lock Orphan Dropped] ${LOCK_PATH}`);
  });

  it('should drop a lockfile older than staleMs', async () => {
    const { holdByAnotherProcess } = installFakeDisk();
    holdByAnotherProcess('{}', 0);

    await expect(adapter.withLock(LOCK_PATH, async () => 'ok', { staleMs: 30_000 })).resolves.toBe('ok');

    expect(warn).toHaveBeenCalledWith(`[Lock Stale Dropped] ${LOCK_PATH}, Age=1000000ms`);
  });

  it.each([
    ['is alive', () => true],
    [
      'belongs to another user', () => {
        throw errno('EPERM');
      },
    ],
  ])('should time out on a recent lockfile whose owner process %s, leaving it in place', async (_label, kill) => {
    const { disk, holdByAnotherProcess } = installFakeDisk();
    holdByAnotherProcess();
    rs.spyOn(process, 'kill').mockImplementation(kill as typeof process.kill);
    let ran = false;

    const run = adapter.withLock(LOCK_PATH, async () => {
      ran = true;
    }, { timeoutMs: 200 });
    const assertion = expect(run).rejects.toEqual(new FileLockTimeoutError(LOCK_PATH, 200));
    await rs.advanceTimersByTimeAsync(300);
    await assertion;

    expect(ran).toBe(false);
    expect(disk.present).toBe(true);
    expect(JSON.parse(disk.data).token).toBe('other');
  });

  it.each([
    ['an unreadable payload', 'held'],
    ['a payload that is not an object', '42'],
    ['a payload without a pid', JSON.stringify({ token: 'other' })],
    ['the pid of this process', JSON.stringify({ pid: process.pid, token: 'other' })],
  ])('should leave %s to the age criterion without probing the process', async (_label, payload) => {
    const { holdByAnotherProcess } = installFakeDisk();
    holdByAnotherProcess(payload);
    const kill = rs.spyOn(process, 'kill');

    const run = adapter.withLock(LOCK_PATH, async () => 'ok', { timeoutMs: 200, staleMs: 1_000 });
    const assertion = expect(run).rejects.toBeInstanceOf(FileLockTimeoutError);
    await rs.advanceTimersByTimeAsync(300);
    await assertion;

    expect(kill).not.toHaveBeenCalled();
  });

  it('should time out a caller still queued behind a holder of this process, and let the next one run', async () => {
    installFakeDisk();
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const order: string[] = [];

    const first = adapter.withLock(LOCK_PATH, async () => {
      await firstHeld;
      order.push('first');
    });
    const second = adapter.withLock(LOCK_PATH, async () => {
      order.push('second');
    }, { timeoutMs: 100 });
    const third = adapter.withLock(LOCK_PATH, async () => {
      order.push('third');
    });
    const assertion = expect(second).rejects.toEqual(new FileLockTimeoutError(LOCK_PATH, 100));
    await rs.advanceTimersByTimeAsync(200);
    await assertion;
    releaseFirst();
    await Promise.all([first, third]);

    expect(order).toEqual(['first', 'third']);
  });

  it('should hand the turn on when the head of the queue times out on the lockfile of another process', async () => {
    const { disk, holdByAnotherProcess } = installFakeDisk();
    holdByAnotherProcess();
    rs.spyOn(process, 'kill').mockReturnValue(true);

    const first = adapter.withLock(LOCK_PATH, async () => 'first', { timeoutMs: 100 });
    const second = adapter.withLock(LOCK_PATH, async () => 'second', { timeoutMs: 1_000 });
    const assertion = expect(first).rejects.toBeInstanceOf(FileLockTimeoutError);
    await rs.advanceTimersByTimeAsync(150);
    await assertion;
    disk.present = false;
    await rs.advanceTimersByTimeAsync(100);

    await expect(second).resolves.toBe('second');
  });

  it('should rethrow an error other than EEXIST without retrying, and free the queue', async () => {
    installFakeDisk();
    rs.mocked(writeFile).mockRejectedValueOnce(errno('EACCES'));

    await expect(adapter.withLock(LOCK_PATH, async () => 'never')).rejects.toMatchObject({ code: 'EACCES' });
    await expect(adapter.withLock(LOCK_PATH, async () => 'next')).resolves.toBe('next');
  });

  it('should log a failed check of the lockfile and keep trying until the timeout', async () => {
    const { holdByAnotherProcess } = installFakeDisk();
    holdByAnotherProcess();
    rs.mocked(readFile).mockRejectedValue(errno('EACCES'));

    const run = adapter.withLock(LOCK_PATH, async () => 'never', { timeoutMs: 100 });
    const assertion = expect(run).rejects.toBeInstanceOf(FileLockTimeoutError);
    await rs.advanceTimersByTimeAsync(200);
    await assertion;

    expect(warn).toHaveBeenCalledWith(`[Lock Check Failed] ${LOCK_PATH}: EACCES: simulated`);
  });

  it('should retry quietly when the lockfile disappears between the failed create and the check', async () => {
    const { disk } = installFakeDisk();
    rs.mocked(writeFile).mockImplementationOnce(async () => {
      throw errno('EEXIST');
    });

    const run = adapter.withLock(LOCK_PATH, async () => 'ok');
    await rs.advanceTimersByTimeAsync(50);

    await expect(run).resolves.toBe('ok');
    expect(warn).not.toHaveBeenCalled();
    expect(disk.present).toBe(false);
  });

  it('should leave in place a lockfile that another holder took over as stale', async () => {
    const { disk } = installFakeDisk();

    await adapter.withLock(LOCK_PATH, async () => {
      disk.data = JSON.stringify({ pid: OTHER_PID, token: 'successor' });
    });

    expect(disk.present).toBe(true);
    expect(rm).not.toHaveBeenCalled();
  });

  it('should log a failed release and still return the result of the work', async () => {
    installFakeDisk();
    rs.mocked(rm).mockRejectedValue(new Error('rm denied'));

    await expect(adapter.withLock(LOCK_PATH, async () => 'value')).resolves.toBe('value');

    expect(warn).toHaveBeenCalledWith(`[Lock Release Failed] ${LOCK_PATH}: rm denied`);
  });

  it('should say nothing when the lockfile is already gone at release', async () => {
    const { disk } = installFakeDisk();

    await adapter.withLock(LOCK_PATH, async () => {
      disk.present = false;
    });

    expect(warn).not.toHaveBeenCalled();
  });

  it('should describe a thrown value that is not an Error', async () => {
    installFakeDisk();
    rs.mocked(rm).mockRejectedValue('denied');

    await adapter.withLock(LOCK_PATH, async () => undefined);

    expect(warn).toHaveBeenCalledWith(`[Lock Release Failed] ${LOCK_PATH}: denied`);
  });
});
