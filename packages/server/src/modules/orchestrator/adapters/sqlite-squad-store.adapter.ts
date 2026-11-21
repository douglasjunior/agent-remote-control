import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, type Repository } from 'typeorm';

import { SqliteTransactionService } from '../../database/services/sqlite-transaction.service.js';
import { SquadProfileEntity } from '../entities/squad-profile.entity.js';
import { SquadEntity } from '../entities/squad.entity.js';
import type { AgentProfileSettings } from '../models/agent-settings.model.js';
import type { Squad } from '../models/squad.model.js';
import type { ISquadStorePort, SquadDraft, SquadSaveOutcome } from '../ports/squad-store.port.js';


const SELECT_CREATED_AT = 'SELECT "created_at" AS "createdAt" FROM "squad" WHERE "id" = ?';
const SELECT_NAME_TAKEN = 'SELECT 1 AS "taken" FROM "squad" WHERE lower("name") = lower(?) AND "id" <> ?';
const CLEAR_DEFAULT = 'UPDATE "squad" SET "is_default" = 0 WHERE "is_default" = 1 AND "id" <> ?';
const UPSERT_SQUAD = `
  INSERT INTO "squad" ("id", "name", "description", "is_default", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT ("id") DO UPDATE SET "name" = excluded."name", "description" = excluded."description",
    "is_default" = excluded."is_default", "updated_at" = excluded."updated_at"`;
const DELETE_PROFILES = 'DELETE FROM "squad_profile" WHERE "squad_id" = ?';
const INSERT_PROFILE = `
  INSERT INTO "squad_profile" ("squad_id", "role", "agent_id", "agent_name", "model_id", "model_name", "effort_id", "effort_name")
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

/** One `squad` row per squad and one `squad_profile` row per role it sets. */
@Injectable()
export class SqliteSquadStoreAdapter implements ISquadStorePort {
  private readonly squads: Repository<SquadEntity>;
  private readonly profiles: Repository<SquadProfileEntity>;

  constructor(dataSource: DataSource, private readonly transactions: SqliteTransactionService) {
    this.squads = dataSource.getRepository(SquadEntity);
    this.profiles = dataSource.getRepository(SquadProfileEntity);
  }

  async list(): Promise<readonly Squad[]> {
    const rows = await this.squads.createQueryBuilder('squad').orderBy('lower(squad.name)').getMany();
    const profiles = await this.profiles.find({ order: { role: 'ASC' } });
    return rows.map(row => this.toSquad(row, profiles.filter(profile => profile.squadId === row.id)));
  }

  async get(id: string): Promise<Squad | null> {
    return this.withProfiles(await this.squads.findOneBy({ id }));
  }

  async findDefault(): Promise<Squad | null> {
    return this.withProfiles(await this.squads.findOneBy({ isDefault: true }));
  }

  async save(draft: SquadDraft): Promise<SquadSaveOutcome> {
    const id = draft.id ?? randomUUID();
    const now = new Date().toISOString();
    return this.transactions.run((statements): SquadSaveOutcome => {
      const existing = statements.get<{ createdAt: string }>(SELECT_CREATED_AT, id);
      if (draft.id && !existing) {
        return { ok: false, reason: 'not-found' };
      }
      if (statements.get(SELECT_NAME_TAKEN, draft.name, id)) {
        return { ok: false, reason: 'name-taken' };
      }
      if (draft.isDefault) {
        statements.run(CLEAR_DEFAULT, id);
      }
      const createdAt = existing?.createdAt ?? now;
      statements.run(UPSERT_SQUAD, id, draft.name, draft.description ?? null, draft.isDefault ? 1 : 0, createdAt, now);
      statements.run(DELETE_PROFILES, id);
      for (const [role, profile] of Object.entries(draft.profiles)) {
        statements.run(INSERT_PROFILE, id, role, profile.agentId, profile.agentName, profile.modelId, profile.modelName, profile.effortId, profile.effortName);
      }
      return {
        ok: true,
        squad: {
          id,
          name: draft.name,
          ...(draft.description !== undefined && { description: draft.description }),
          isDefault: draft.isDefault,
          profiles: draft.profiles,
          createdAt,
          updatedAt: now,
        },
      };
    });
  }

  async delete(id: string): Promise<boolean> {
    return Boolean((await this.squads.delete({ id })).affected);
  }

  private async withProfiles(row: SquadEntity | null): Promise<Squad | null> {
    return row ? this.toSquad(row, await this.profiles.find({ where: { squadId: row.id }, order: { role: 'ASC' } })) : null;
  }

  private toSquad(row: SquadEntity, profiles: readonly SquadProfileEntity[]): Squad {
    return {
      id: row.id,
      name: row.name,
      ...(row.description !== null && { description: row.description }),
      isDefault: row.isDefault,
      profiles: Object.fromEntries(profiles.map((profile): [string, AgentProfileSettings] => [
        profile.role, {
          agentId: profile.agentId,
          agentName: profile.agentName,
          modelId: profile.modelId,
          modelName: profile.modelName,
          effortId: profile.effortId,
          effortName: profile.effortName,
        },
      ])),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
