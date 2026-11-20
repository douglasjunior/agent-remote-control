import { Injectable } from '@nestjs/common';
import { DataSource, type Repository } from 'typeorm';

import { SqliteTransactionService, type SqliteStatements } from '../../database/services/sqlite-transaction.service.js';
import { AgentProfileEntity } from '../entities/agent-profile.entity.js';
import { AgentSettingsEntity } from '../entities/agent-settings.entity.js';
import type { AgentProfileSettings, AgentSettings } from '../models/agent-settings.model.js';
import type { AgentSettingsChange, IAgentSettingsStorePort } from '../ports/agent-settings-store.port.js';


const SETTINGS_COLUMNS = '"conversation_id" AS "conversationId", "applied_squad_id" AS "appliedSquadId", '
  + '"applied_squad_name" AS "appliedSquadName", "updated_at" AS "updatedAt"';
const PROFILE_COLUMNS = '"role", "agent_id" AS "agentId", "agent_name" AS "agentName", "model_id" AS "modelId", '
  + '"model_name" AS "modelName", "effort_id" AS "effortId", "effort_name" AS "effortName"';
const SELECT_SETTINGS = `SELECT ${SETTINGS_COLUMNS} FROM "agent_settings" WHERE "conversation_id" = ?`;
const SELECT_MOST_RECENT = `SELECT ${SETTINGS_COLUMNS} FROM "agent_settings" ORDER BY "updated_at" DESC LIMIT 1`;
const SELECT_PROFILES = `SELECT ${PROFILE_COLUMNS} FROM "agent_profile" WHERE "conversation_id" = ? ORDER BY "role"`;
const UPSERT_SETTINGS = `
  INSERT INTO "agent_settings" ("conversation_id", "applied_squad_id", "applied_squad_name", "updated_at") VALUES (?, ?, ?, ?)
  ON CONFLICT ("conversation_id") DO UPDATE SET "applied_squad_id" = excluded."applied_squad_id",
    "applied_squad_name" = excluded."applied_squad_name", "updated_at" = excluded."updated_at"`;
const DELETE_PROFILES = 'DELETE FROM "agent_profile" WHERE "conversation_id" = ?';
const INSERT_PROFILE = `
  INSERT INTO "agent_profile" ("conversation_id", "role", "agent_id", "agent_name", "model_id", "model_name", "effort_id", "effort_name")
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

type SettingsRow = Pick<AgentSettingsEntity, 'conversationId' | 'appliedSquadId' | 'appliedSquadName' | 'updatedAt'>;
type ProfileRow = Omit<AgentProfileEntity, 'conversationId' | 'settings'>;

/** One `agent_settings` row per conversation and one `agent_profile` row per role of it. */
@Injectable()
export class SqliteAgentSettingsStoreAdapter implements IAgentSettingsStorePort {
  private readonly settings: Repository<AgentSettingsEntity>;
  private readonly profiles: Repository<AgentProfileEntity>;

  constructor(dataSource: DataSource, private readonly transactions: SqliteTransactionService) {
    this.settings = dataSource.getRepository(AgentSettingsEntity);
    this.profiles = dataSource.getRepository(AgentProfileEntity);
  }

  async load(conversationId: string): Promise<AgentSettings | null> {
    return this.withProfiles(await this.settings.findOneBy({ conversationId }));
  }

  async loadMostRecent(): Promise<AgentSettings | null> {
    return this.withProfiles(await this.settings.findOne({ where: {}, order: { updatedAt: 'DESC' } }));
  }

  async update(conversationId: string, change: AgentSettingsChange): Promise<AgentSettings | null> {
    return this.transactions.run((statements) => {
      const own = this.read(statements, statements.get<SettingsRow>(SELECT_SETTINGS, conversationId));
      const updated = change(own, this.read(statements, statements.get<SettingsRow>(SELECT_MOST_RECENT)));
      if (!updated) {
        return own;
      }
      statements.run(UPSERT_SETTINGS, conversationId, updated.appliedSquad?.id ?? null, updated.appliedSquad?.name ?? null, updated.updatedAt);
      statements.run(DELETE_PROFILES, conversationId);
      for (const [role, profile] of Object.entries(updated.profiles)) {
        statements.run(INSERT_PROFILE, conversationId, role, profile.agentId, profile.agentName, profile.modelId, profile.modelName, profile.effortId, profile.effortName);
      }
      return updated;
    });
  }

  private async withProfiles(row: SettingsRow | null): Promise<AgentSettings | null> {
    if (!row) {
      return null;
    }
    const profiles = await this.profiles.find({ where: { conversationId: row.conversationId }, order: { role: 'ASC' } });
    return this.toSettings(row, profiles);
  }

  private read(statements: SqliteStatements, row: SettingsRow | undefined): AgentSettings | null {
    return row ? this.toSettings(row, statements.all<ProfileRow>(SELECT_PROFILES, row.conversationId)) : null;
  }

  private toSettings(row: SettingsRow, profiles: readonly ProfileRow[]): AgentSettings {
    return {
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
      ...(row.appliedSquadId !== null && { appliedSquad: { id: row.appliedSquadId, name: row.appliedSquadName as string } }),
      updatedAt: row.updatedAt,
    };
  }
}
