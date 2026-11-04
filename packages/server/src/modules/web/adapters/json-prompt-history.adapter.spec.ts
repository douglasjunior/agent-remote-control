import { MAX_PROMPT_HISTORY } from '@agent-remote-control/protocol/limits';
import { Logger } from '@nestjs/common';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { JsonPromptHistoryAdapter } from './json-prompt-history.adapter.js';


describe('JsonPromptHistoryAdapter', () => {
  let dataDir: string;
  const file = () => join(dataDir, 'web', 'prompt-history.json');
  const seedFile = (content: string) => {
    mkdirSync(join(dataDir, 'web'), { recursive: true });
    writeFileSync(file(), content);
  };

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'prompt-history-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('starts empty', async () => {
    expect(await new JsonPromptHistoryAdapter(dataDir).list()).toEqual([]);
  });

  it('lists the most recent prompt first and persists it', async () => {
    const history = new JsonPromptHistoryAdapter(dataDir);

    await history.append('first');
    await history.append('second');

    expect(await history.list()).toEqual(['second', 'first']);
    expect(JSON.parse(readFileSync(file(), 'utf-8'))).toEqual(['second', 'first']);
  });

  it('survives a restart', async () => {
    await new JsonPromptHistoryAdapter(dataDir).append('kept');

    expect(await new JsonPromptHistoryAdapter(dataDir).list()).toEqual(['kept']);
  });

  it('does not repeat the latest prompt', async () => {
    const history = new JsonPromptHistoryAdapter(dataDir);

    await history.append('same');
    await history.append('same');

    expect(await history.list()).toEqual(['same']);
  });

  it('keeps only the most recent prompts', async () => {
    const history = new JsonPromptHistoryAdapter(dataDir);

    for (let index = 0; index <= MAX_PROMPT_HISTORY; index += 1) {
      await history.append(`prompt ${index}`);
    }

    const prompts = await history.list();
    expect(prompts).toHaveLength(MAX_PROMPT_HISTORY);
    expect(prompts[0]).toBe(`prompt ${MAX_PROMPT_HISTORY}`);
    expect(prompts.at(-1)).toBe('prompt 1');
  });

  it('truncates an oversized stored list to the limit', async () => {
    seedFile(JSON.stringify(Array.from({ length: MAX_PROMPT_HISTORY + 5 }, (_, index) => `p${index}`)));

    expect(await new JsonPromptHistoryAdapter(dataDir).list()).toHaveLength(MAX_PROMPT_HISTORY);
  });

  it('ignores a stored file with the wrong shape and warns', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    seedFile(JSON.stringify({ not: 'a list' }));

    expect(await new JsonPromptHistoryAdapter(dataDir).list()).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('prompt_history_invalid_file'));
  });

  it('logs a failed write without rejecting', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    mkdirSync(join(dataDir, 'web'), { recursive: true });
    mkdirSync(file());
    const history = new JsonPromptHistoryAdapter(dataDir);

    await expect(history.append('x')).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith(expect.stringContaining('prompt_history_write_failed'));
    expect(await history.list()).toEqual(['x']);
  });
});
