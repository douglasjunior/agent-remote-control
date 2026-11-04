import { MAX_PROMPT_HISTORY } from '@agent-remote-control/protocol/limits';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';

import { resolveDataDirectory } from '../../orchestrator/utils/data-directory.util.js';
import type { IPromptHistoryPort } from '../ports/prompt-history.port.js';


@Injectable()
export class JsonPromptHistoryAdapter implements IPromptHistoryPort {
  private readonly logger = new Logger(JsonPromptHistoryAdapter.name);
  private readonly filePath: string;
  private prompts: Promise<string[]> | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(@Optional() customDataDir?: string) {
    this.filePath = join(resolveDataDirectory(customDataDir), 'web', 'prompt-history.json');
  }

  async list(): Promise<readonly string[]> {
    return [...await this.load()];
  }

  async append(prompt: string): Promise<void> {
    const prompts = await this.load();
    if (prompts[0] === prompt) {
      return;
    }
    prompts.unshift(prompt);
    prompts.length = Math.min(prompts.length, MAX_PROMPT_HISTORY);
    await this.persist([...prompts]);
  }

  private load(): Promise<string[]> {
    this.prompts ??= this.read();
    return this.prompts;
  }

  private async read(): Promise<string[]> {
    let content: unknown;
    try {
      content = JSON.parse(await readFile(this.filePath, 'utf-8'));
    } catch {
      return [];
    }
    const parsed = z.array(z.string()).safeParse(content);
    if (!parsed.success) {
      this.logger.warn(`prompt_history_invalid_file: ${this.filePath}`);
      return [];
    }
    return parsed.data.slice(0, MAX_PROMPT_HISTORY);
  }

  private persist(prompts: string[]): Promise<void> {
    this.writeChain = this.writeChain
      .then(() => this.writeAtomically(prompts))
      .catch((error: unknown) => {
        this.logger.error(`prompt_history_write_failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    return this.writeChain;
  }

  private async writeAtomically(prompts: string[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(prompts, null, 2), 'utf-8');
    await rename(temporary, this.filePath);
  }
}
