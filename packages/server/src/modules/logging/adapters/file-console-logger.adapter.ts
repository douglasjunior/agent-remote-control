import { ConsoleLogger, type LogLevel } from '@nestjs/common';
import { appendFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { currentLogConversation } from '../utils/log-conversation.util.js';


const FILE_PATTERN = /^server-(\d{4}-\d{2}-\d{2})\.jsonl$/;
const DAY_MS = 86_400_000;
/** Contexts that print secrets the operator needs at startup, which must not reach a file that gets shared. */
const CONSOLE_ONLY_CONTEXTS: ReadonlySet<string> = new Set(['WebAccessTokenService']);

function textOf(message: unknown): string {
  if (message instanceof Error) {
    return message.message;
  }
  return typeof message === 'string' ? message : JSON.stringify(message);
}

/** Prints like Nest's console logger and also appends one JSON line per message to a file per UTC day. */
export class FileConsoleLoggerAdapter extends ConsoleLogger {
  private openDay?: string;

  constructor(
    private readonly directory: string,
    private readonly retentionDays: number,
  ) {
    super();
  }

  protected override printMessages(
    messages: unknown[],
    context = '',
    logLevel: LogLevel = 'log',
    writeStreamType?: 'stdout' | 'stderr',
    errorStack?: unknown,
    params?: Record<string, unknown>,
  ): void {
    super.printMessages(messages, context, logLevel, writeStreamType, errorStack, params);
    if (!CONSOLE_ONLY_CONTEXTS.has(context)) {
      this.record(messages, context, logLevel, errorStack);
    }
  }

  private record(messages: unknown[], context: string, level: LogLevel, stack: unknown): void {
    const now = new Date();
    const conversationId = currentLogConversation();
    const lines = messages.map(message => `${JSON.stringify({
      at: now.toISOString(),
      level,
      context,
      ...(conversationId ? { conversationId } : {}),
      message: textOf(message),
      ...(stack ? { stack } : {}),
    })}\n`);
    try {
      appendFileSync(this.fileFor(now), lines.join(''), { mode: 0o600 });
    } catch (error) {
      process.stderr.write(`log_file_write_failed: ${textOf(error)}\n`);
    }
  }

  private fileFor(now: Date): string {
    const day = now.toISOString().slice(0, 10);
    if (day !== this.openDay) {
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      this.removeExpiredFiles(now);
      this.openDay = day;
    }
    return join(this.directory, `server-${day}.jsonl`);
  }

  private removeExpiredFiles(now: Date): void {
    const oldest = now.getTime() - this.retentionDays * DAY_MS;
    for (const name of readdirSync(this.directory)) {
      const day = FILE_PATTERN.exec(name)?.[1];
      if (day && Date.parse(day) < oldest) {
        rmSync(join(this.directory, name), { force: true });
      }
    }
  }
}
