import { Injectable, Logger, Optional } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Preferences } from '../models/preferences.model.js';
import type { IPreferencesStorePort } from '../ports/preferences-store.port.js';
import { resolveDataDirectory } from '../utils/data-directory.util.js';


const PREFERENCES_FILENAME = 'preferences.json';

@Injectable()
export class JsonPreferencesStoreAdapter implements IPreferencesStorePort {
  private readonly logger = new Logger(JsonPreferencesStoreAdapter.name);
  private readonly dataDirectory: string;
  private readonly filePath: string;
  private preferences: Promise<Preferences> | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(@Optional() customDataDir?: string) {
    this.dataDirectory = resolveDataDirectory(customDataDir);
    this.filePath = join(this.dataDirectory, PREFERENCES_FILENAME);
  }

  load(): Promise<Preferences> {
    this.preferences ??= this.read();
    return this.preferences;
  }

  async update(changes: Omit<Preferences, 'updatedAt'>): Promise<Preferences> {
    const updated: Preferences = { ...await this.load(), ...changes, updatedAt: new Date().toISOString() };
    this.preferences = Promise.resolve(updated);
    const content = JSON.stringify(updated, null, 2);
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(() => this.write(content));
    await this.writeChain;
    return updated;
  }

  private async read(): Promise<Preferences> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf-8')) as Partial<Record<keyof Preferences, unknown>> | null;
      return {
        ...(typeof parsed?.language === 'string' ? { language: parsed.language } : {}),
        ...(typeof parsed?.updatedAt === 'string' ? { updatedAt: parsed.updatedAt } : {}),
      };
    } catch {
      this.logger.debug(`preferences_read_skipped: ${this.filePath}`);
      return {};
    }
  }

  private async write(content: string): Promise<void> {
    await mkdir(this.dataDirectory, { recursive: true });
    await writeFile(this.filePath, content, 'utf-8');
  }
}
