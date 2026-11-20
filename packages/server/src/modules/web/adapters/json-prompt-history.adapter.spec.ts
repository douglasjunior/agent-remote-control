import { MAX_PROMPT_HISTORY } from '@agent-remote-control/protocol/limits';
import { Logger } from '@nestjs/common';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dataDirectoryAt } from '../../paths/testing/fixed-directories.js';
import { FileLockTimeoutError } from '../../storage/ports/file-lock.port.js';
import type { ILockedFilesPort } from '../../storage/ports/locked-files.port.js';
import { createNodeLockedFiles } from '../../storage/testing/node-locked-files.js';
import { StubFileLock } from '../../storage/testing/stub-file-lock.js';

import { JsonPromptHistoryAdapter } from './json-prompt-history.adapter.js';


describe('JsonPromptHistoryAdapter', () => {
  let dataDir: string;
  const createHistory = (files: ILockedFilesPort = createNodeLockedFiles()) => new JsonPromptHistoryAdapter(dataDirectoryAt(dataDir), files);
  const file = () => join(dataDir, 'web', 'prompt-history.json');
  const seedFile = (content: string) => {
    mkdirSync(join(dataDir, 'web'), { recursive: true });
    writeFileSync(file(), content);
  };

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'prompt-history-'));
  });

  afterEach(() => {
    rs.restoreAllMocks();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('should start empty', async () => {
    expect(await createHistory().list()).toEqual([]);
  });

  it('should list the most recent prompt first and persist it', async () => {
    const history = createHistory();

    await history.append('first');
    await history.append('second');

    expect(await history.list()).toEqual(['second', 'first']);
    expect(JSON.parse(readFileSync(file(), 'utf-8'))).toEqual(['second', 'first']);
  });

  it('should survive a restart', async () => {
    await createHistory().append('kept');

    expect(await createHistory().list()).toEqual(['kept']);
  });

  it('should not repeat the latest prompt', async () => {
    const history = createHistory();

    await history.append('same');
    await history.append('same');

    expect(await history.list()).toEqual(['same']);
  });

  it('should keep only the most recent prompts', async () => {
    const history = createHistory();

    for (let index = 0; index <= MAX_PROMPT_HISTORY; index += 1) {
      await history.append(`prompt ${index}`);
    }

    const prompts = await history.list();
    expect(prompts).toHaveLength(MAX_PROMPT_HISTORY);
    expect(prompts[0]).toBe(`prompt ${MAX_PROMPT_HISTORY}`);
    expect(prompts.at(-1)).toBe('prompt 1');
  });

  it('should truncate an oversized stored list to the limit', async () => {
    seedFile(JSON.stringify(Array.from({ length: MAX_PROMPT_HISTORY + 5 }, (_, index) => `p${index}`)));

    expect(await createHistory().list()).toHaveLength(MAX_PROMPT_HISTORY);
  });

  it('should ignore a stored file with the wrong shape and warn', async () => {
    const warn = rs.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    seedFile(JSON.stringify({ not: 'a list' }));

    expect(await createHistory().list()).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('prompt_history_invalid_file'));
  });

  it('should log a prompt that cannot take the lock and leave it out, without rejecting', async () => {
    const error = rs.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const lock = new StubFileLock();
    const history = createHistory(createNodeLockedFiles(lock));
    await history.append('kept');
    lock.failNext = new FileLockTimeoutError(`${file()}.lock`, 15_000);

    await expect(history.append('x')).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith(`prompt_history_write_failed: Timed out after 15000ms waiting for the lock ${file()}.lock`);
    expect(await history.list()).toEqual(['kept']);
  });

  it('should keep every prompt appended at once by this process and another', async () => {
    const history = createHistory();
    const otherProcess = createHistory();

    await Promise.all(['a', 'b', 'c', 'd'].map((prompt, index) => (index % 2 === 0 ? history : otherProcess).append(prompt)));

    expect([...await createHistory().list()].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('should describe a failure that is not an Error', async () => {
    const error = rs.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const lock = new StubFileLock();
    lock.withLock = async () => Promise.reject('denied');

    await createHistory(createNodeLockedFiles(lock)).append('x');

    expect(error).toHaveBeenCalledWith('prompt_history_write_failed: denied');
  });
});
