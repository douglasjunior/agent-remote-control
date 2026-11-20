import { artifactDetailSchema } from '@agent-remote-control/protocol/artifact';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

import { DataDirectoryService } from '../../paths/services/data-directory.service.js';
import { ILockedFilesPort, type LockedFile } from '../../storage/ports/locked-files.port.js';
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
  readonly artifacts: ReadonlyMap<string, Artifact>;
  readonly counters: Readonly<Record<string, number>>;
};

const EMPTY_BOARD: BoardState = { artifacts: new Map(), counters: {} };

/**
 * One file per conversation, `DATA_DIR/artifacts/<encoded conversation id>.json`, replaced whole by every transaction
 * that changes it. A missing or invalid file is an empty board; an invalid one stays on disk until the next change
 * replaces it.
 */
@Injectable()
export class JsonArtifactStoreAdapter implements IArtifactStorePort {
  private readonly logger = new Logger(JsonArtifactStoreAdapter.name);
  private readonly directory: string;
  private readonly boards = new Map<string, LockedFile<BoardState>>();

  constructor(
    dataDirectoryService: DataDirectoryService,
    @Inject(ILockedFilesPort) private readonly files: ILockedFilesPort,
  ) {
    this.directory = join(dataDirectoryService.resolve(), ARTIFACTS_DIRECTORY);
  }

  /** The boards on disk, plus those this process opened and has not written yet. */
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
    return [...(await this.board(conversationId).read()).artifacts.values()];
  }

  async find(conversationId: string, id: string): Promise<Artifact | undefined> {
    return (await this.board(conversationId).read()).artifacts.get(id);
  }

  async transaction<T>(conversationId: string, work: (transaction: ArtifactTransaction) => T): Promise<T> {
    let result!: T;
    await this.board(conversationId).update((state) => {
      const artifacts = new Map(state.artifacts);
      const counters = { ...state.counters };
      let changed = false;
      result = work({
        find: id => artifacts.get(id),
        list: () => [...artifacts.values()],
        allocateId: (type) => {
          changed = true;
          return this.allocateId(type, artifacts, counters);
        },
        save: (artifact) => {
          changed = true;
          artifacts.set(artifact.id, artifact);
        },
        remove: (id) => {
          changed = true;
          artifacts.delete(id);
        },
      });
      return changed ? { artifacts, counters } : undefined;
    });
    return result;
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

  private board(conversationId: string): LockedFile<BoardState> {
    let board = this.boards.get(conversationId);
    if (!board) {
      const path = this.pathOf(conversationId);
      board = this.files.json<BoardState>(path, {
        parse: content => this.parse(path, content),
        empty: EMPTY_BOARD,
        serialize: ({ counters, artifacts }) => ({ counters, artifacts: [...artifacts.values()] }),
      });
      this.boards.set(conversationId, board);
    }
    return board;
  }

  private parse(path: string, content: unknown): BoardState {
    const parsed = storedArtifactsSchema.safeParse(content);
    if (!parsed.success) {
      this.logger.warn(`artifacts_invalid_file: ${path}`);
      return EMPTY_BOARD;
    }
    return {
      artifacts: new Map(parsed.data.artifacts.map(artifact => [artifact.id, artifact])),
      counters: parsed.data.counters,
    };
  }

  /** The conversation id is encoded, so it never climbs out of the directory or holds a separator. */
  private pathOf(conversationId: string): string {
    return join(this.directory, `${encodeURIComponent(conversationId)}${FILE_EXTENSION}`);
  }
}
