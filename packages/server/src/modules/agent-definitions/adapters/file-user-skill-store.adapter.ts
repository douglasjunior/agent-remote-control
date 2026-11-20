import { Inject, Injectable, Logger } from '@nestjs/common';
import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { AgentSkillInput } from '../../orchestrator/models/agent-skill.model.js';
import { DataDirectoryService } from '../../paths/services/data-directory.service.js';
import { IFileLockPort } from '../../storage/ports/file-lock.port.js';
import { ILockedFilesPort } from '../../storage/ports/locked-files.port.js';
import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';
import type { IUserSkillStorePort } from '../ports/user-skill-store.port.js';


const SKILLS_DIRECTORY = 'skills';
const SKILL_FILE = 'SKILL.md';
const LOCK_FILE = '.lock';
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Reads `DATA_DIR/skills/<skill>/SKILL.md` on every call, so an edited skill applies to the next read without a
 * restart. The frontmatter needs a `description` and the `roles` that may read the skill; `name` defaults to the
 * folder name. Writes and deletes take one lock for the whole folder, since a delete finds its skill by name among
 * all of them.
 */
@Injectable()
export class FileUserSkillStoreAdapter implements IUserSkillStorePort {
  private readonly logger = new Logger(FileUserSkillStoreAdapter.name);
  private readonly directory: string;
  private readonly lockPath: string;

  constructor(
    dataDirectoryService: DataDirectoryService,
    @Inject(ILockedFilesPort) private readonly files: ILockedFilesPort,
    @Inject(IFileLockPort) private readonly lock: IFileLockPort,
  ) {
    this.directory = join(dataDirectoryService.resolve(), SKILLS_DIRECTORY);
    this.lockPath = join(this.directory, LOCK_FILE);
  }

  async list(): Promise<readonly AgentSkillDefinition[]> {
    return (await this.entries()).map(entry => entry.skill);
  }

  delete(name: string): Promise<boolean> {
    return this.lock.withLock(this.lockPath, async () => {
      const entry = (await this.entries()).find(candidate => candidate.skill.name.toLowerCase() === name.toLowerCase());
      if (!entry) {
        return false;
      }
      await rm(join(this.directory, entry.folder), { recursive: true, force: true });
      return true;
    });
  }

  private async entries(): Promise<{ folder: string; skill: AgentSkillDefinition }[]> {
    const entries: { folder: string; skill: AgentSkillDefinition }[] = [];
    for (const folder of (await this.folders()).sort()) {
      const skill = await this.readSkill(join(this.directory, folder, SKILL_FILE), folder);
      if (skill) {
        entries.push({ folder, skill });
      }
    }
    return entries;
  }

  async write(skill: AgentSkillInput): Promise<boolean> {
    const text = [
      '---',
      `name: ${skill.name}`,
      `description: ${skill.description.replace(/\s+/g, ' ')}`,
      `roles: ${skill.roles.join(', ')}`,
      '---',
      '',
      skill.content,
      '',
    ].join('\n');
    let created = false;
    await this.files.text(join(this.directory, skill.name, SKILL_FILE), { lockPath: this.lockPath }).update((current) => {
      created = current === undefined;
      return text;
    });
    return created;
  }

  private async folders(): Promise<string[]> {
    try {
      return (await readdir(this.directory, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name);
    } catch {
      return [];
    }
  }

  private async readSkill(path: string, folder: string): Promise<AgentSkillDefinition | undefined> {
    let text: string;
    try {
      text = await readFile(path, 'utf-8');
    } catch {
      return undefined;
    }
    const match = FRONTMATTER.exec(text);
    const fields = this.parseFrontmatter(match?.[1] ?? '');
    const description = fields.get('description');
    const roles = (fields.get('roles') ?? '').split(',').map(role => role.trim()).filter(Boolean);
    if (!description || roles.length === 0) {
      this.logger.warn(`user_skill_ignored: ${path} needs a description and the roles that may read it`);
      return undefined;
    }
    const content = (match?.[2] ?? text).trim();
    return { name: fields.get('name') || folder, description, roles, buildContent: () => content };
  }

  /**
   * The `key: value` lines of the frontmatter. A `>` or `|` value folds the indented lines that follow it; an empty
   * value followed by `- item` lines, or a `[a, b]` value, is a list, read as comma-separated.
   */
  private parseFrontmatter(frontmatter: string): Map<string, string> {
    const fields = new Map<string, string>();
    let block: { key: string; separator: string; lines: string[] } | undefined;
    const close = () => {
      if (block) {
        fields.set(block.key, block.lines.join(block.separator).trim());
        block = undefined;
      }
    };
    for (const line of frontmatter.split(/\r?\n/)) {
      const item = /^\s*-\s+(.*)$/.exec(line);
      if (block?.separator === ',' && item) {
        block.lines.push(this.unquote(item[1]!));
        continue;
      }
      if (block?.separator === ' ' && /^\s+\S/.test(line)) {
        block.lines.push(line.trim());
        continue;
      }
      close();
      const field = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
      if (!field) {
        continue;
      }
      const [, key, value] = field;
      if (value === '>' || value === '|') {
        block = { key: key!, separator: ' ', lines: [] };
      } else if (value === '') {
        block = { key: key!, separator: ',', lines: [] };
      } else {
        const list = /^\[(.*)\]$/.exec(value!);
        fields.set(key!, list ? list[1]!.split(',').map(entry => this.unquote(entry)).join(',') : this.unquote(value!));
      }
    }
    close();
    return fields;
  }

  private unquote(value: string): string {
    return value.trim().replace(/^["']|["']$/g, '').trim();
  }
}
