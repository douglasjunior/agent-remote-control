import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname } from 'node:path';

import { FileLockTimeoutError, type FileLockOptions, type IFileLockPort } from '../ports/file-lock.port.js';


/** Longer than `DEFAULT_STALE_MS`, so a caller outlasts a lockfile left behind that only its age gives away. */
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_STALE_MS = 10_000;
const RETRY_INTERVAL_MS = 50;
const LOCK_FILE_MODE = 0o600;

type Waiter = { grant?: () => void };

type LockOwner = { readonly host?: unknown; readonly pid?: unknown; readonly token?: unknown };

type Abandonment = { readonly tag: 'Orphan' | 'Stale'; readonly detail: string };

/**
 * The tokens of the lockfiles this process holds, whichever adapter instance took them. A lockfile with the pid of
 * this process and a token outside the set was left by an earlier process of the same pid, as a container whose
 * server is always pid 1 leaves when it is killed.
 */
const heldTokens = new Set<string>();

/**
 * Callers of one path in this process wait in a queue in memory, in the order they called, and only the head of the
 * queue contends for the lockfile; so the disk is polled only while another process holds it.
 *
 * The lockfile is created with `O_EXCL` and holds the owner's host, pid and a token of its own. A lockfile whose
 * owner process is gone is taken over at once; one older than `staleMs` is taken over too, which covers an unreadable
 * payload, an owner on another host, a reused pid and an owner that hung. Release removes the lockfile only while it
 * still carries this holder's token, so a holder whose lock was taken over as stale never removes its successor's.
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
    const token = randomUUID();
    heldTokens.add(token);
    try {
      await this.waitTurn(lockPath, waiter, deadline, timeoutMs);
      await this.acquire(lockPath, token, deadline, timeoutMs, staleMs);
      try {
        return await work();
      } finally {
        await this.release(lockPath, token);
      }
    } finally {
      heldTokens.delete(token);
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

  private async acquire(lockPath: string, token: string, deadline: number, timeoutMs: number, staleMs: number): Promise<void> {
    await mkdir(dirname(lockPath), { recursive: true });
    for (;;) {
      try {
        await writeFile(lockPath, JSON.stringify({ host: hostname(), pid: process.pid, token }), { flag: 'wx', mode: LOCK_FILE_MODE });
        return;
      } catch (error) {
        if (!this.hasCode(error, 'EEXIST')) {
          throw error;
        }
      }
      if (await this.takeOverIfAbandoned(lockPath, staleMs)) {
        continue;
      }
      if (Date.now() >= deadline) {
        throw new FileLockTimeoutError(lockPath, timeoutMs);
      }
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL_MS));
    }
  }

  /** Whether the lockfile is out of the way, taken over as abandoned or released meanwhile, so the next attempt need not wait. */
  private async takeOverIfAbandoned(lockPath: string, staleMs: number): Promise<boolean> {
    try {
      return await this.abandonment(lockPath, staleMs) !== undefined && await this.takeOver(lockPath, staleMs);
    } catch (error) {
      if (this.hasCode(error, 'ENOENT')) {
        return true;
      }
      this.logger.warn(`[Lock Check Failed] ${lockPath}: ${this.describe(error)}`);
      return false;
    }
  }

  /**
   * Between judging a lockfile abandoned and removing it, another contender may take it over and create its own,
   * which a removal by path would delete. So the lockfile is moved aside, which one contender alone does to one file,
   * and judged again where nobody replaces it: a live one goes back to its path.
   */
  private async takeOver(lockPath: string, staleMs: number): Promise<boolean> {
    const aside = `${lockPath}.${randomUUID()}.tmp`;
    await rename(lockPath, aside);
    try {
      const abandonment = await this.abandonment(aside, staleMs);
      if (!abandonment) {
        await link(aside, lockPath);
        return false;
      }
      this.logger.warn(`[Lock ${abandonment.tag} Dropped] ${lockPath}${abandonment.detail}`);
      return true;
    } finally {
      await rm(aside, { force: true });
    }
  }

  /** Why nobody holds the lockfile at `path`, or `undefined` while its owner may. */
  private async abandonment(path: string, staleMs: number): Promise<Abandonment | undefined> {
    if (this.isOwnerGone(await this.readOwner(path))) {
      return { tag: 'Orphan', detail: '' };
    }
    const age = Date.now() - (await stat(path)).mtimeMs;
    return age > staleMs ? { tag: 'Stale', detail: `, Age=${Math.round(age)}ms` } : undefined;
  }

  /**
   * A pid is probed only on its own host: on another host or container it names a different process. Signal 0 only
   * tests whether the process exists; `EPERM` is a live process of another user. A payload without a host or a pid,
   * such as a lockfile created but not yet written, is left to the age criterion.
   */
  private isOwnerGone({ host, pid, token }: LockOwner): boolean {
    if (host !== hostname() || !Number.isInteger(pid) || (pid as number) <= 0) {
      return false;
    }
    if (pid === process.pid) {
      return !heldTokens.has(token as string);
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
