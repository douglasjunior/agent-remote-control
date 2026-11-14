import { artifactDetailSchema } from '@agent-remote-control/protocol/artifact';
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

import { DataDirectoryService } from '../../paths/services/data-directory.service.js';
import { ARTIFACT_ID_PREFIXES } from '../constants/artifact-catalog.constant.js';
import type { Artifact, ArtifactType } from '../models/artifact.model.js';
import type { ArtifactTransaction, IArtifactStorePort } from '../ports/artifact-store.port.js';


const ARTIFACTS_DIRECTORY = 'artifacts';
const FILE_EXTENSION = '.json';

const storedArtifactsSchema = z.object({
  counters: z.record(z.string(), z.number().int().min(0)).default({}),
  artifacts: z.array(artifactDetailSchema),
});

type BoardState = {
  artifacts: Map<string, Artifact>;
  counters: Record<string, number>;
};

/** One file per conversation, `DATA_DIR/artifacts/<encoded conversation id>.json`, replaced whole on every change. */
@Injectable()
export class JsonArtifactStoreAdapter implements IArtifactStorePort {
  private readonly logger = new Logger(JsonArtifactStoreAdapter.name);
  private readonly directory: string;
  private readonly boards = new Map<string, Promise<BoardState>>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(dataDirectoryService: DataDirectoryService) {
    this.directory = join(dataDirectoryService.resolve(), ARTIFACTS_DIRECTORY);
  }

  async conversations(): Promise<readonly string[]> {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch {
      names = [];
    }
    const stored = names.filter(name => name.endsWith(FILE_EXTENSION)).map(name => decodeURIComponent(name.slice(0, -FILE_EXTENSION.length)));
    return [...new Set([...stored, ...this.boards.keys()])];
  }

  async list(conversationId: string): Promise<readonly Artifact[]> {
    return [...(await this.load(conversationId)).artifacts.values()];
  }

  async find(conversationId: string, id: string): Promise<Artifact | undefined> {
    return (await this.load(conversationId)).artifacts.get(id);
  }

  transaction<T>(conversationId: string, work: (transaction: ArtifactTransaction) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const state = await this.load(conversationId);
      const artifacts = new Map(state.artifacts);
      const counters = { ...state.counters };
      const result = work({
        find: id => artifacts.get(id),
        list: () => [...artifacts.values()],
        allocateId: type => this.allocateId(type, artifacts, counters),
        save: (artifact) => {
          artifacts.set(artifact.id, artifact);
        },
        remove: (id) => {
          artifacts.delete(id);
        },
      });
      await this.write(conversationId, { artifacts, counters });
      state.artifacts = artifacts;
      state.counters = counters;
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private allocateId(type: ArtifactType, artifacts: ReadonlyMap<string, Artifact>, counters: Record<string, number>): string {
    const prefix = ARTIFACT_ID_PREFIXES[type];
    let id: string;
    do {
      counters[prefix] = (counters[prefix] ?? 0) + 1;
      id = `${prefix}-${counters[prefix]}`;
    } while (artifacts.has(id));
    return id;
  }

  private load(conversationId: string): Promise<BoardState> {
    let board = this.boards.get(conversationId);
    if (!board) {
      board = this.read(conversationId);
      this.boards.set(conversationId, board);
    }
    return board;
  }

  /** A missing or invalid file is an empty board; an invalid one stays on disk until the next change replaces it. */
  private async read(conversationId: string): Promise<BoardState> {
    const path = this.pathOf(conversationId);
    let content: unknown;
    try {
      content = JSON.parse(await readFile(path, 'utf-8'));
    } catch {
      return { artifacts: new Map(), counters: {} };
    }
    const parsed = storedArtifactsSchema.safeParse(content);
    if (!parsed.success) {
      this.logger.warn(`artifacts_invalid_file: ${path}`);
      return { artifacts: new Map(), counters: {} };
    }
    return {
      artifacts: new Map(parsed.data.artifacts.map(artifact => [artifact.id, artifact])),
      counters: parsed.data.counters,
    };
  }

  /** Renames a complete file into place, because the process may die at any moment of a write. */
  private async write(conversationId: string, state: BoardState): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const path = this.pathOf(conversationId);
    const temporary = `${path}.${randomUUID()}.tmp`;
    const content = { counters: state.counters, artifacts: [...state.artifacts.values()] };
    await writeFile(temporary, JSON.stringify(content, null, 2), 'utf-8');
    await rename(temporary, path);
  }

  /** The conversation id is encoded, so it never climbs out of the directory or holds a separator. */
  private pathOf(conversationId: string): string {
    return join(this.directory, `${encodeURIComponent(conversationId)}${FILE_EXTENSION}`);
  }
}
