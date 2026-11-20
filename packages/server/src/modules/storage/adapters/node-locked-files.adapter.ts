import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

import { IFileLockPort } from '../ports/file-lock.port.js';
import type {
  ILockedFilesPort,
  JsonFileOptions,
  LockedFile,
  LockedFileChange,
  LockedFileOptions,
} from '../ports/locked-files.port.js';


const DEFAULT_FILE_MODE = 0o666;

type Codec<T> = {
  readonly decode: (text: string | undefined) => T;
  readonly encode: (value: T) => string;
};

@Injectable()
export class NodeLockedFilesAdapter implements ILockedFilesPort {
  private readonly logger = new Logger(NodeLockedFilesAdapter.name);

  constructor(@Inject(IFileLockPort) private readonly lock: IFileLockPort) {}

  json<T>(path: string, options: JsonFileOptions<T>): LockedFile<T> {
    const { parse, empty, serialize = value => value } = options;
    return new NodeLockedFile(path, options, this.lock, {
      decode: (text) => {
        if (text === undefined) {
          return empty;
        }
        let content: unknown;
        try {
          content = JSON.parse(text);
        } catch {
          this.logger.warn(`[Unreadable File] ${path} is not valid JSON; it reads as empty until a write replaces it`);
          return empty;
        }
        return parse(content);
      },
      encode: value => JSON.stringify(serialize(value), null, 2),
    });
  }

  text(path: string, options: LockedFileOptions = {}): LockedFile<string | undefined> {
    return new NodeLockedFile<string | undefined>(path, options, this.lock, {
      decode: text => text,
      encode: value => value!,
    });
  }
}

/**
 * Every write renames a new file into place, so the file's inode, size and modification time identify one content;
 * a cached copy is used only while they match the file on disk, whichever process wrote it.
 */
class NodeLockedFile<T> implements LockedFile<T> {
  private cached?: { readonly signature: string; readonly value: T };

  constructor(
    private readonly path: string,
    private readonly options: LockedFileOptions,
    private readonly lock: IFileLockPort,
    private readonly codec: Codec<T>,
  ) {}

  async read(): Promise<T> {
    const signature = await this.signatureOnDisk();
    if (signature === undefined) {
      this.cached = undefined;
      return this.codec.decode(undefined);
    }
    return signature === this.cached?.signature ? this.cached.value : this.load();
  }

  async update(change: LockedFileChange<T>): Promise<T> {
    await mkdir(dirname(this.path), { recursive: true, mode: this.options.directoryMode });
    return this.lock.withLock(this.options.lockPath ?? `${this.path}.lock`, async () => {
      const current = await this.read();
      const next = await change(current);
      if (next === undefined) {
        return current;
      }
      await this.write(next);
      return next;
    });
  }

  private async load(): Promise<T> {
    let handle;
    try {
      handle = await open(this.path, 'r');
    } catch (error) {
      if (!this.isMissing(error)) {
        throw error;
      }
      this.cached = undefined;
      return this.codec.decode(undefined);
    }
    try {
      const signature = this.signatureOf(await handle.stat({ bigint: true }));
      const value = this.codec.decode(await handle.readFile('utf-8'));
      this.cached = { signature, value };
      return value;
    } finally {
      await handle.close();
    }
  }

  private async write(value: T): Promise<void> {
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, 'wx', this.options.mode ?? DEFAULT_FILE_MODE);
      let signature: string;
      try {
        await handle.writeFile(this.codec.encode(value), 'utf-8');
        signature = this.signatureOf(await handle.stat({ bigint: true }));
      } finally {
        await handle.close();
      }
      await rename(temporary, this.path);
      this.cached = { signature, value };
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  private async signatureOnDisk(): Promise<string | undefined> {
    try {
      return this.signatureOf(await stat(this.path, { bigint: true }));
    } catch (error) {
      if (this.isMissing(error)) {
        return undefined;
      }
      throw error;
    }
  }

  /** A file under a path that is not a directory does not exist either. */
  private isMissing(error: unknown): boolean {
    const { code } = error as NodeJS.ErrnoException;
    return code === 'ENOENT' || code === 'ENOTDIR';
  }

  private signatureOf({ ino, size, mtimeNs }: BigIntStats): string {
    return `${ino}:${size}:${mtimeNs}`;
  }
}
