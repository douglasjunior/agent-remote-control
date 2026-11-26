import { Injectable, Logger } from '@nestjs/common';
import { basename, dirname } from 'node:path';
import type { EntityManager } from 'typeorm';
import { z } from 'zod';

import type { ILegacyJsonImporterPort, LegacyJsonImport } from '../../database/ports/legacy-json-importer.port.js';
import { LegacyJsonFilesService } from '../../database/services/legacy-json-files.service.js';
import { openWorkSchema } from '../constants/open-work-schema.constant.js';
import { OpenWorkEntity } from '../entities/open-work.entity.js';
import type { OpenWork } from '../models/open-work.model.js';
import { featureKey, readImportedFeatureKeys } from '../utils/imported-feature-keys.util.js';


const OPEN_WORK_FILE = 'open-work.json';
const ROWS_PER_INSERT = 500;

/** The records of each conversation by its id; each record is checked on its own. */
const openWorkFileSchema = z.record(z.string(), z.array(z.unknown()));

/** `DATA_DIR/open-work.json`. A record that is not a valid `OpenWork` is logged and dropped; one of a feature is keyed to the workspaces root. */
@Injectable()
export class JsonOpenWorkImporterAdapter implements ILegacyJsonImporterPort {
  readonly name = 'open-work';
  readonly requires = ['artifacts'];
  private readonly logger = new Logger(JsonOpenWorkImporterAdapter.name);

  constructor(private readonly files: LegacyJsonFilesService) {}

  async read(): Promise<LegacyJsonImport> {
    const stored = await this.files.read(OPEN_WORK_FILE, openWorkFileSchema);
    const work = Object.entries(stored ?? {}).map(([conversationId, records]): [string, OpenWork[]] => [conversationId, this.parseRecords(conversationId, records)]);
    const rows = work.flatMap(([conversationId, records]) => records.map((record, position) => this.toRow(conversationId, record, position)));
    return {
      files: stored === undefined ? [] : [OPEN_WORK_FILE],
      counts: { records: rows.length },
      write: async (manager: EntityManager) => {
        const existing = new Set((await manager.find(OpenWorkEntity, { select: { conversationId: true } })).map(row => row.conversationId));
        const features = await readImportedFeatureKeys(manager);
        const imported = rows.filter(row => !existing.has(row.conversationId)).map(row => this.keyFeatureToRoot(row, features));
        for (let start = 0; start < imported.length; start += ROWS_PER_INSERT) {
          await manager.insert(OpenWorkEntity, imported.slice(start, start + ROWS_PER_INSERT));
        }
      },
    };
  }

  private parseRecords(conversationId: string, records: readonly unknown[]): OpenWork[] {
    return records.flatMap((record) => {
      const parsed = openWorkSchema.safeParse(record);
      if (!parsed.success) {
        this.logger.warn(`legacy_record_skipped: a record of ${conversationId} in ${OPEN_WORK_FILE} is not valid open work`);
        return [];
      }
      return [parsed.data];
    });
  }

  /** A feature's work runs at the workspaces root, the parent of the project folder the legacy record points at. */
  private keyFeatureToRoot(row: OpenWorkEntity, features: ReadonlySet<string>): OpenWorkEntity {
    if (!features.has(featureKey(row.conversationId, row.artifactId))) {
      return row;
    }
    const inProjectFolder = row.projectName !== null && basename(row.cwd) === row.projectName;
    return { ...row, projectName: null, cwd: inProjectFolder ? dirname(row.cwd) : row.cwd };
  }

  private toRow(conversationId: string, record: OpenWork, position: number): OpenWorkEntity {
    return {
      conversationId,
      id: record.id,
      position,
      role: record.role,
      roleName: record.roleName,
      projectName: record.projectName,
      artifactId: record.artifactId ?? null,
      summary: record.summary,
      taskSpec: record.taskSpec,
      cwd: record.cwd,
      round: record.round,
      root: record.root,
      questions: record.questions ? JSON.stringify(record.questions) : null,
      updates: null,
    };
  }
}
