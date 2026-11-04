import { MAX_MENTION_RESULTS } from '@agent-remote-control/protocol/limits';
import fuzzysort from 'fuzzysort';

import type { WorkspaceEntry, WorkspaceFileMatch } from '../models/workspace-file-match.model.js';


/** Entries scored before the event loop is released, so a query over a large tree does not block the server. */
const SLICE_SIZE = 5_000;

type Scored = {
  readonly entry: WorkspaceEntry;
  readonly score: number;
  readonly matches: readonly number[];
};

/**
 * Index of the entries delivered by the walk and the fuzzy query over it. Any subsequence match counts
 * (`ficomp` finds `src/file/component.tsx`, `site/comp` finds `site/app/components`), case-insensitively,
 * and the result cap bounds the cost.
 *
 * A query is scored in slices under a generation token: the next slice checks the token first, so
 * the results of a query that was replaced never get published.
 */
export class FileSearchIndex {
  /** Prepared once, when the entry arrives, so each keystroke only pays for the match. */
  private readonly prepared: Fuzzysort.Prepared[] = [];
  private readonly entries = new Map<string, WorkspaceEntry>();
  private query = '';
  private results: readonly Scored[] = [];
  private generation = 0;
  private isSlicing = false;
  private isStopped = false;

  constructor(private readonly onResults: (matches: readonly WorkspaceFileMatch[]) => void) {}

  addEntries(entries: readonly WorkspaceEntry[]): void {
    if (this.isStopped) {
      return;
    }
    const batch = entries.map(entry => fuzzysort.prepare(entry.path));
    this.prepared.push(...batch);
    entries.forEach(entry => this.entries.set(entry.path, entry));

    // The running generation reads the index on every slice and reaches the batch by itself.
    if (this.isSlicing) {
      return;
    }
    if (this.query === '') {
      const roots = entries.filter(entry => entry.depth === 0);
      if (roots.length > 0) {
        this.publish(this.sortRoot([...this.results, ...roots.map(entry => this.unscored(entry))]));
      }
      return;
    }
    const scored = this.score(this.query, batch);
    if (scored.length > 0) {
      this.publish(this.rank([...this.results, ...scored]));
    }
  }

  setQuery(query: string): void {
    if (this.isStopped) {
      return;
    }
    this.query = query;
    this.generation += 1;
    this.isSlicing = false;

    if (query === '') {
      this.publish(this.sortRoot([...this.entries.values()].filter(entry => entry.depth === 0).map(entry => this.unscored(entry))));
      return;
    }
    this.runSlices(query, this.generation);
  }

  stop(): void {
    this.isStopped = true;
    this.generation += 1;
    this.isSlicing = false;
  }

  private runSlices(query: string, generation: number): void {
    const collected: Scored[] = [];
    let offset = 0;

    const step = () => {
      if (generation !== this.generation) {
        return;
      }
      collected.push(...this.score(query, this.prepared.slice(offset, offset + SLICE_SIZE)));
      offset += SLICE_SIZE;
      if (offset < this.prepared.length) {
        setImmediate(step);
        return;
      }
      this.isSlicing = false;
      this.publish(this.rank(collected));
    };

    this.isSlicing = true;
    setImmediate(step);
  }

  private score(query: string, targets: readonly Fuzzysort.Prepared[]): Scored[] {
    return fuzzysort
      .go(query, targets, { limit: MAX_MENTION_RESULTS, threshold: 0 })
      .flatMap((result) => {
        const entry = this.entries.get(result.target);
        return entry ? [{ entry, score: result.score, matches: result.indexes }] : [];
      });
  }

  /** Without a query the list is the base directory: folders first, each group alphabetical. */
  private sortRoot(results: readonly Scored[]): Scored[] {
    return [...results].sort((first, second) => {
      if (first.entry.kind !== second.entry.kind) {
        return first.entry.kind === 'directory' ? -1 : 1;
      }
      return first.entry.path.localeCompare(second.entry.path, undefined, { sensitivity: 'base' });
    });
  }

  private rank(results: readonly Scored[]): Scored[] {
    return [...results].sort((first, second) => second.score - first.score).slice(0, MAX_MENTION_RESULTS);
  }

  private unscored(entry: WorkspaceEntry): Scored {
    return { entry, score: 0, matches: [] };
  }

  private publish(results: readonly Scored[]): void {
    this.results = results;
    this.onResults(results.map(({ entry, matches }) => ({
      path: entry.kind === 'directory' ? `${entry.path}/` : entry.path,
      kind: entry.kind,
      matches,
    })));
  }
}
