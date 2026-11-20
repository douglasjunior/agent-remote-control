import { Inject, Injectable } from '@nestjs/common';
import { join } from 'node:path';

import { DataDirectoryService } from '../../paths/services/data-directory.service.js';
import { ILockedFilesPort, type LockedFile } from '../../storage/ports/locked-files.port.js';
import type { AgentProfileSettings, AgentSettings } from '../models/agent-settings.model.js';
import { IAgentRegistryPort } from '../ports/agent-registry.port.js';
import type { AgentSettingsChange, IAgentSettingsStorePort } from '../ports/agent-settings-store.port.js';
import { profileForAllRoles } from '../utils/agent-profile.util.js';


const SETTINGS_FILENAME = 'agent-settings.json';

type RawSettings = Partial<AgentProfileSettings> & {
  readonly profiles?: Record<string, Partial<AgentProfileSettings> | null>;
  readonly updatedAt?: string;
};

type SettingsByConversation = ReadonlyMap<string, AgentSettings>;

/** `DATA_DIR/agent-settings.json`: the settings of every conversation, by conversation id. */
@Injectable()
export class JsonAgentSettingsStoreAdapter implements IAgentSettingsStorePort {
  private readonly file: LockedFile<SettingsByConversation>;

  constructor(
    @Inject(IAgentRegistryPort)
    private readonly agentRegistry: IAgentRegistryPort,
    dataDirectoryService: DataDirectoryService,
    @Inject(ILockedFilesPort) files: ILockedFilesPort,
  ) {
    this.file = files.json<SettingsByConversation>(join(dataDirectoryService.resolve(), SETTINGS_FILENAME), {
      parse: content => this.parse(content),
      empty: new Map(),
      serialize: settings => Object.fromEntries(settings),
    });
  }

  async load(conversationId: string): Promise<AgentSettings | null> {
    return (await this.file.read()).get(conversationId) ?? null;
  }

  async loadMostRecent(): Promise<AgentSettings | null> {
    return this.mostRecent(await this.file.read());
  }

  async update(conversationId: string, change: AgentSettingsChange): Promise<AgentSettings | null> {
    const stored = await this.file.update((all) => {
      const updated = change(all.get(conversationId) ?? null, this.mostRecent(all));
      return updated ? new Map(all).set(conversationId, updated) : undefined;
    });
    return stored.get(conversationId) ?? null;
  }

  private mostRecent(all: SettingsByConversation): AgentSettings | null {
    let latest: AgentSettings | null = null;
    for (const settings of all.values()) {
      if (!latest || settings.updatedAt > latest.updatedAt) {
        latest = settings;
      }
    }
    return latest;
  }

  private parse(content: unknown): SettingsByConversation {
    const result = new Map<string, AgentSettings>();
    for (const [key, entry] of Object.entries(typeof content === 'object' && content !== null ? content : {})) {
      const settings = this.parseEntry(entry);
      if (settings) {
        result.set(key, settings);
      }
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
