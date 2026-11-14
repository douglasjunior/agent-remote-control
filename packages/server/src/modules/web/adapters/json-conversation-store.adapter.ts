import { conversationSummarySchema, type ConversationSummary } from '@agent-remote-control/protocol/conversation';
import { conversationEntrySchema, type ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

import { DataDirectoryService } from '../../paths/services/data-directory.service.js';
import type { IConversationStorePort } from '../ports/conversation-store.port.js';


const DEFAULT_TITLE = 'New conversation';
const WRITE_DEBOUNCE_MS = 1_000;
const CONVERSATIONS_KEY = 'conversations';

@Injectable()
export class JsonConversationStoreAdapter implements IConversationStorePort, OnModuleDestroy {
  private readonly logger = new Logger(JsonConversationStoreAdapter.name);
  private readonly webDirectory: string;
  private conversations: Promise<Map<string, ConversationSummary>> | null = null;
  private readonly histories = new Map<string, Promise<ConversationEntry[]>>();
  private readonly pendingWrites = new Map<string, NodeJS.Timeout>();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(dataDirectoryService: DataDirectoryService) {
    this.webDirectory = join(dataDirectoryService.resolve(), 'web');
  }

  async list(): Promise<readonly ConversationSummary[]> {
    const all = [...(await this.loadConversations()).values()];
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async create(): Promise<ConversationSummary> {
    const now = new Date().toISOString();
    const summary: ConversationSummary = { id: `web-${randomUUID()}`, title: DEFAULT_TITLE, createdAt: now, updatedAt: now };
    (await this.loadConversations()).set(summary.id, summary);
    this.histories.set(summary.id, Promise.resolve([]));
    this.scheduleWrite(CONVERSATIONS_KEY);
    return summary;
  }

  rename(id: string, title: string): Promise<ConversationSummary> {
    return this.update(id, current => ({ ...current, title }));
  }

  archive(id: string, archived: boolean): Promise<ConversationSummary> {
    return this.update(id, ({ archivedAt: _archivedAt, ...current }) => (archived ? { ...current, archivedAt: new Date().toISOString() } : current));
  }

  touch(id: string): Promise<ConversationSummary> {
    return this.update(id, current => ({ ...current, updatedAt: new Date().toISOString() }));
  }

  async exists(id: string): Promise<boolean> {
    return (await this.loadConversations()).has(id);
  }

  async history(id: string): Promise<readonly ConversationEntry[]> {
    return [...await this.loadHistory(id)];
  }

  async upsertEntry(id: string, entry: ConversationEntry): Promise<void> {
    const entries = await this.loadHistory(id);
    const position = entries.findIndex(existing => existing.id === entry.id);
    if (position === -1) {
      entries.push(entry);
    } else {
      entries[position] = entry;
    }
    this.scheduleWrite(id);
  }

  async flush(id: string): Promise<void> {
    await this.flushKey(id);
    await this.flushKey(CONVERSATIONS_KEY);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.pendingWrites.keys()].map(key => this.flushKey(key)));
    await this.writeChain;
  }

  private async update(id: string, change: (current: ConversationSummary) => ConversationSummary): Promise<ConversationSummary> {
    const conversations = await this.loadConversations();
    const current = conversations.get(id);
    if (!current) {
      throw new Error(`Unknown conversation: ${id}`);
    }
    const updated = change(current);
    conversations.set(id, updated);
    this.scheduleWrite(CONVERSATIONS_KEY);
    return updated;
  }

  private loadConversations(): Promise<Map<string, ConversationSummary>> {
    this.conversations ??= this.readConversations();
    return this.conversations;
  }

  /** The id is looked up among the known conversations before it reaches a file path. */
  private async loadHistory(id: string): Promise<ConversationEntry[]> {
    if (!(await this.exists(id))) {
      throw new Error(`Unknown conversation: ${id}`);
    }
    let history = this.histories.get(id);
    if (!history) {
      history = this.readHistory(id);
      this.histories.set(id, history);
    }
    return history;
  }

  private async readConversations(): Promise<Map<string, ConversationSummary>> {
    const parsed = await this.readJson(join(this.webDirectory, 'conversations.json'), z.array(conversationSummarySchema));
    return new Map((parsed ?? []).map(summary => [summary.id, summary]));
  }

  private async readHistory(id: string): Promise<ConversationEntry[]> {
    return await this.readJson(this.historyPath(id), z.array(conversationEntrySchema)) ?? [];
  }

  private async readJson<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
    let content: unknown;
    try {
      content = JSON.parse(await readFile(path, 'utf-8'));
    } catch {
      return null;
    }
    const parsed = schema.safeParse(content);
    if (!parsed.success) {
      this.logger.warn(`conversation_store_invalid_file: ${path}`);
      return null;
    }
    return parsed.data;
  }

  private historyPath(id: string): string {
    return join(this.webDirectory, 'history', `${id}.json`);
  }

  private scheduleWrite(key: string): void {
    if (this.pendingWrites.has(key)) {
      return;
    }
    const timer = setTimeout(() => void this.flushKey(key), WRITE_DEBOUNCE_MS);
    timer.unref();
    this.pendingWrites.set(key, timer);
  }

  private flushKey(key: string): Promise<void> {
    const timer = this.pendingWrites.get(key);
    if (!timer) {
      return this.writeChain;
    }
    clearTimeout(timer);
    this.pendingWrites.delete(key);
    this.writeChain = this.writeChain
      .then(() => this.writeKey(key))
      .catch((error: unknown) => {
        this.logger.error(`conversation_store_write_failed: ${key}: ${error instanceof Error ? error.message : String(error)}`);
      });
    return this.writeChain;
  }

  private async writeKey(key: string): Promise<void> {
    if (key === CONVERSATIONS_KEY) {
      const summaries = [...(await this.loadConversations()).values()];
      await this.writeAtomically(join(this.webDirectory, 'conversations.json'), summaries);
      return;
    }
    await this.writeAtomically(this.historyPath(key), await this.loadHistory(key));
  }

  private async writeAtomically(path: string, value: unknown): Promise<void> {
    await mkdir(join(path, '..'), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(value, null, 2), 'utf-8');
    await rename(temporary, path);
  }
}
