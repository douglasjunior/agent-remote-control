import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';

import type { InterruptedWork, OpenWork } from '../models/open-work.model.js';
import { IOpenWorkStorePort } from '../ports/open-work-store.port.js';


/**
 * The work in progress of each conversation, on disk. A record loaded at boot belongs to a process that died, so it
 * is interrupted until a turn claims it. Shutting down stops the turns, and what they report on the way out is
 * ignored, or a restart would erase the very records it needs.
 */
@Injectable()
export class OpenWorkService implements OnModuleDestroy {
  private readonly logger = new Logger(OpenWorkService.name);
  private readonly work = new Map<string, Map<string, OpenWork>>();
  private readonly live = new Set<string>();
  private frozen = false;
  private writes: Promise<void> = Promise.resolve();

  constructor(@Inject(IOpenWorkStorePort) private readonly store: IOpenWorkStorePort) {}

  onModuleDestroy(): void {
    this.frozen = true;
  }

  async load(): Promise<void> {
    for (const [conversationId, records] of Object.entries(await this.store.load())) {
      this.work.set(conversationId, new Map(records.map(record => [record.id, record])));
    }
  }

  open(conversationId: string, record: OpenWork): Promise<void> {
    if (this.frozen) {
      return this.writes;
    }
    this.live.add(record.id);
    const records = this.work.get(conversationId) ?? new Map<string, OpenWork>();
    records.set(record.id, record);
    this.work.set(conversationId, records);
    return this.persist();
  }

  update(conversationId: string, id: string, changes: Partial<Pick<OpenWork, 'taskSpec' | 'questions'>>): Promise<void> {
    const records = this.work.get(conversationId);
    const record = records?.get(id);
    if (this.frozen || !records || !record) {
      return this.writes;
    }
    records.set(id, { ...record, ...changes });
    return this.persist();
  }

  close(conversationId: string, id: string): Promise<void> {
    if (this.frozen || !this.work.get(conversationId)?.delete(id)) {
      return this.writes;
    }
    this.live.delete(id);
    return this.persist();
  }

  closeAll(conversationId: string): Promise<void> {
    if (this.frozen || !this.work.has(conversationId)) {
      return this.writes;
    }
    for (const id of this.work.get(conversationId)!.keys()) {
      this.live.delete(id);
    }
    this.work.delete(conversationId);
    return this.persist();
  }

  /** Every record of the conversation that no running turn owns, including those waiting for answers. */
  interrupted(conversationId: string): readonly OpenWork[] {
    return [...this.work.get(conversationId)?.values() ?? []].filter(record => !this.live.has(record.id));
  }

  /** All the conversations with records, for the restore at boot. */
  conversations(): readonly string[] {
    return [...this.work.keys()];
  }

  /**
   * What the user can start again: work that stopped on its own. An agent that asked was already waiting, and answering
   * sets it going. A root agent that delegated resumes on its own when
   * the results of its delegates arrive, so it counts only when no delegate stopped with it.
   */
  continuable(conversationId: string): readonly InterruptedWork[] {
    const ready = this.interrupted(conversationId).filter(record => !record.questions);
    const delegates = this.interrupted(conversationId).filter(record => !record.root);
    const roots = ready.filter(record => record.root).slice(-1);
    return [...ready.filter(record => !record.root), ...(delegates.length > 0 ? [] : roots)]
      .map(({ id, role, roleName, projectName, summary }) => ({ id, role, roleName, projectName, summary }));
  }

  /** Hands work that stopped on its own to the turn that will run it. */
  claimStopped(conversationId: string, id: string): OpenWork | undefined {
    return this.claim(conversationId, id, record => !record.questions);
  }

  /** Hands work that asked the user to the turn that will deliver the answers. */
  claimAsked(conversationId: string, id: string): OpenWork | undefined {
    return this.claim(conversationId, id, record => record.questions !== undefined);
  }

  /** The turn that starts next feeds the root agent, which replaces the round the restart stopped. */
  discardInterruptedRoots(conversationId: string): Promise<void> {
    const roots = this.interrupted(conversationId).filter(record => record.root && !record.questions);
    roots.forEach(record => this.work.get(conversationId)!.delete(record.id));
    return roots.length > 0 && !this.frozen ? this.persist() : this.writes;
  }

  private claim(conversationId: string, id: string, isClaimable: (record: OpenWork) => boolean): OpenWork | undefined {
    const record = this.interrupted(conversationId).find(candidate => candidate.id === id && isClaimable(candidate));
    if (record) {
      this.live.add(id);
    }
    return record;
  }

  private persist(): Promise<void> {
    const snapshot = Object.fromEntries([...this.work].map(([conversationId, records]) => [conversationId, [...records.values()]]));
    this.writes = this.writes
      .then(() => this.store.save(snapshot))
      .catch((error: unknown) => {
        this.logger.error(`open_work_write_failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    return this.writes;
  }
}
