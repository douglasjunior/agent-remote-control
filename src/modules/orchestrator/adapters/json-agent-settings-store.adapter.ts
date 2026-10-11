import { Injectable, Logger, Optional } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { AgentSettings } from '../models/agent-settings.model.js';
import type { IAgentSettingsStorePort } from '../ports/agent-settings-store.port.js';
import { resolveDataDirectory } from '../utils/data-directory.util.js';


const SETTINGS_FILENAME = 'agent-settings.json';

@Injectable()
export class JsonAgentSettingsStoreAdapter implements IAgentSettingsStorePort {
  private readonly logger = new Logger(JsonAgentSettingsStoreAdapter.name);
  private readonly dataDirectory: string;
  private readonly filePath: string;
  private settings: Promise<Map<string, AgentSettings>> | null = null;

  constructor(@Optional() customDataDir?: string) {
    this.dataDirectory = resolveDataDirectory(customDataDir);
    this.filePath = join(this.dataDirectory, SETTINGS_FILENAME);
  }

  async load(conversationId: string): Promise<AgentSettings | null> {
    this.settings ??= this.read();
    return (await this.settings).get(conversationId) ?? null;
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
      const parsed = JSON.parse(await readFile(this.filePath, 'utf-8')) as Record<string, Partial<AgentSettings> | null> | null;
      for (const [key, entry] of Object.entries(parsed ?? {})) {
        if (typeof entry?.agentId !== 'string') {
          continue;
        }
        result.set(key, {
          agentId: entry.agentId,
          agentName: entry.agentName ?? entry.agentId,
          modelId: entry.modelId ?? null,
          modelName: entry.modelName ?? null,
          effortId: entry.effortId ?? null,
          effortName: entry.effortName ?? null,
          updatedAt: entry.updatedAt ?? '',
        });
      }
    } catch {
      this.logger.debug(`agent_settings_read_skipped: ${this.filePath}`);
    }
    return result;
  }
}
