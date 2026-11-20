import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { FileLockTimeoutError, type FileLockOptions, type IFileLockPort } from '../ports/file-lock.port.js';


const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_STALE_MS = 30_000;
const RETRY_INTERVAL_MS = 50;
const LOCK_FILE_MODE = 0o600;

type Waiter = { grant?: () => void };

type LockOwner = { readonly pid?: unknown; readonly token?: unknown };

/**
 * Callers of one path in this process wait in a queue in memory, in the order they called, and only the head of the
 * queue contends for the lockfile; so the disk is polled only while another process holds it.
 *
 * The lockfile is created with `O_EXCL` and holds the owner's pid and a token of its own. A lockfile whose owner
 * process no longer exists is removed at once; one older than `staleMs` is removed too, which covers an unreadable
 * payload, a reused pid and an owner that hung. Release removes the lockfile only while it still carries this
 * holder's token, so a holder whose lock was taken over as stale never removes its successor's.
 */
@Injectable()
export class NodeFileLockAdapter implements IFileLockPort {
  private readonly logger = new Logger(NodeFileLockAdapter.name);
  private readonly queues = new Map<string, Waiter[]>();

  async withLock<T>(lockPath: string, work: () => Promise<T>, options?: FileLockOptions): Promise<T> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const staleMs = options?.staleMs ?? DEFAULT_STALE_MS;
    const deadline = Date.now() + timeoutMs;
    const waiter = this.enqueue(lockPath);
    try {
      await this.waitTurn(lockPath, waiter, deadline, timeoutMs);
      const token = await this.acquire(lockPath, deadline, timeoutMs, staleMs);
      try {
        return await work();
      } finally {
        await this.release(lockPath, token);
      }
    } finally {
      this.leave(lockPath, waiter);
    }
  }

  private enqueue(lockPath: string): Waiter {
    const waiter: Waiter = {};
    const queue = this.queues.get(lockPath) ?? [];
    queue.push(waiter);
    this.queues.set(lockPath, queue);
    return waiter;
  }

  private waitTurn(lockPath: string, waiter: Waiter, deadline: number, timeoutMs: number): Promise<void> {
    if (this.queues.get(lockPath)![0] === waiter) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new FileLockTimeoutError(lockPath, timeoutMs)), deadline - Date.now());
      waiter.grant = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  /** A waiter that timed out leaves from where it is; the head leaving hands the turn to the next one. */
  private leave(lockPath: string, waiter: Waiter): void {
    const queue = this.queues.get(lockPath)!;
    const index = queue.indexOf(waiter);
    queue.splice(index, 1);
    if (queue.length === 0) {
      this.queues.delete(lockPath);
      return;
    }
    if (index === 0) {
      queue[0]!.grant?.();
    }
  }

  private async acquire(lockPath: string, deadline: number, timeoutMs: number, staleMs: number): Promise<string> {
    const token = randomUUID();
    await mkdir(dirname(lockPath), { recursive: true });
    for (;;) {
      try {
        await writeFile(lockPath, JSON.stringify({ pid: process.pid, token }), { flag: 'wx', mode: LOCK_FILE_MODE });
        return token;
      } catch (error) {
        if (!this.hasCode(error, 'EEXIST')) {
          throw error;
        }
      }
      if (await this.dropIfAbandoned(lockPath, staleMs)) {
        continue;
      }
      if (Date.now() >= deadline) {
        throw new FileLockTimeoutError(lockPath, timeoutMs);
      }
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL_MS));
    }
  }

  /** Whether the lockfile is gone, dropped as abandoned or released meanwhile, so the next attempt need not wait. */
  private async dropIfAbandoned(lockPath: string, staleMs: number): Promise<boolean> {
    try {
      if (this.isOwnerGone(await this.readOwner(lockPath))) {
        this.logger.warn(`[Lock Orphan Dropped] ${lockPath}`);
        await rm(lockPath, { force: true });
        return true;
      }
      const age = Date.now() - (await stat(lockPath)).mtimeMs;
      if (age > staleMs) {
        this.logger.warn(`[Lock Stale Dropped] ${lockPath}, Age=${Math.round(age)}ms`);
        await rm(lockPath, { force: true });
        return true;
      }
      return false;
    } catch (error) {
      if (this.hasCode(error, 'ENOENT')) {
        return true;
      }
      this.logger.warn(`[Lock Check Failed] ${lockPath}: ${this.describe(error)}`);
      return false;
    }
  }

  /**
   * Signal 0 only tests whether the process exists; `EPERM` is a live process of another user. A payload without a
   * pid, such as a lockfile created but not yet written, is left to the age criterion.
   */
  private isOwnerGone({ pid }: LockOwner): boolean {
    if (!Number.isInteger(pid) || (pid as number) <= 0 || pid === process.pid) {
      return false;
    }
    try {
      process.kill(pid as number, 0);
      return false;
    } catch (error) {
      return this.hasCode(error, 'ESRCH');
    }
  }

  private async release(lockPath: string, token: string): Promise<void> {
    try {
      if ((await this.readOwner(lockPath)).token === token) {
        await rm(lockPath, { force: true });
      }
    } catch (error) {
      if (!this.hasCode(error, 'ENOENT')) {
        this.logger.warn(`[Lock Release Failed] ${lockPath}: ${this.describe(error)}`);
      }
    }
  }

  private async readOwner(lockPath: string): Promise<LockOwner> {
    const payload = await readFile(lockPath, 'utf-8');
    try {
      const owner: unknown = JSON.parse(payload);
      return typeof owner === 'object' && owner !== null ? owner : {};
    } catch {
      return {};
    }
  }

  private hasCode(error: unknown, code: string): boolean {
    return (error as NodeJS.ErrnoException | undefined)?.code === code;
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
