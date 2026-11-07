import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { link, mkdir, open, stat, unlink } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';

import type { IWorkspaceUploadPort, UploadWriter } from '../ports/workspace-upload.port.js';
import { IWorkspacePort } from '../ports/workspace.port.js';


const MAX_NAME_ATTEMPTS = 1_000;
const MAX_NAME_LENGTH = 120;
const FALLBACK_NAME = 'file';

/**
 * Writes uploads to a hidden temporary file in the target directory and publishes it with a hard link,
 * which fails if the name is taken, so two uploads never overwrite each other; a taken name gets ` (n)`
 * before the extension.
 */
@Injectable()
export class LocalWorkspaceUploadAdapter implements IWorkspaceUploadPort {
  constructor(@Inject(IWorkspacePort) private readonly workspace: IWorkspacePort) {}

  async begin(directory: string, name: string): Promise<UploadWriter> {
    const target = this.resolveInside(directory);
    await mkdir(target, { recursive: true });
    const temporaryPath = join(target, `.${randomUUID()}.part`);
    const handle = await open(temporaryPath, 'wx');
    const fileName = this.sanitizeFileName(name);

    return {
      append: async (bytes) => {
        await handle.write(bytes);
      },
      commit: async () => {
        await handle.close();
        try {
          return this.relativePath(await this.publish(temporaryPath, target, fileName));
        } finally {
          await unlink(temporaryPath).catch(() => undefined);
        }
      },
      abort: async () => {
        await handle.close().catch(() => undefined);
        await unlink(temporaryPath).catch(() => undefined);
      },
    };
  }

  async fileSize(relativePath: string): Promise<number | null> {
    try {
      const stats = await stat(this.resolveInside(relativePath));
      return stats.isFile() ? stats.size : null;
    } catch {
      return null;
    }
  }

  /** Keeps the last path segment, drops control and reserved characters and leading dots, and bounds the length keeping the extension. */
  private sanitizeFileName(name: string): string {
    const lastSegment = name.split(/[\\/]/).at(-1) ?? '';
    const cleaned = lastSegment
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_')
      .trim()
      .replace(/^\.+/, '');
    if (cleaned === '') {
      return FALLBACK_NAME;
    }
    if (cleaned.length <= MAX_NAME_LENGTH) {
      return cleaned;
    }
    const extensionStart = cleaned.lastIndexOf('.');
    const extension = extensionStart > 0 && cleaned.length - extensionStart <= 16 ? cleaned.slice(extensionStart) : '';
    return cleaned.slice(0, MAX_NAME_LENGTH - extension.length) + extension;
  }

  private async publish(temporaryPath: string, directory: string, fileName: string): Promise<string> {
    const extension = extname(fileName);
    const stem = fileName.slice(0, fileName.length - extension.length);
    for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt += 1) {
      const candidate = join(directory, attempt === 0 ? fileName : `${stem} (${attempt})${extension}`);
      try {
        await link(temporaryPath, candidate);
        return candidate;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw error;
        }
      }
    }
    throw new Error(`No free name for upload: ${fileName}`);
  }

  private resolveInside(relativePath: string): string {
    const base = this.workspace.getBaseDirectory();
    const target = resolve(base, relativePath);
    const fromBase = relative(base, target);
    if (fromBase.startsWith('..') || isAbsolute(fromBase)) {
      throw new Error(`Path is outside the workspace directory: ${relativePath}`);
    }
    return target;
  }

  private relativePath(absolutePath: string): string {
    return relative(this.workspace.getBaseDirectory(), absolutePath).split('\\').join('/');
  }
}
