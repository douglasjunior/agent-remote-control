import { conversationSummarySchema, type ConversationSummary } from '@agent-remote-control/protocol/conversation';
import { conversationEntrySchema, type ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';

import { DataDirectoryService } from '../../paths/services/data-directory.service.js';
import { ILockedFilesPort, type LockedFile } from '../../storage/ports/locked-files.port.js';
import type { IConversationStorePort } from '../ports/conversation-store.port.js';


const DEFAULT_TITLE = 'New conversation';
const WRITE_DEBOUNCE_MS = 1_000;
const CONVERSATIONS_KEY = 'conversations';

type Summaries = ReadonlyMap<string, ConversationSummary>;
type SummaryChange = { readonly id: string; readonly change: (current: ConversationSummary | undefined) => ConversationSummary | undefined };

/**
 * `DATA_DIR/web/conversations.json` and `DATA_DIR/web/history/<id>.json`. A history is rewritten whole and changes
 * many times a second while an agent works, so changes wait in memory and each file is written at most once per
 * debounce interval. A write applies the waiting changes to the file as it is on disk, under its lock, and every
 * waiting change sets a value, so applying one again after its write leaves the same result.
 */
@Injectable()
export class JsonConversationStoreAdapter implements IConversationStorePort, OnModuleDestroy {
  private readonly logger = new Logger(JsonConversationStoreAdapter.name);
  private readonly webDirectory: string;
  private readonly index: LockedFile<Summaries>;
  private readonly histories = new Map<string, LockedFile<readonly ConversationEntry[]>>();
  private readonly positions = new WeakMap<readonly ConversationEntry[], ReadonlyMap<string, number>>();
  private readonly pendingSummaries: SummaryChange[] = [];
  /** By conversation, the latest version of each entry not yet written, in the order the entries first came. */
  private readonly pendingEntries = new Map<string, Map<string, ConversationEntry>>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(dataDirectoryService: DataDirectoryService, @Inject(ILockedFilesPort) private readonly files: ILockedFilesPort) {
    this.webDirectory = join(dataDirectoryService.resolve(), 'web');
    const path = join(this.webDirectory, 'conversations.json');
    this.index = files.json<Summaries>(path, {
      parse: content => new Map((this.validate(path, content, z.array(conversationSummarySchema)) ?? []).map(summary => [summary.id, summary])),
      empty: new Map(),
      serialize: summaries => [...summaries.values()],
    });
  }

  async list(): Promise<readonly ConversationSummary[]> {
    const all = [...(await this.summaries()).values()];
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async create(): Promise<ConversationSummary> {
    const now = new Date().toISOString();
    const summary: ConversationSummary = { id: `web-${randomUUID()}`, title: DEFAULT_TITLE, createdAt: now, updatedAt: now };
    this.pendingSummaries.push({ id: summary.id, change: () => summary });
    this.scheduleWrite(CONVERSATIONS_KEY);
    return summary;
  }

  rename(id: string, title: string): Promise<ConversationSummary> {
    return this.update(id, current => ({ ...current, title }));
  }

  archive(id: string, archived: boolean): Promise<ConversationSummary> {
    const archivedAt = new Date().toISOString();
    return this.update(id, ({ archivedAt: _archivedAt, ...current }) => (archived ? { ...current, archivedAt } : current));
  }

  touch(id: string): Promise<ConversationSummary> {
    const updatedAt = new Date().toISOString();
    return this.update(id, current => ({ ...current, updatedAt }));
  }

  async exists(id: string): Promise<boolean> {
    return (await this.summaries()).has(id);
  }

  async history(id: string): Promise<readonly ConversationEntry[]> {
    const stored = await this.storedHistory(id);
    const pending = this.pendingEntries.get(id);
    return pending ? this.applyEntries(stored, pending) : [...stored];
  }

  async upsertEntry(id: string, entry: ConversationEntry): Promise<number> {
    const stored = await this.storedHistory(id);
    const pending = this.pendingEntries.get(id) ?? new Map<string, ConversationEntry>();
    pending.set(entry.id, entry);
    this.pendingEntries.set(id, pending);
    this.scheduleWrite(id);
    const position = this.positionsOf(stored).get(entry.id);
    if (position !== undefined) {
      return position;
    }
    let appended = stored.length;
    for (const entryId of pending.keys()) {
      if (entryId === entry.id) {
        break;
      }
      if (!this.positionsOf(stored).has(entryId)) {
        appended += 1;
      }
    }
    return appended;
  }

  async flush(id: string): Promise<void> {
    await this.flushKey(id);
    await this.flushKey(CONVERSATIONS_KEY);
  }

  async onModuleDestroy(): Promise<void> {
    const keys = [...this.pendingEntries.keys(), ...(this.pendingSummaries.length > 0 ? [CONVERSATIONS_KEY] : [])];
    await Promise.all(keys.map(key => this.flushKey(key)));
  }

  private async update(id: string, change: (current: ConversationSummary) => ConversationSummary): Promise<ConversationSummary> {
    const current = (await this.summaries()).get(id);
    if (!current) {
      throw new Error(`Unknown conversation: ${id}`);
    }
    this.pendingSummaries.push({ id, change: summary => summary && change(summary) });
    this.scheduleWrite(CONVERSATIONS_KEY);
    return change(current);
  }

  private async summaries(): Promise<Summaries> {
    return this.applySummaries(await this.index.read(), this.pendingSummaries);
  }

  private applySummaries(stored: Summaries, changes: readonly SummaryChange[]): Summaries {
    if (changes.length === 0) {
      return stored;
    }
    const summaries = new Map(stored);
    for (const { id, change } of changes) {
      const summary = change(summaries.get(id));
      if (summary) {
        summaries.set(id, summary);
      }
    }
    return summaries;
  }

  /** The id is looked up among the known conversations before it reaches a file path. */
  private async storedHistory(id: string): Promise<readonly ConversationEntry[]> {
    if (!(await this.exists(id))) {
      throw new Error(`Unknown conversation: ${id}`);
    }
    return this.historyFile(id).read();
  }

  private historyFile(id: string): LockedFile<readonly ConversationEntry[]> {
    let file = this.histories.get(id);
    if (!file) {
      const path = join(this.webDirectory, 'history', `${id}.json`);
      file = this.files.json<readonly ConversationEntry[]>(path, {
        parse: content => this.validate(path, content, z.array(conversationEntrySchema)) ?? [],
        empty: [],
      });
      this.histories.set(id, file);
    }
    return file;
  }

  private applyEntries(stored: readonly ConversationEntry[], pending: ReadonlyMap<string, ConversationEntry>): ConversationEntry[] {
    const entries = [...stored];
    const positions = this.positionsOf(stored);
    for (const entry of pending.values()) {
      const position = positions.get(entry.id);
      if (position === undefined) {
        entries.push(entry);
      } else {
        entries[position] = entry;
      }
    }
    return entries;
  }

  private positionsOf(entries: readonly ConversationEntry[]): ReadonlyMap<string, number> {
    let positions = this.positions.get(entries);
    if (!positions) {
      positions = new Map(entries.map((entry, position) => [entry.id, position]));
      this.positions.set(entries, positions);
    }
    return positions;
  }

  private validate<T>(path: string, content: unknown, schema: z.ZodType<T>): T | null {
    const parsed = schema.safeParse(content);
    if (!parsed.success) {
      this.logger.warn(`conversation_store_invalid_file: ${path}`);
      return null;
    }
    return parsed.data;
  }

  private scheduleWrite(key: string): void {
    if (this.timers.has(key)) {
      return;
    }
    const timer = setTimeout(() => void this.flushKey(key), WRITE_DEBOUNCE_MS);
    timer.unref();
    this.timers.set(key, timer);
  }

  /**
   * Writes what the key has waiting. Changes wait until a write of them succeeds, so a flush during a write writes
   * them again after it, and a failed write leaves them for the next flush.
   */
  private async flushKey(key: string): Promise<void> {
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    const waiting = key === CONVERSATIONS_KEY ? this.pendingSummaries.length > 0 : this.pendingEntries.has(key);
    if (!waiting) {
      return;
    }
    try {
      await this.writeKey(key);
    } catch (error) {
      this.logger.error(`conversation_store_write_failed: ${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async writeKey(key: string): Promise<void> {
    if (key === CONVERSATIONS_KEY) {
      let written = 0;
      await this.index.update((stored) => {
        written = this.pendingSummaries.length;
        return written > 0 ? this.applySummaries(stored, this.pendingSummaries) : undefined;
      });
      this.pendingSummaries.splice(0, written);
      return;
    }
    const snapshot: { pending?: Map<string, ConversationEntry>; written?: ReadonlyMap<string, ConversationEntry> } = {};
    await this.historyFile(key).update((stored) => {
      snapshot.pending = this.pendingEntries.get(key);
      snapshot.written = snapshot.pending && new Map(snapshot.pending);
      return snapshot.written && this.applyEntries(stored, snapshot.written);
    });
    const { pending, written } = snapshot;
    if (!pending || !written) {
      return;
    }
    for (const [entryId, entry] of written) {
      if (pending.get(entryId) === entry) {
        pending.delete(entryId);
      }
    }
    if (pending.size === 0 && this.pendingEntries.get(key) === pending) {
      this.pendingEntries.delete(key);
    }
  }
}
