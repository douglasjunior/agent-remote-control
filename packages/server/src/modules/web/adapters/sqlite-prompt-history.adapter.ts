import { MAX_PROMPT_HISTORY } from '@agent-remote-control/protocol/limits';
import { Injectable, Logger } from '@nestjs/common';
import { DataSource, type Repository } from 'typeorm';

import { PromptHistoryEntity } from '../entities/prompt-history.entity.js';
import type { IPromptHistoryPort } from '../ports/prompt-history.port.js';


/** Inserts the prompt unless it equals the latest one, in one statement so two appends cannot both pass the check. */
const APPEND_PROMPT = `
  INSERT INTO "prompt_history" ("prompt")
  SELECT ? WHERE ? IS NOT (SELECT "prompt" FROM "prompt_history" ORDER BY "id" DESC LIMIT 1)`;

const TRIM_PROMPTS = `
  DELETE FROM "prompt_history" WHERE "id" NOT IN (SELECT "id" FROM "prompt_history" ORDER BY "id" DESC LIMIT ?)`;

/**
 * The history is a convenience, so a prompt that cannot be written is logged and left out rather than failing the
 * message that sent it.
 */
@Injectable()
export class SqlitePromptHistoryAdapter implements IPromptHistoryPort {
  private readonly logger = new Logger(SqlitePromptHistoryAdapter.name);
  private readonly prompts: Repository<PromptHistoryEntity>;

  constructor(private readonly dataSource: DataSource) {
    this.prompts = dataSource.getRepository(PromptHistoryEntity);
  }

  async list(): Promise<readonly string[]> {
    const rows = await this.prompts.find({ order: { id: 'DESC' }, take: MAX_PROMPT_HISTORY });
    return rows.map(row => row.prompt);
  }

  async append(prompt: string): Promise<void> {
    try {
      await this.dataSource.query(APPEND_PROMPT, [prompt, prompt]);
      await this.dataSource.query(TRIM_PROMPTS, [MAX_PROMPT_HISTORY]);
    } catch (error) {
      this.logger.error(`prompt_history_write_failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
