import { Inject, Injectable } from '@nestjs/common';
import { readdir, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { WorkspaceEntry } from '../models/workspace-file-match.model.js';
import type { FileSearchListener, FileSearchSession, IWorkspaceFileSearchPort } from '../ports/workspace-file-search.port.js';
import { IWorkspacePort } from '../ports/workspace.port.js';
import { FileSearchIndex } from '../services/file-search-index.service.js';


const IGNORED_DIRECTORIES = new Set(['node_modules']);

type PendingDirectory = {
  readonly relativePath: string;
  readonly realPath: string;
  readonly depth: number;
  readonly ancestorRealPaths: readonly string[];
};

/**
 * Walks the base directory breadth first and hands every directory's entries to the index as one
 * batch. Dot entries and `node_modules` are skipped. A symbolic link counts when its target resolves,
 * but a link back to one of its own ancestors is not entered again, which closes cycles.
 */
@Injectable()
export class LocalWorkspaceFileSearchAdapter implements IWorkspaceFileSearchPort {
  constructor(@Inject(IWorkspacePort) private readonly workspace: IWorkspacePort) {}

  start(listener: FileSearchListener): FileSearchSession {
    const index = new FileSearchIndex(listener.onResults);
    const controller = new AbortController();
    listener.onWalking(true);

    void this.walk(controller.signal, entries => index.addEntries(entries))
      // An aborted walk still resolves while a new session may already be running.
      .finally(() => {
        if (!controller.signal.aborted) {
          listener.onWalking(false);
        }
      });

    return {
      setQuery: query => index.setQuery(query),
      stop: () => {
        controller.abort();
        index.stop();
      },
    };
  }

  private async walk(signal: AbortSignal, onBatch: (entries: readonly WorkspaceEntry[]) => void): Promise<void> {
    const baseDirectory = this.workspace.getBaseDirectory();
    const baseRealPath = await realpath(baseDirectory).catch(() => baseDirectory);
    let level: PendingDirectory[] = [{ relativePath: '', realPath: baseRealPath, depth: 0, ancestorRealPaths: [baseRealPath] }];

    while (level.length > 0) {
      const nextLevel: PendingDirectory[] = [];
      for (const directory of level) {
        if (signal.aborted) {
          return;
        }
        const entries: WorkspaceEntry[] = [];
        nextLevel.push(...await this.readDirectory(baseDirectory, directory, entries));
        if (entries.length > 0 && !signal.aborted) {
          onBatch(entries);
        }
      }
      level = nextLevel;
    }
  }

  private async readDirectory(baseDirectory: string, directory: PendingDirectory, entries: WorkspaceEntry[]): Promise<PendingDirectory[]> {
    const absolutePath = join(baseDirectory, directory.relativePath);
    const dirents = await readdir(absolutePath, { withFileTypes: true }).catch(() => []);
    const children: PendingDirectory[] = [];

    for (const dirent of dirents.sort((a, b) => a.name.localeCompare(b.name))) {
      if (dirent.name.startsWith('.') || IGNORED_DIRECTORIES.has(dirent.name)) {
        continue;
      }
      const resolved = await this.resolveEntry(join(absolutePath, dirent.name), dirent.isSymbolicLink(), dirent.isDirectory());
      if (!resolved) {
        continue;
      }
      const path = directory.relativePath ? `${directory.relativePath}/${dirent.name}` : dirent.name;
      entries.push({ path, kind: resolved.isDirectory ? 'directory' : 'file', depth: directory.depth });

      const realPath = resolved.linkRealPath ?? join(directory.realPath, dirent.name);
      if (resolved.isDirectory && !directory.ancestorRealPaths.includes(realPath)) {
        children.push({ relativePath: path, realPath, depth: directory.depth + 1, ancestorRealPaths: [...directory.ancestorRealPaths, realPath] });
      }
    }
    return children;
  }

  /** `null` when a link's target cannot be resolved (broken link, permission). */
  private async resolveEntry(
    absolutePath: string,
    isSymbolicLink: boolean,
    isDirectory: boolean,
  ): Promise<{ readonly isDirectory: boolean; readonly linkRealPath: string | null } | null> {
    if (!isSymbolicLink) {
      return { isDirectory, linkRealPath: null };
    }
    try {
      return { isDirectory: (await stat(absolutePath)).isDirectory(), linkRealPath: await realpath(absolutePath) };
    } catch {
      return null;
    }
  }
}
