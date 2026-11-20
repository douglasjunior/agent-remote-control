import { Inject, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { z } from 'zod';

import type { ILegacyJsonImporterPort, LegacyJsonImport } from '../../database/ports/legacy-json-importer.port.js';
import { LegacyJsonFilesService } from '../../database/services/legacy-json-files.service.js';
import { AgentProfileEntity } from '../entities/agent-profile.entity.js';
import { AgentSettingsEntity } from '../entities/agent-settings.entity.js';
import type { AgentProfileSettings, AgentSettings } from '../models/agent-settings.model.js';
import { IAgentRegistryPort } from '../ports/agent-registry.port.js';
import { profileForAllRoles } from '../utils/agent-profile.util.js';


const SETTINGS_FILE = 'agent-settings.json';
const ROWS_PER_INSERT = 500;

/** The settings of each conversation by its id; each entry is read as leniently as the JSON store read it. */
const settingsFileSchema = z.record(z.string(), z.unknown()).nullable();

type RawProfile = Partial<Record<keyof AgentProfileSettings, unknown>>;
type RawSettings = RawProfile & { readonly profiles?: unknown; readonly updatedAt?: unknown };

/**
 * `DATA_DIR/agent-settings.json`. An entry of the earliest format holds one profile, which every role takes; a
 * profile without an agent, and an entry left without profiles, are dropped.
 */
@Injectable()
export class JsonAgentSettingsImporterAdapter implements ILegacyJsonImporterPort {
  readonly name = 'agent-settings';

  constructor(
    private readonly files: LegacyJsonFilesService,
    @Inject(IAgentRegistryPort) private readonly agentRegistry: IAgentRegistryPort,
  ) {}

  async read(): Promise<LegacyJsonImport> {
    const stored = await this.files.read(SETTINGS_FILE, settingsFileSchema);
    const settings = Object.entries(stored ?? {}).flatMap(([conversationId, entry]) => {
      const parsed = this.parseEntry(entry);
      return parsed ? [{ conversationId, ...parsed }] : [];
    });
    return {
      files: stored === undefined ? [] : [SETTINGS_FILE],
      counts: { conversations: settings.length },
      write: async (manager: EntityManager) => {
        const existing = new Set((await manager.find(AgentSettingsEntity, { select: { conversationId: true } })).map(row => row.conversationId));
        const imported = settings.filter(({ conversationId }) => !existing.has(conversationId));
        const profiles = imported.flatMap(({ conversationId, profiles: byRole }) =>
          Object.entries(byRole).map(([role, profile]) => ({ conversationId, role, ...profile })));
        for (let start = 0; start < imported.length; start += ROWS_PER_INSERT) {
          const rows = imported.slice(start, start + ROWS_PER_INSERT).map(({ conversationId, updatedAt }) => ({ conversationId, updatedAt }));
          await manager.insert(AgentSettingsEntity, rows);
        }
        for (let start = 0; start < profiles.length; start += ROWS_PER_INSERT) {
          await manager.insert(AgentProfileEntity, profiles.slice(start, start + ROWS_PER_INSERT));
        }
      },
    };
  }

  private parseEntry(entry: unknown): AgentSettings | null {
    if (typeof entry !== 'object' || entry === null) {
      return null;
    }
    const raw = entry as RawSettings;
    const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : '';
    if (typeof raw.agentId === 'string') {
      return { profiles: profileForAllRoles(this.agentRegistry.listRoles(), this.parseProfile(raw)!), updatedAt };
    }
    const profiles: Record<string, AgentProfileSettings> = {};
    for (const [role, rawProfile] of Object.entries(typeof raw.profiles === 'object' && raw.profiles !== null ? raw.profiles : {})) {
      const profile = this.parseProfile(rawProfile as RawProfile | null);
      if (profile) {
        profiles[role] = profile;
      }
    }
    return Object.keys(profiles).length > 0 ? { profiles, updatedAt } : null;
  }

  private parseProfile(raw: RawProfile | null): AgentProfileSettings | null {
    if (typeof raw?.agentId !== 'string') {
      return null;
    }
    const text = (value: unknown) => (typeof value === 'string' ? value : null);
    return {
      agentId: raw.agentId,
      agentName: text(raw.agentName) ?? raw.agentId,
      modelId: text(raw.modelId),
      modelName: text(raw.modelName),
      effortId: text(raw.effortId),
      effortName: text(raw.effortName),
    };
  }
}
