import { Injectable, Logger } from '@nestjs/common';
import {
  accessSync,
  constants,
  existsSync,
  readdirSync,
  statSync,
  watch,
} from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';

import type {
  IFileSystemPort,
  WriteOptions,
} from '../ports/file-system.port.js';


@Injectable()
export class NodeFileSystemAdapter implements IFileSystemPort {
  private readonly logger = new Logger(NodeFileSystemAdapter.name);

  isInPath(binary: string): boolean {
    return this.resolveInPath(binary) !== null;
  }

  resolveInPath(binary: string): string | null {
    const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
    const extensions =
      process.platform === 'win32'
        ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';')
        : [''];

    for (const dir of dirs) {
      for (const ext of extensions) {
        const candidate = join(dir, binary + ext);
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }

    return null;
  }

  isReadableDirectory(path: string): boolean {
    try {
      accessSync(path, constants.R_OK);
      return statSync(path).isDirectory();
    } catch (error) {
      if (!this.isNotFoundError(error)) {
        this.logger.debug(`is_readable_directory_failed: ${path}`);
      }
      return false;
    }
  }

  isReadableFile(path: string): boolean {
    try {
      accessSync(path, constants.R_OK);
      return statSync(path).isFile();
    } catch (error) {
      if (!this.isNotFoundError(error)) {
        this.logger.debug(`is_readable_file_failed: ${path}`);
      }
      return false;
    }
  }

  readDirectoryNames(path: string): readonly string[] {
    try {
      return readdirSync(path);
    } catch (error) {
      if (!this.isNotFoundError(error)) {
        this.logger.debug(`read_directory_names_failed: ${path}`);
      }
      return [];
    }
  }

  async readJson<T>(filePath: string): Promise<T | null> {
    try {
      const raw = await readFile(filePath, 'utf-8');
      return JSON.parse(raw) as T;
    } catch (error) {
      if (!this.isNotFoundError(error)) {
        this.logger.debug(`read_json_failed: ${filePath}`);
      }
      return null;
    }
  }

  async writeJson(
    filePath: string,
    data: unknown,
    options?: WriteOptions,
  ): Promise<void> {
    await mkdir(
      dirname(filePath),
      options?.dirMode
        ? { recursive: true, mode: options.dirMode }
        : { recursive: true },
    );
    const content = JSON.stringify(data, null, 2);
    if (options?.mode) {
      await writeFile(filePath, content, { mode: options.mode });
    } else {
      await writeFile(filePath, content);
    }
  }

  async readText(filePath: string): Promise<string | null> {
    try {
      return await readFile(filePath, 'utf-8');
    } catch (error) {
      if (!this.isNotFoundError(error)) {
        this.logger.debug(`read_text_failed: ${filePath}`);
      }
      return null;
    }
  }

  async writeText(filePath: string, content: string): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }

  async deleteFile(filePath: string): Promise<void> {
    await rm(filePath, { force: true });
  }

  joinPath(...segments: string[]): string {
    return join(...segments);
  }

  resolvePath(path: string): string {
    return resolve(path);
  }

  resolveUserConfigDir(appName: string): string {
    return join(homedir(), '.config', appName);
  }

  watchDirectory(
    dirPath: string,
    onChange: (filename: string | null) => void,
  ): () => void {
    try {
      const watcher = watch(
        dirPath,
        { persistent: false },
        (_event, filename) => {
          onChange(filename == null ? null : filename.toString());
        },
      );
      watcher.on('error', () => {
        this.logger.debug(`watch_directory_failed: ${dirPath}`);
      });
      return () => {
        watcher.close();
      };
    } catch (error) {
      if (!this.isNotFoundError(error)) {
        this.logger.debug(`watch_directory_failed: ${dirPath}`);
      }
      return () => undefined;
    }
  }

  private isNotFoundError(error: unknown): boolean {
    return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
  }
}
