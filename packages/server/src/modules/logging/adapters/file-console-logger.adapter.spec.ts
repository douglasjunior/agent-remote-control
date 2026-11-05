import { Logger } from '@nestjs/common';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runInLogConversation } from '../utils/log-conversation.util.js';

import { FileConsoleLoggerAdapter } from './file-console-logger.adapter.js';


describe('FileConsoleLoggerAdapter', () => {
  let directory: string;
  let logger: FileConsoleLoggerAdapter;
  const file = () => join(directory, 'server-2026-03-10.jsonl');
  const records = () => readFileSync(file(), 'utf8').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-10T12:00:00.000Z'));
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    directory = join(mkdtempSync(join(tmpdir(), 'arc-logs-')), 'logs');
    logger = new FileConsoleLoggerAdapter(directory, 14);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Logger.overrideLogger(['log', 'error', 'warn']);
    rmSync(join(directory, '..'), { recursive: true, force: true });
  });

  it('records the level, context and message, and still prints to the console', () => {
    logger.log('hello', 'Context');

    expect(records()).toEqual([{ at: '2026-03-10T12:00:00.000Z', level: 'log', context: 'Context', message: 'hello' }]);
    expect(process.stdout.write).toHaveBeenCalled();
    expect(statSync(file()).mode & 0o777).toBe(0o600);
  });

  it('records the conversation the message was logged in', () => {
    runInLogConversation('web-1', () => logger.warn('careful', 'Context'));

    expect(records()[0]).toMatchObject({ level: 'warn', conversationId: 'web-1', message: 'careful' });
  });

  it('records the stack of an error', () => {
    logger.error('boom', 'the stack', 'Context');

    expect(records()[0]).toMatchObject({ level: 'error', message: 'boom', stack: 'the stack' });
  });

  it('records what is not a string', () => {
    logger.log({ a: 1 }, 'Context');
    logger.log(new Error('failed'), 'Context');

    expect(records().map(record => record.message)).toEqual(['{"a":1}', 'failed']);
  });

  it('receives the logs of Nest loggers once installed', () => {
    Logger.overrideLogger(logger);

    new Logger('Service').log('through nest');

    expect(records()[0]).toMatchObject({ context: 'Service', message: 'through nest' });
  });

  it('keeps the startup access token out of the file', () => {
    logger.log('Web interface access token: secret', 'WebAccessTokenService');

    expect(existsSync(file())).toBe(false);
    expect(process.stdout.write).toHaveBeenCalled();
  });

  it('starts a new file each day and removes the files past the retention', () => {
    logger.log('first', 'Context');
    writeFileSync(join(directory, 'server-2026-02-20.jsonl'), '');
    writeFileSync(join(directory, 'server-2026-03-05.jsonl'), '');
    writeFileSync(join(directory, 'notes.txt'), '');

    vi.setSystemTime(new Date('2026-03-11T00:00:01.000Z'));
    logger.log('second', 'Context');

    expect(existsSync(join(directory, 'server-2026-03-11.jsonl'))).toBe(true);
    expect(existsSync(file())).toBe(true);
    expect(existsSync(join(directory, 'server-2026-02-20.jsonl'))).toBe(false);
    expect(existsSync(join(directory, 'server-2026-03-05.jsonl'))).toBe(true);
    expect(existsSync(join(directory, 'notes.txt'))).toBe(true);
  });

  it('keeps working when the file cannot be written', () => {
    writeFileSync(join(directory, '..', 'blocked'), '');
    const blocked = new FileConsoleLoggerAdapter(join(directory, '..', 'blocked'), 14);

    expect(() => blocked.log('hello', 'Context')).not.toThrow();
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('log_file_write_failed'));
  });
});
