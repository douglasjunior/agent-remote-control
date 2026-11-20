import { Inject, Injectable, Logger } from '@nestjs/common';
import { mkdir, readdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { z } from 'zod';

import { DataDirectoryService } from '../../paths/services/data-directory.service.js';
import { IFileLockPort } from '../../storage/ports/file-lock.port.js';
import { ILockedFilesPort } from '../../storage/ports/locked-files.port.js';


/** The JSON files earlier versions kept in `DATA_DIR`, addressed by their path relative to it. */
@Injectable()
export class LegacyJsonFilesService {
  private readonly logger = new Logger(LegacyJsonFilesService.name);

  constructor(
    private readonly dataDirectory: DataDirectoryService,
    @Inject(IFileLockPort) private readonly lock: IFileLockPort,
    @Inject(ILockedFilesPort) private readonly files: ILockedFilesPort,
  ) {}

  /**
   * The content of the file, read under the lock its JSON store wrote it with, so a process of an earlier version
   * still running finishes its write first. `undefined` when the file is missing, or does not match `schema`, which
   * is logged.
   */
  async read<T>(path: string, schema: z.ZodType<T>): Promise<T | undefined> {
    const absolute = join(this.dataDirectory.resolve(), path);
    const text = await this.lock.withLock(`${absolute}.lock`, () => this.files.text(absolute).read());
    if (text === undefined) {
      return undefined;
    }
    const parsed = schema.safeParse(this.parseJson(text));
    if (!parsed.success) {
      this.logger.warn(`legacy_file_skipped: ${path} does not match the format it was written in`);
      return undefined;
    }
    return parsed.data;
  }

  /** The `.json` files right inside the directory, relative to `DATA_DIR`; none when the directory is missing. */
  async list(directory: string): Promise<string[]> {
    try {
      const entries = await readdir(join(this.dataDirectory.resolve(), directory), { withFileTypes: true });
      return entries.filter(entry => entry.isFile() && entry.name.endsWith('.json')).map(entry => join(directory, entry.name)).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /** Moves the files into `backupDirectory`, relative to `DATA_DIR`, keeping their paths; returns how many moved. */
  async backUp(paths: readonly string[], backupDirectory: string): Promise<number> {
    const root = this.dataDirectory.resolve();
    let moved = 0;
    for (const path of paths) {
      const target = join(root, backupDirectory, path);
      try {
        await mkdir(dirname(target), { recursive: true });
        await rename(join(root, path), target);
        moved += 1;
      } catch (error) {
        this.logger.warn(`legacy_file_not_backed_up: ${path}: ${String(error)}`);
      }
    }
    return moved;
  }

  private parseJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }
}
