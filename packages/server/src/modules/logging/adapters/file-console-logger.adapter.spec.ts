import { Logger } from '@nestjs/common';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { StubRuntimeSettings } from '../../settings/testing/stub-runtime-settings.js';
import { ConversationLogContextService } from '../services/conversation-log-context.service.js';

import { FileConsoleLoggerAdapter } from './file-console-logger.adapter.js';


describe('FileConsoleLoggerAdapter', () => {
  let directory: string;
  let logger: FileConsoleLoggerAdapter;
  const logContext = new ConversationLogContextService();
  const file = () => join(directory, 'server-2026-03-10.jsonl');
  const records = () => readFileSync(file(), 'utf8').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);

  beforeEach(() => {
    rs.useFakeTimers({ toFake: ['Date'] });
    rs.setSystemTime(new Date('2026-03-10T12:00:00.000Z'));
    rs.spyOn(process.stdout, 'write').mockReturnValue(true);
    rs.spyOn(process.stderr, 'write').mockReturnValue(true);
    directory = join(mkdtempSync(join(tmpdir(), 'arc-logs-')), 'logs');
    logger = new FileConsoleLoggerAdapter(directory, new StubRuntimeSettings({ LOG_RETENTION_DAYS: 14 }), logContext);
  });

  afterEach(() => {
    rs.useRealTimers();
    rs.restoreAllMocks();
    Logger.overrideLogger(['log', 'error', 'warn']);
    rmSync(join(directory, '..'), { recursive: true, force: true });
  });

  it('should record the level, context and message, and still prints to the console', () => {
    logger.log('hello', 'Context');

    expect(records()).toEqual([{ at: '2026-03-10T12:00:00.000Z', level: 'log', context: 'Context', message: 'hello' }]);
    expect(process.stdout.write).toHaveBeenCalled();
    expect(statSync(file()).mode & 0o777).toBe(0o600);
  });

  it('should record the conversation the message was logged in', () => {
    logContext.run('web-1', () => logger.warn('careful', 'Context'));

    expect(records()[0]).toMatchObject({ level: 'warn', conversationId: 'web-1', message: 'careful' });
  });

  it('should record the stack of an error', () => {
    logger.error('boom', 'the stack', 'Context');

    expect(records()[0]).toMatchObject({ level: 'error', message: 'boom', stack: 'the stack' });
  });

  it('should record what is not a string', () => {
    logger.log({ a: 1 }, 'Context');
    logger.log(new Error('failed'), 'Context');

    expect(records().map(record => record.message)).toEqual(['{"a":1}', 'failed']);
  });

  it('should receive the logs of Nest loggers once installed', () => {
    Logger.overrideLogger(logger);

    new Logger('Service').log('through nest');

    expect(records()[0]).toMatchObject({ context: 'Service', message: 'through nest' });
  });

  it('should keep the startup access token and remote link out of the file', () => {
    logger.log('Web interface access token: secret', 'AccessTokenService');
    logger.log('Remote access link: https://arc.example.com/i/x#token=secret', 'RemoteAccessLink');

    expect(existsSync(file())).toBe(false);
    expect(process.stdout.write).toHaveBeenCalled();
  });

  it('should start a new file each day and remove the files past the retention', () => {
    logger.log('first', 'Context');
    writeFileSync(join(directory, 'server-2026-02-20.jsonl'), '');
    writeFileSync(join(directory, 'server-2026-03-05.jsonl'), '');
    writeFileSync(join(directory, 'notes.txt'), '');

    rs.setSystemTime(new Date('2026-03-11T00:00:01.000Z'));
    logger.log('second', 'Context');

    expect(existsSync(join(directory, 'server-2026-03-11.jsonl'))).toBe(true);
    expect(existsSync(file())).toBe(true);
    expect(existsSync(join(directory, 'server-2026-02-20.jsonl'))).toBe(false);
    expect(existsSync(join(directory, 'server-2026-03-05.jsonl'))).toBe(true);
    expect(existsSync(join(directory, 'notes.txt'))).toBe(true);
  });

  it('should keep working when the file cannot be written', () => {
    writeFileSync(join(directory, '..', 'blocked'), '');
    const blocked = new FileConsoleLoggerAdapter(join(directory, '..', 'blocked'), new StubRuntimeSettings(), logContext);

    expect(() => blocked.log('hello', 'Context')).not.toThrow();
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('log_file_write_failed'));
  });
});
