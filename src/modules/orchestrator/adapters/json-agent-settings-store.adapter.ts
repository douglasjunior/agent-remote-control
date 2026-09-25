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
  private settings: Promise<AgentSettings | null> | null = null;

  constructor(@Optional() customDataDir?: string) {
    this.dataDirectory = resolveDataDirectory(customDataDir);
    this.filePath = join(this.dataDirectory, SETTINGS_FILENAME);
  }

  load(): Promise<AgentSettings | null> {
    this.settings ??= this.read();
    return this.settings;
  }

  async save(settings: AgentSettings): Promise<void> {
    this.settings = Promise.resolve(settings);
    await mkdir(this.dataDirectory, { recursive: true });
    await writeFile(this.filePath, JSON.stringify(settings, null, 2), 'utf-8');
  }

  private async read(): Promise<AgentSettings | null> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf-8')) as Partial<AgentSettings> | null;
      if (typeof parsed?.modelId !== 'string' || typeof parsed.modelName !== 'string') {
        return null;
      }
      return {
        modelId: parsed.modelId,
        modelName: parsed.modelName,
        effortId: parsed.effortId ?? null,
        effortName: parsed.effortName ?? null,
        updatedAt: parsed.updatedAt ?? '',
      };
    } catch {
      this.logger.debug(`agent_settings_read_skipped: ${this.filePath}`);
      return null;
    }
  }
}
