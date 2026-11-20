import { artifactDetailSchema, refinementKindSchema, refinementStateSchema } from '@agent-remote-control/protocol/artifact';
import { Injectable } from '@nestjs/common';
import { basename } from 'node:path';
import type { EntityManager } from 'typeorm';
import { z } from 'zod';

import type { ILegacyJsonImporterPort, LegacyJsonImport } from '../../database/ports/legacy-json-importer.port.js';
import { LegacyJsonFilesService } from '../../database/services/legacy-json-files.service.js';
import { REFINEMENT_KINDS, UNSTORED_REFINEMENT_STATES } from '../constants/artifact-catalog.constant.js';
import { ArtifactCounterEntity } from '../entities/artifact-counter.entity.js';
import { ArtifactDependencyEntity } from '../entities/artifact-dependency.entity.js';
import { ArtifactHistoryChangeEntity } from '../entities/artifact-history-change.entity.js';
import { ArtifactHistoryEntity } from '../entities/artifact-history.entity.js';
import { ArtifactPullRequestEntity } from '../entities/artifact-pull-request.entity.js';
import { ArtifactRefinementEntity } from '../entities/artifact-refinement.entity.js';
import { ArtifactSectionEntity } from '../entities/artifact-section.entity.js';
import { ArtifactEntity } from '../entities/artifact.entity.js';
import type { Artifact, ArtifactRefinement } from '../models/artifact.model.js';
import { toArtifactRows, type ArtifactRows } from '../utils/artifact-rows.util.js';


const ARTIFACTS_DIRECTORY = 'artifacts';
const FILE_EXTENSION = '.json';
const ROWS_PER_INSERT = 500;

/** A board file was written before some refinement kinds existed, and a kind it lacks takes its unstored state. */
const storedRefinementSchema = z
  .partialRecord(refinementKindSchema, refinementStateSchema)
  .transform(stored => Object.fromEntries(REFINEMENT_KINDS.map(kind => [kind, stored[kind] ?? UNSTORED_REFINEMENT_STATES[kind]])) as ArtifactRefinement);

const boardFileSchema = z.object({
  counters: z.record(z.string(), z.number().int().min(0)).default({}),
  artifacts: z.array(artifactDetailSchema.extend({ refinement: storedRefinementSchema })),
});

type ImportedBoard = {
  readonly conversationId: string;
  readonly counters: Readonly<Record<string, number>>;
  readonly artifacts: readonly Artifact[];
};

/**
 * `DATA_DIR/artifacts/<encodeURIComponent(conversationId)>.json`, one board per conversation. An artifact id listed
 * twice keeps its first place and its last content; a board whose conversation already has rows is kept as it is.
 */
@Injectable()
export class JsonArtifactsImporterAdapter implements ILegacyJsonImporterPort {
  readonly name = 'artifacts';

  constructor(private readonly files: LegacyJsonFilesService) {}

  async read(): Promise<LegacyJsonImport> {
    const files: string[] = [];
    const boards: ImportedBoard[] = [];
    for (const path of await this.files.list(ARTIFACTS_DIRECTORY)) {
      const stored = await this.files.read(path, boardFileSchema);
      if (stored) {
        files.push(path);
        const artifacts = [...new Map(stored.artifacts.map(artifact => [artifact.id, artifact])).values()];
        boards.push({ conversationId: decodeURIComponent(basename(path, FILE_EXTENSION)), counters: stored.counters, artifacts });
      }
    }
    return {
      files,
      counts: { boards: boards.length, artifacts: boards.reduce((total, board) => total + board.artifacts.length, 0) },
      write: async (manager: EntityManager) => {
        const existing = new Set([
          ...(await manager.find(ArtifactEntity, { select: { conversationId: true } })).map(row => row.conversationId),
          ...(await manager.find(ArtifactCounterEntity, { select: { conversationId: true } })).map(row => row.conversationId),
        ]);
        const imported = boards.filter(board => !existing.has(board.conversationId));
        const rows = imported.flatMap(board => board.artifacts.map((artifact, position) => toArtifactRows(board.conversationId, artifact, position)));
        const counters = imported.flatMap(board => Object.entries(board.counters).map(([prefix, value]) => ({ conversationId: board.conversationId, prefix, value })));
        await this.insert(manager, ArtifactEntity, rows.map(row => row.artifact));
        await this.insertLists(manager, rows);
        await this.insert(manager, ArtifactCounterEntity, counters);
      },
    };
  }

  private async insertLists(manager: EntityManager, rows: readonly ArtifactRows[]): Promise<void> {
    await this.insert(manager, ArtifactRefinementEntity, rows.flatMap(row => row.refinements));
    await this.insert(manager, ArtifactSectionEntity, rows.flatMap(row => row.sections));
    await this.insert(manager, ArtifactDependencyEntity, rows.flatMap(row => row.dependencies));
    await this.insert(manager, ArtifactPullRequestEntity, rows.flatMap(row => row.pullRequests));
    await this.insert(manager, ArtifactHistoryEntity, rows.flatMap(row => row.history.map(event => event.event)));
    await this.insert(manager, ArtifactHistoryChangeEntity, rows.flatMap(row => row.history.flatMap(event => event.changes)));
  }

  private async insert<T extends object>(manager: EntityManager, entity: new () => T, rows: readonly T[]): Promise<void> {
    for (let start = 0; start < rows.length; start += ROWS_PER_INSERT) {
      await manager.insert(entity, rows.slice(start, start + ROWS_PER_INSERT) as T[]);
    }
  }
}
