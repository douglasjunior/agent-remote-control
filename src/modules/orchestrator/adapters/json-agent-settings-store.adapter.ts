import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { AgentProfileSettings, AgentSettings } from '../models/agent-settings.model.js';
import { IAgentRegistryPort } from '../ports/agent-registry.port.js';
import type { IAgentSettingsStorePort } from '../ports/agent-settings-store.port.js';
import { profileForAllRoles } from '../utils/agent-profile.util.js';
import { resolveDataDirectory } from '../utils/data-directory.util.js';


const SETTINGS_FILENAME = 'agent-settings.json';

type RawSettings = Partial<AgentProfileSettings> & {
  readonly profiles?: Record<string, Partial<AgentProfileSettings> | null>;
  readonly updatedAt?: string;
};

@Injectable()
export class JsonAgentSettingsStoreAdapter implements IAgentSettingsStorePort {
  private readonly logger = new Logger(JsonAgentSettingsStoreAdapter.name);
  private readonly dataDirectory: string;
  private readonly filePath: string;
  private settings: Promise<Map<string, AgentSettings>> | null = null;

  constructor(
    @Inject(IAgentRegistryPort)
    private readonly agentRegistry: IAgentRegistryPort,
    @Optional() customDataDir?: string,
  ) {
    this.dataDirectory = resolveDataDirectory(customDataDir);
    this.filePath = join(this.dataDirectory, SETTINGS_FILENAME);
  }

  async load(conversationId: string): Promise<AgentSettings | null> {
    this.settings ??= this.read();
    return (await this.settings).get(conversationId) ?? null;
  }

  async loadMostRecent(): Promise<AgentSettings | null> {
    this.settings ??= this.read();
    const all = Array.from((await this.settings).values());
    if (all.length === 0) {
      return null;
    }
    return all.reduce((latest, current) =>
      current.updatedAt > latest.updatedAt ? current : latest);
  }

  async save(conversationId: string, settings: AgentSettings): Promise<void> {
    this.settings ??= this.read();
    const all = await this.settings;
    all.set(conversationId, settings);
    await mkdir(this.dataDirectory, { recursive: true });
    await writeFile(this.filePath, JSON.stringify(Object.fromEntries(all), null, 2), 'utf-8');
  }

  private async read(): Promise<Map<string, AgentSettings>> {
    const result = new Map<string, AgentSettings>();
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf-8')) as Record<string, unknown> | null;
      for (const [key, entry] of Object.entries(parsed ?? {})) {
        const settings = this.parseEntry(entry);
        if (settings) {
          result.set(key, settings);
        }
      }
    } catch {
      this.logger.debug(`agent_settings_read_skipped: ${this.filePath}`);
    }
    return result;
  }

  private parseEntry(entry: unknown): AgentSettings | null {
    if (typeof entry !== 'object' || entry === null) {
      return null;
    }
    const raw = entry as RawSettings;
    const updatedAt = raw.updatedAt ?? '';
    if (typeof raw.agentId === 'string') {
      const legacyProfile = this.parseProfile(raw);
      return legacyProfile ? { profiles: profileForAllRoles(this.agentRegistry.listRoles(), legacyProfile), updatedAt } : null;
    }
    const profiles: Record<string, AgentProfileSettings> = {};
    for (const [role, rawProfile] of Object.entries(raw.profiles ?? {})) {
      const profile = this.parseProfile(rawProfile);
      if (profile) {
        profiles[role] = profile;
      }
    }
    return Object.keys(profiles).length > 0 ? { profiles, updatedAt } : null;
  }

  private parseProfile(raw: Partial<AgentProfileSettings> | null): AgentProfileSettings | null {
    if (typeof raw?.agentId !== 'string') {
      return null;
    }
    return {
      agentId: raw.agentId,
      agentName: raw.agentName ?? raw.agentId,
      modelId: raw.modelId ?? null,
      modelName: raw.modelName ?? null,
      effortId: raw.effortId ?? null,
      effortName: raw.effortName ?? null,
    };
  }
}
