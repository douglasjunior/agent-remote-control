import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core';
import { link, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';

import { FileLockTimeoutError } from '../ports/file-lock.port.js';

import { NodeFileLockAdapter } from './node-file-lock.adapter.js';


rs.mock('node:fs/promises', () => ({
  link: rs.fn(),
  mkdir: rs.fn(),
  readFile: rs.fn(),
  rename: rs.fn(),
  rm: rs.fn(),
  stat: rs.fn(),
  writeFile: rs.fn(),
}));

const LOCK_PATH = '/data/agent-settings.json.lock';
const OTHER_PID = 424242;

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: simulated`), { code });
}

function ownedBy(owner: { host?: string; pid?: number; token?: string }): string {
  return JSON.stringify({ host: hostname(), pid: OTHER_PID, token: 'other', ...owner });
}

/** A fake disk of files by path; `disk` is the lockfile at `LOCK_PATH`, and `exclusiveCreates` counts the attempts to create one. */
function installFakeDisk() {
  const files = new Map<string, { data: string; mtimeMs: number }>();
  let exclusiveCreates = 0;
  const fileAt = (path: unknown) => {
    const file = files.get(String(path));
    if (!file) {
      throw errno('ENOENT');
    }
    return file;
  };
  rs.mocked(mkdir).mockResolvedValue(undefined);
  rs.mocked(writeFile).mockImplementation(async (path, data, options) => {
    const flag = typeof options === 'object' && options !== null ? options.flag : undefined;
    if (flag === 'wx') {
      exclusiveCreates += 1;
      if (files.has(String(path))) {
        throw errno('EEXIST');
      }
    }
    files.set(String(path), { data: String(data), mtimeMs: Date.now() });
  });
  rs.mocked(readFile).mockImplementation(async path => fileAt(path).data);
  rs.mocked(stat).mockImplementation(async path => ({ mtimeMs: fileAt(path).mtimeMs }) as Awaited<ReturnType<typeof stat>>);
  rs.mocked(rm).mockImplementation(async (path) => {
    files.delete(String(path));
  });
  rs.mocked(rename).mockImplementation(async (from, to) => {
    files.set(String(to), fileAt(from));
    files.delete(String(from));
  });
  rs.mocked(link).mockImplementation(async (from, to) => {
    if (files.has(String(to))) {
      throw errno('EEXIST');
    }
    files.set(String(to), fileAt(from));
  });
  const hold = (payload = ownedBy({}), mtimeMs = Date.now()) => {
    files.set(LOCK_PATH, { data: payload, mtimeMs });
  };
  return {
    files,
    disk: {
      get present() {
        return files.has(LOCK_PATH);
      },
      set present(present: boolean) {
        if (!present) {
          files.delete(LOCK_PATH);
        }
      },
      get data() {
        return fileAt(LOCK_PATH).data;
      },
      set data(data: string) {
        fileAt(LOCK_PATH).data = data;
      },
      get exclusiveCreates() {
        return exclusiveCreates;
      },
    },
    holdByAnotherProcess: hold,
    /** Runs `change` on the disk right before the next rename, as another contender acting between the check and the takeover. */
    beforeNextRename: (change: () => void) => {
      const move = rs.mocked(rename).getMockImplementation()!;
      rs.mocked(rename).mockImplementationOnce(async (from, to) => {
        change();
        await move(from, to);
      });
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
    for (const fn of [link, mkdir, readFile, rename, rm, stat, writeFile]) {
      rs.mocked(fn).mockReset();
    }
  });

  it('should hold the lockfile, with the owner host and pid, only while the work runs', async () => {
    const { disk } = installFakeDisk();
    const seen: unknown[] = [];

    const result = await adapter.withLock(LOCK_PATH, async () => {
      const { host, pid } = JSON.parse(disk.data);
      seen.push(disk.present, host, pid);
      return 'value';
    });

    expect(result).toBe('value');
    expect(seen).toEqual([true, hostname(), process.pid]);
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

  it('should take over at once a lockfile whose owner process is gone', async () => {
    const { files, holdByAnotherProcess } = installFakeDisk();
    holdByAnotherProcess();
    const kill = rs.spyOn(process, 'kill').mockImplementation(() => {
      throw errno('ESRCH');
    });

    await expect(adapter.withLock(LOCK_PATH, async () => 'ok', { timeoutMs: 10 })).resolves.toBe('ok');

    expect(kill).toHaveBeenCalledWith(OTHER_PID, 0);
    expect(warn).toHaveBeenCalledWith(`[Lock Orphan Dropped] ${LOCK_PATH}`);
    expect([...files.keys()]).toEqual([]);
  });

  it('should take over at once a lockfile an earlier process of the same pid left', async () => {
    const { holdByAnotherProcess } = installFakeDisk();
    holdByAnotherProcess(ownedBy({ pid: process.pid, token: 'earlier' }));
    const kill = rs.spyOn(process, 'kill');

    await expect(adapter.withLock(LOCK_PATH, async () => 'ok', { timeoutMs: 10 })).resolves.toBe('ok');

    expect(kill).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(`[Lock Orphan Dropped] ${LOCK_PATH}`);
  });

  it('should take over at once the lockfile its own failed release left', async () => {
    const { disk } = installFakeDisk();
    rs.mocked(rm).mockRejectedValueOnce(new Error('rm denied'));
    await adapter.withLock(LOCK_PATH, async () => 'first');
    expect(disk.present).toBe(true);

    await expect(adapter.withLock(LOCK_PATH, async () => 'second', { timeoutMs: 10 })).resolves.toBe('second');

    expect(warn).toHaveBeenCalledWith(`[Lock Orphan Dropped] ${LOCK_PATH}`);
    expect(disk.present).toBe(false);
  });

  it('should wait for a lockfile another adapter of this process holds', async () => {
    const { disk } = installFakeDisk();
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = adapter.withLock(LOCK_PATH, () => firstHeld);
    await rs.advanceTimersByTimeAsync(0);
    const holder = JSON.parse(disk.data).token;

    const second = new NodeFileLockAdapter().withLock(LOCK_PATH, async () => 'never', { timeoutMs: 200 });
    const assertion = expect(second).rejects.toEqual(new FileLockTimeoutError(LOCK_PATH, 200));
    await rs.advanceTimersByTimeAsync(300);
    await assertion;

    expect(JSON.parse(disk.data).token).toBe(holder);
    releaseFirst();
    await first;
  });

  it('should take over a lockfile older than staleMs', async () => {
    const { files, holdByAnotherProcess } = installFakeDisk();
    holdByAnotherProcess('{}', 0);

    await expect(adapter.withLock(LOCK_PATH, async () => 'ok', { staleMs: 30_000 })).resolves.toBe('ok');

    expect(warn).toHaveBeenCalledWith(`[Lock Stale Dropped] ${LOCK_PATH}, Age=1000000ms`);
    expect([...files.keys()]).toEqual([]);
  });

  it('should outlast, with the default timeout, a lockfile that only its age gives away', async () => {
    const { holdByAnotherProcess } = installFakeDisk();
    holdByAnotherProcess(ownedBy({ host: 'another-host' }));

    const run = adapter.withLock(LOCK_PATH, async () => 'ok');
    await rs.advanceTimersByTimeAsync(10_100);

    await expect(run).resolves.toBe('ok');
  });

  it('should put back a live lockfile that took the place of the abandoned one before the takeover', async () => {
    const { files, disk, holdByAnotherProcess, beforeNextRename } = installFakeDisk();
    holdByAnotherProcess();
    rs.spyOn(process, 'kill').mockImplementation((pid) => {
      if (pid === OTHER_PID) {
        throw errno('ESRCH');
      }
      return true;
    });
    beforeNextRename(() => holdByAnotherProcess(ownedBy({ pid: OTHER_PID + 1, token: 'successor' })));
    let ran = false;

    const run = adapter.withLock(LOCK_PATH, async () => {
      ran = true;
    }, { timeoutMs: 200 });
    const assertion = expect(run).rejects.toEqual(new FileLockTimeoutError(LOCK_PATH, 200));
    await rs.advanceTimersByTimeAsync(300);
    await assertion;

    expect(ran).toBe(false);
    expect(JSON.parse(disk.data).token).toBe('successor');
    expect([...files.keys()]).toEqual([LOCK_PATH]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('should log a live lockfile it could not put back, and leave the path to the one created meanwhile', async () => {
    const { files, disk, holdByAnotherProcess, beforeNextRename } = installFakeDisk();
    holdByAnotherProcess();
    rs.spyOn(process, 'kill').mockImplementation((pid) => {
      if (pid === OTHER_PID) {
        throw errno('ESRCH');
      }
      return true;
    });
    beforeNextRename(() => holdByAnotherProcess(ownedBy({ pid: OTHER_PID + 1, token: 'successor' })));
    const putBack = rs.mocked(link).getMockImplementation()!;
    rs.mocked(link).mockImplementationOnce(async (from, to) => {
      holdByAnotherProcess(ownedBy({ pid: OTHER_PID + 2, token: 'third' }));
      await putBack(from, to);
    });

    const run = adapter.withLock(LOCK_PATH, async () => 'never', { timeoutMs: 200 });
    const assertion = expect(run).rejects.toBeInstanceOf(FileLockTimeoutError);
    await rs.advanceTimersByTimeAsync(300);
    await assertion;

    expect(warn).toHaveBeenCalledWith(`[Lock Check Failed] ${LOCK_PATH}: EEXIST: simulated`);
    expect(JSON.parse(disk.data).token).toBe('third');
    expect([...files.keys()]).toEqual([LOCK_PATH]);
  });

  it('should retry quietly when another contender takes the abandoned lockfile over first', async () => {
    const { disk, holdByAnotherProcess, beforeNextRename } = installFakeDisk();
    holdByAnotherProcess();
    rs.spyOn(process, 'kill').mockImplementation(() => {
      throw errno('ESRCH');
    });
    beforeNextRename(() => {
      disk.present = false;
    });

    await expect(adapter.withLock(LOCK_PATH, async () => 'ok', { timeoutMs: 10 })).resolves.toBe('ok');

    expect(warn).not.toHaveBeenCalled();
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
    ['a payload without a pid', JSON.stringify({ host: hostname(), token: 'other' })],
    ['a payload without a host', JSON.stringify({ pid: OTHER_PID, token: 'other' })],
    ['the pid of another host', ownedBy({ host: 'another-host' })],
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
      disk.data = ownedBy({ token: 'successor' });
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
