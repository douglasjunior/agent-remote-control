import { Logger } from '@nestjs/common';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

import { dataDirectoryAt } from '../../paths/testing/fixed-directories.js';
import { FileLockTimeoutError } from '../../storage/ports/file-lock.port.js';
import { createNodeLockedFiles } from '../../storage/testing/node-locked-files.js';
import { StubFileLock } from '../../storage/testing/stub-file-lock.js';

import { LegacyJsonFilesService } from './legacy-json-files.service.js';


describe('LegacyJsonFilesService', () => {
  let dataDir: string;
  let lock: StubFileLock;
  let files: LegacyJsonFilesService;
  const seed = (path: string, content: string) => {
    mkdirSync(join(dataDir, path, '..'), { recursive: true });
    writeFileSync(join(dataDir, path), content);
  };

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'legacy-files-'));
    lock = new StubFileLock();
    files = new LegacyJsonFilesService(dataDirectoryAt(dataDir), lock, createNodeLockedFiles(lock));
  });

  afterEach(() => {
    rs.restoreAllMocks();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('should read a file that matches the schema under the lock its store wrote it with', async () => {
    seed('web/list.json', '["a","b"]');

    expect(await files.read(join('web', 'list.json'), z.array(z.string()))).toEqual(['a', 'b']);
    expect(lock.lockPaths).toEqual([join(dataDir, 'web', 'list.json.lock')]);
  });

  it('should read nothing from a missing file', async () => {
    expect(await files.read('missing.json', z.array(z.string()))).toBeUndefined();
  });

  it('should skip and log a file that is not valid JSON or does not match the schema', async () => {
    const warn = rs.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    seed('broken.json', '{ broken');
    seed('shape.json', '{"not":"a list"}');

    expect(await files.read('broken.json', z.array(z.string()))).toBeUndefined();
    expect(await files.read('shape.json', z.array(z.string()))).toBeUndefined();
    expect(warn).toHaveBeenCalledWith('legacy_file_skipped: broken.json does not match the format it was written in');
    expect(warn).toHaveBeenCalledWith('legacy_file_skipped: shape.json does not match the format it was written in');
  });

  it('should reject a read whose lock is not taken', async () => {
    seed('list.json', '[]');
    lock.failNext = new FileLockTimeoutError('list.json.lock', 1);

    await expect(files.read('list.json', z.array(z.string()))).rejects.toThrow(FileLockTimeoutError);
  });

  it('should list the json files of a directory relative to the data directory', async () => {
    seed('web/history/b.json', '[]');
    seed('web/history/a.json', '[]');
    seed('web/history/a.json.lock', '{}');
    mkdirSync(join(dataDir, 'web', 'history', 'folder.json'));

    expect(await files.list(join('web', 'history'))).toEqual([join('web', 'history', 'a.json'), join('web', 'history', 'b.json')]);
  });

  it('should list the temporary files of a directory', async () => {
    seed('web/history/a.json', '[]');
    seed('web/history/a.json.7b1f.tmp', '[');
    seed('web/history/a.json.lock', '{}');

    expect(await files.listTemporary(join('web', 'history'))).toEqual([join('web', 'history', 'a.json.7b1f.tmp')]);
  });

  it('should list nothing for a missing directory and reject other failures', async () => {
    seed('web/file', '');

    expect(await files.list('missing')).toEqual([]);
    await expect(files.list(join('web', 'file'))).rejects.toThrow('ENOTDIR');
  });

  it('should move files into the backup directory keeping their paths', async () => {
    seed('web/conversations.json', '[]');
    seed('web/history/a.json', '["a"]');

    const moved = await files.backUp([join('web', 'conversations.json'), join('web', 'history', 'a.json')], 'backup/now');

    expect(moved).toBe(2);
    expect(existsSync(join(dataDir, 'web', 'conversations.json'))).toBe(false);
    expect(readFileSync(join(dataDir, 'backup', 'now', 'web', 'history', 'a.json'), 'utf-8')).toBe('["a"]');
  });

  it('should log a file it cannot move and move the others', async () => {
    const warn = rs.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    seed('kept.json', '[]');

    const moved = await files.backUp(['gone.json', 'kept.json'], 'backup');

    expect(moved).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^legacy_file_not_backed_up: gone\.json: Error: ENOENT/));
    expect(existsSync(join(dataDir, 'backup', 'kept.json'))).toBe(true);
  });
});
