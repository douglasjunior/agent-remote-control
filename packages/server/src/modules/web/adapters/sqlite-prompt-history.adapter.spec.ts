import { MAX_PROMPT_HISTORY } from '@agent-remote-control/protocol/limits';
import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { createInMemoryDataSource } from '../../database/testing/in-memory-data-source.js';

import { SqlitePromptHistoryAdapter } from './sqlite-prompt-history.adapter.js';


describe('SqlitePromptHistoryAdapter', () => {
  let dataSource: DataSource;
  let history: SqlitePromptHistoryAdapter;

  beforeEach(async () => {
    dataSource = await createInMemoryDataSource();
    history = new SqlitePromptHistoryAdapter(dataSource);
  });

  afterEach(async () => {
    rs.restoreAllMocks();
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  });

  it('should start empty', async () => {
    expect(await history.list()).toEqual([]);
  });

  it('should list the most recent prompt first and keep it for another store', async () => {
    await history.append('first');
    await history.append('second');

    expect(await history.list()).toEqual(['second', 'first']);
    expect(await new SqlitePromptHistoryAdapter(dataSource).list()).toEqual(['second', 'first']);
  });

  it('should not repeat the latest prompt', async () => {
    await history.append('same');
    await history.append('same');
    await history.append('other');
    await history.append('same');

    expect(await history.list()).toEqual(['same', 'other', 'same']);
  });

  it('should keep only the most recent prompts', async () => {
    for (let index = 0; index < MAX_PROMPT_HISTORY + 5; index += 1) {
      await history.append(`prompt ${index}`);
    }

    const prompts = await history.list();

    expect(prompts).toHaveLength(MAX_PROMPT_HISTORY);
    expect(prompts[0]).toBe(`prompt ${MAX_PROMPT_HISTORY + 4}`);
    expect(await dataSource.query('SELECT COUNT(*) AS "count" FROM "prompt_history"')).toEqual([{ count: MAX_PROMPT_HISTORY }]);
  });

  it('should keep every prompt appended at once', async () => {
    await Promise.all(['a', 'b', 'c'].map(prompt => history.append(prompt)));

    expect([...await history.list()].sort()).toEqual(['a', 'b', 'c']);
  });

  it('should log a prompt that cannot be written and leave it out, without rejecting', async () => {
    const error = rs.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await dataSource.destroy();

    await expect(history.append('lost')).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith(expect.stringContaining('prompt_history_write_failed: '));
  });

  it('should describe a failure that is not an Error', async () => {
    const error = rs.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    rs.spyOn(dataSource, 'query').mockRejectedValue('disk gone');

    await history.append('lost');

    expect(error).toHaveBeenCalledWith('prompt_history_write_failed: disk gone');
  });
});
