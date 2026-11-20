import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import * as actualFs from 'node:fs/promises' with { rstest: 'importActual' };
import { open, rename, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { JsonFileOptions } from '../ports/locked-files.port.js';
import { StubFileLock } from '../testing/stub-file-lock.js';

import { NodeFileLockAdapter } from './node-file-lock.adapter.js';
import { NodeLockedFilesAdapter } from './node-locked-files.adapter.js';


rs.mock('node:fs/promises', () => ({
  ...actualFs,
  open: rs.fn(actualFs.open),
  rename: rs.fn(actualFs.rename),
  stat: rs.fn(actualFs.stat),
}));

type Counter = { readonly count: number };

describe('NodeLockedFilesAdapter', () => {
  let rootDir: string;
  let path: string;
  let parsed: number;
  const counterOptions: JsonFileOptions<Counter> = {
    parse: (content) => {
      parsed += 1;
      return typeof (content as Counter | null)?.count === 'number' ? content as Counter : { count: -1 };
    },
    empty: { count: 0 },
  };
  const counter = (files = new NodeLockedFilesAdapter(new NodeFileLockAdapter())) => files.json(path, counterOptions);
  const increment = (current: Counter): Counter => ({ count: current.count + 1 });

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'locked-files-'));
    path = join(rootDir, 'nested', 'counter.json');
    parsed = 0;
  });

  afterEach(() => {
    rs.restoreAllMocks();
    rs.mocked(open).mockImplementation(actualFs.open);
    rs.mocked(rename).mockImplementation(actualFs.rename);
    rs.mocked(stat).mockImplementation(actualFs.stat);
    rmSync(rootDir, { recursive: true, force: true });
  });

  describe('json', () => {
    it('should read a missing file as empty', async () => {
      await expect(counter().read()).resolves.toEqual({ count: 0 });
    });

    it('should write the value as indented JSON and read it back', async () => {
      const file = counter();

      await expect(file.update(increment)).resolves.toEqual({ count: 1 });

      expect(readFileSync(path, 'utf-8')).toBe('{\n  "count": 1\n}');
      await expect(counter().read()).resolves.toEqual({ count: 1 });
    });

    it('should write what serialize returns', async () => {
      const files = new NodeLockedFilesAdapter(new NodeFileLockAdapter());
      const file = files.json<ReadonlyMap<string, number>>(path, {
        parse: content => new Map(Object.entries(content as Record<string, number>)),
        empty: new Map(),
        serialize: value => Object.fromEntries(value),
      });

      await file.update(current => new Map(current).set('a', 1));

      expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({ a: 1 });
    });

    it('should apply an update to what another writer stored after this one last read', async () => {
      const file = counter();
      const otherProcess = counter();
      await file.update(increment);
      await file.read();

      await otherProcess.update(increment);
      await file.update(increment);

      await expect(counter().read()).resolves.toEqual({ count: 3 });
    });

    it('should keep every one of many concurrent updates, from this process and from another', async () => {
      const file = counter();
      const otherProcess = counter();

      await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 === 0 ? file : otherProcess).update(increment)));

      await expect(counter().read()).resolves.toEqual({ count: 20 });
      expect(readdirSync(join(rootDir, 'nested'))).toEqual(['counter.json']);
    });

    it('should parse the file only when it changed since the last read or write', async () => {
      const file = counter();
      await file.update(increment);
      await file.read();
      await file.update(increment);
      await file.read();
      expect(parsed).toBe(0);

      writeFileSync(path, JSON.stringify({ count: 10 }));

      await expect(file.read()).resolves.toEqual({ count: 10 });
      await expect(file.read()).resolves.toEqual({ count: 10 });
      expect(parsed).toBe(1);
    });

    it('should read the file as empty once it is removed', async () => {
      const file = counter();
      await file.update(increment);

      rmSync(path);

      await expect(file.read()).resolves.toEqual({ count: 0 });
    });

    it('should read a file that is not valid JSON as empty, say so, and replace it on the next update', async () => {
      const warn = rs.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      writeFileSync(join(rootDir, 'counter.json'), '{"count": 4');
      path = join(rootDir, 'counter.json');
      const file = counter();

      await expect(file.read()).resolves.toEqual({ count: 0 });
      await file.update(increment);

      expect(warn).toHaveBeenCalledWith(`[Unreadable File] ${path} is not valid JSON; it reads as empty until a write replaces it`);
      expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({ count: 1 });
    });

    it('should leave the file alone when the change returns undefined', async () => {
      const file = counter();

      await expect(file.update(() => undefined)).resolves.toEqual({ count: 0 });

      expect(readdirSync(join(rootDir, 'nested'))).toEqual([]);
    });

    it('should wait for an asynchronous change', async () => {
      await expect(counter().update(async current => increment(current))).resolves.toEqual({ count: 1 });
    });

    it('should create the file and its directories with the modes asked for', async () => {
      const files = new NodeLockedFilesAdapter(new NodeFileLockAdapter());
      const file = files.json(path, { ...counterOptions, mode: 0o600, directoryMode: 0o700 });

      await file.update(increment);

      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(statSync(join(rootDir, 'nested')).mode & 0o777).toBe(0o700);
    });

    it('should reject a failed write, leave the file as it was and remove the temporary file', async () => {
      const file = counter();
      await file.update(increment);
      rs.mocked(rename).mockRejectedValueOnce(new Error('disk full'));

      await expect(file.update(increment)).rejects.toThrow('disk full');

      expect(readdirSync(join(rootDir, 'nested'))).toEqual(['counter.json']);
      await expect(file.read()).resolves.toEqual({ count: 1 });
      await expect(file.update(increment)).resolves.toEqual({ count: 2 });
    });

    it('should reject a change that throws and leave the file as it was', async () => {
      const file = counter();

      await expect(file.update(() => {
        throw new Error('invalid');
      })).rejects.toThrow('invalid');

      expect(readdirSync(join(rootDir, 'nested'))).toEqual([]);
    });

    it('should reject a read that cannot inspect the file', async () => {
      rs.mocked(stat).mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }));

      await expect(counter().read()).rejects.toThrow('denied');
    });

    it('should read a file removed between its inspection and its opening as empty', async () => {
      writeFileSync(join(rootDir, 'counter.json'), '{"count": 3}');
      path = join(rootDir, 'counter.json');
      rs.mocked(open).mockRejectedValueOnce(Object.assign(new Error('gone'), { code: 'ENOENT' }));

      await expect(counter().read()).resolves.toEqual({ count: 0 });
    });

    it('should reject a read that cannot open the file', async () => {
      writeFileSync(join(rootDir, 'counter.json'), '{}');
      path = join(rootDir, 'counter.json');
      rs.mocked(open).mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }));

      await expect(counter().read()).rejects.toThrow('denied');
    });

    it('should guard the file with the lock next to it, or with the one asked for', async () => {
      const lock = new StubFileLock();
      const files = new NodeLockedFilesAdapter(lock);

      await files.json(path, counterOptions).update(increment);
      await files.json(path, { ...counterOptions, lockPath: join(rootDir, 'shared.lock') }).update(increment);

      expect(lock.lockPaths).toEqual([`${path}.lock`, join(rootDir, 'shared.lock')]);
    });
  });

  describe('text', () => {
    it('should read a missing file as undefined, and the text once written', async () => {
      const files = new NodeLockedFilesAdapter(new NodeFileLockAdapter());
      const file = files.text(path);

      await expect(file.read()).resolves.toBeUndefined();
      await expect(file.update(current => current ?? 'created')).resolves.toBe('created');
      await expect(file.update(current => current ?? 'again')).resolves.toBe('created');

      expect(readFileSync(path, 'utf-8')).toBe('created');
    });
  });
});
