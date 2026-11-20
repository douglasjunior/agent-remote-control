import { artifactDetailSchema } from '@agent-remote-control/protocol/artifact';
import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { SqliteTransactionService, type SqliteStatements } from '../../database/services/sqlite-transaction.service.js';
import { ARTIFACT_ID_PREFIXES } from '../constants/artifact-catalog.constant.js';
import type { ArtifactDependencyEntity } from '../entities/artifact-dependency.entity.js';
import type { ArtifactHistoryChangeEntity } from '../entities/artifact-history-change.entity.js';
import type { ArtifactHistoryEntity } from '../entities/artifact-history.entity.js';
import type { ArtifactPullRequestEntity } from '../entities/artifact-pull-request.entity.js';
import type { ArtifactRefinementEntity } from '../entities/artifact-refinement.entity.js';
import type { ArtifactSectionEntity } from '../entities/artifact-section.entity.js';
import type { ArtifactEntity } from '../entities/artifact.entity.js';
import type { Artifact, ArtifactType } from '../models/artifact.model.js';
import type { ArtifactTransaction, IArtifactStorePort } from '../ports/artifact-store.port.js';
import { toArtifactRows, type ArtifactHistoryRows, type ArtifactRows } from '../utils/artifact-rows.util.js';


const SELECT = {
  artifacts: `SELECT "conversation_id" AS "conversationId", "id", "position", "type", "title", "status", "parent_id" AS "parentId",
    "project_name" AS "projectName", "assignee_role" AS "assigneeRole", "assignee_role_name" AS "assigneeRoleName",
    "assignee_delegation_id" AS "assigneeDelegationId", "assignee_since" AS "assigneeSince", "branch", "created_at" AS "createdAt",
    "updated_at" AS "updatedAt" FROM "artifact"`,
  refinements: 'SELECT "artifact_id" AS "artifactId", "kind", "state" FROM "artifact_refinement"',
  sections: 'SELECT "artifact_id" AS "artifactId", "section", "content" FROM "artifact_section"',
  dependencies: 'SELECT "artifact_id" AS "artifactId", "depends_on_id" AS "dependsOnId" FROM "artifact_dependency"',
  pullRequests: 'SELECT "artifact_id" AS "artifactId", "url", "title", "state", "added_at" AS "addedAt" FROM "artifact_pull_request"',
  history: `SELECT "artifact_id" AS "artifactId", "position", "event_id" AS "eventId", "at", "actor_kind" AS "actorKind",
    "actor_role" AS "actorRole", "actor_role_name" AS "actorRoleName", "actor_channel" AS "actorChannel", "kind", "summary", "text"
    FROM "artifact_history"`,
  changes: `SELECT "artifact_id" AS "artifactId", "event_position" AS "eventPosition", "field", "from_value" AS "fromValue",
    "to_value" AS "toValue" FROM "artifact_history_change"`,
} as const;
const ORDER = {
  artifacts: 'ORDER BY "position"',
  refinements: '',
  sections: '',
  dependencies: 'ORDER BY "artifact_id", "position"',
  pullRequests: 'ORDER BY "artifact_id", "position"',
  history: 'ORDER BY "artifact_id", "position"',
  changes: 'ORDER BY "artifact_id", "event_position", "position"',
} as const;
const SELECT_CONVERSATIONS = 'SELECT DISTINCT "conversation_id" AS "conversationId" FROM "artifact" ORDER BY "conversation_id"';
const SELECT_COUNTERS = 'SELECT "prefix", "value" FROM "artifact_counter" WHERE "conversation_id" = ?';
const UPSERT_COUNTER = `INSERT INTO "artifact_counter" ("conversation_id", "prefix", "value") VALUES (?, ?, ?)
  ON CONFLICT ("conversation_id", "prefix") DO UPDATE SET "value" = excluded."value"`;
const UPSERT_ARTIFACT = `INSERT INTO "artifact" ("conversation_id", "id", "position", "type", "title", "status", "parent_id", "project_name",
    "assignee_role", "assignee_role_name", "assignee_delegation_id", "assignee_since", "branch", "created_at", "updated_at")
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT ("conversation_id", "id") DO UPDATE SET "type" = excluded."type", "title" = excluded."title", "status" = excluded."status",
    "parent_id" = excluded."parent_id", "project_name" = excluded."project_name", "assignee_role" = excluded."assignee_role",
    "assignee_role_name" = excluded."assignee_role_name", "assignee_delegation_id" = excluded."assignee_delegation_id",
    "assignee_since" = excluded."assignee_since", "branch" = excluded."branch", "created_at" = excluded."created_at",
    "updated_at" = excluded."updated_at"`;
const DELETE_ARTIFACT = 'DELETE FROM "artifact" WHERE "conversation_id" = ? AND "id" = ?';
const INSERT_REFINEMENT = 'INSERT INTO "artifact_refinement" ("conversation_id", "artifact_id", "kind", "state") VALUES (?, ?, ?, ?)';
const INSERT_SECTION = 'INSERT INTO "artifact_section" ("conversation_id", "artifact_id", "section", "content") VALUES (?, ?, ?, ?)';
const INSERT_DEPENDENCY = 'INSERT INTO "artifact_dependency" ("conversation_id", "artifact_id", "position", "depends_on_id") VALUES (?, ?, ?, ?)';
const INSERT_PULL_REQUEST = `INSERT INTO "artifact_pull_request" ("conversation_id", "artifact_id", "position", "url", "title", "state", "added_at")
  VALUES (?, ?, ?, ?, ?, ?, ?)`;
const INSERT_HISTORY = `INSERT INTO "artifact_history" ("conversation_id", "artifact_id", "position", "event_id", "at", "actor_kind", "actor_role",
    "actor_role_name", "actor_channel", "kind", "summary", "text") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const INSERT_CHANGE = `INSERT INTO "artifact_history_change" ("conversation_id", "artifact_id", "event_position", "position", "field", "from_value",
    "to_value") VALUES (?, ?, ?, ?, ?, ?, ?)`;
const DELETE_HISTORY_FROM = 'DELETE FROM "artifact_history" WHERE "conversation_id" = ? AND "artifact_id" = ? AND "position" >= ?';
const DELETE_HISTORY_AT = 'DELETE FROM "artifact_history" WHERE "conversation_id" = ? AND "artifact_id" = ? AND "position" = ?';

/** The tables replaced whole when the artifact's list in them changes. */
const LIST_TABLES = {
  refinements: 'artifact_refinement',
  sections: 'artifact_section',
  dependencies: 'artifact_dependency',
  pullRequests: 'artifact_pull_request',
} as const;

type ArtifactRow = ArtifactEntity;
type RefinementRow = Pick<ArtifactRefinementEntity, 'artifactId' | 'kind' | 'state'>;
type SectionRow = Pick<ArtifactSectionEntity, 'artifactId' | 'section' | 'content'>;
type DependencyRow = Pick<ArtifactDependencyEntity, 'artifactId' | 'dependsOnId'>;
type PullRequestRow = Pick<ArtifactPullRequestEntity, 'artifactId' | 'url' | 'title' | 'state' | 'addedAt'>;
type HistoryRow = Omit<ArtifactHistoryEntity, 'conversationId' | 'artifact'>;
type ChangeRow = Pick<ArtifactHistoryChangeEntity, 'artifactId' | 'eventPosition' | 'field' | 'fromValue' | 'toValue'>;

type StoredArtifact = { readonly artifact: Artifact; readonly position: number };

type Board = {
  readonly artifacts: ReadonlyMap<string, StoredArtifact>;
  readonly counters: Readonly<Record<string, number>>;
};

/**
 * Each board in the `artifact` tables, keyed by conversation and artifact id. A transaction reads the board, runs the
 * work on a copy and writes only the rows that differ, all in one SQLite transaction. An artifact whose rows do not
 * make a valid artifact is logged and left out.
 */
@Injectable()
export class SqliteArtifactStoreAdapter implements IArtifactStorePort {
  private readonly logger = new Logger(SqliteArtifactStoreAdapter.name);

  constructor(private readonly dataSource: DataSource, private readonly transactions: SqliteTransactionService) {}

  async conversations(): Promise<readonly string[]> {
    const rows: { conversationId: string }[] = await this.dataSource.query(SELECT_CONVERSATIONS);
    return rows.map(row => row.conversationId);
  }

  async list(conversationId: string): Promise<readonly Artifact[]> {
    return this.transactions.run(statements => [...this.readArtifacts(statements, conversationId).values()].map(stored => stored.artifact));
  }

  async find(conversationId: string, id: string): Promise<Artifact | undefined> {
    return this.transactions.run(statements => this.readArtifacts(statements, conversationId, id).get(id)?.artifact);
  }

  async transaction<T>(conversationId: string, work: (transaction: ArtifactTransaction) => T): Promise<T> {
    return this.transactions.run((statements) => {
      const board = this.readBoard(statements, conversationId);
      const staged = new Map([...board.artifacts].map(([id, stored]) => [id, stored.artifact]));
      const counters = { ...board.counters };
      const result = work({
        find: id => staged.get(id),
        list: () => [...staged.values()],
        allocateId: type => this.allocateId(type, staged, counters),
        save: (artifact) => {
          staged.set(artifact.id, artifact);
        },
        remove: (id) => {
          staged.delete(id);
        },
      });
      this.write(statements, conversationId, board, staged, counters);
      return result;
    });
  }

  private allocateId(type: ArtifactType, artifacts: ReadonlyMap<string, Artifact>, counters: Record<string, number>): string {
    const prefix = ARTIFACT_ID_PREFIXES[type];
    let id: string;
    do {
      counters[prefix] = (counters[prefix] ?? 0) + 1;
      id = `${prefix}-${counters[prefix]}`;
    } while (artifacts.has(id));
    return id;
  }

  private write(statements: SqliteStatements, conversationId: string, board: Board, staged: ReadonlyMap<string, Artifact>, counters: Record<string, number>): void {
    for (const id of board.artifacts.keys()) {
      if (!staged.has(id)) {
        statements.run(DELETE_ARTIFACT, conversationId, id);
      }
    }
    let nextPosition = Math.max(-1, ...[...board.artifacts.values()].map(stored => stored.position)) + 1;
    for (const [id, artifact] of staged) {
      const stored = board.artifacts.get(id);
      if (stored?.artifact === artifact) {
        continue;
      }
      const rows = toArtifactRows(conversationId, artifact, stored?.position ?? nextPosition++);
      this.writeArtifact(statements, rows, stored && toArtifactRows(conversationId, stored.artifact, stored.position));
    }
    for (const [prefix, value] of Object.entries(counters)) {
      if (board.counters[prefix] !== value) {
        statements.run(UPSERT_COUNTER, conversationId, prefix, value);
      }
    }
  }

  /** Writes the rows of `next` that differ from `previous`, the rows of the artifact as stored, if it was. */
  private writeArtifact(statements: SqliteStatements, next: ArtifactRows, previous: ArtifactRows | undefined): void {
    const { conversationId, id } = next.artifact;
    if (!this.same(next.artifact, previous?.artifact)) {
      const row = next.artifact;
      statements.run(
        UPSERT_ARTIFACT,
        conversationId,
        id,
        row.position,
        row.type,
        row.title,
        row.status,
        row.parentId,
        row.projectName,
        row.assigneeRole,
        row.assigneeRoleName,
        row.assigneeDelegationId,
        row.assigneeSince,
        row.branch,
        row.createdAt,
        row.updatedAt,
      );
    }
    for (const [list, table] of Object.entries(LIST_TABLES) as [keyof typeof LIST_TABLES, string][]) {
      if (previous && this.same(next[list], previous[list])) {
        continue;
      }
      if (previous) {
        statements.run(`DELETE FROM "${table}" WHERE "conversation_id" = ? AND "artifact_id" = ?`, conversationId, id);
      }
      this.insertList(statements, next, list);
    }
    next.history.forEach((event, position) => {
      const before = previous?.history[position];
      if (this.same(event, before)) {
        return;
      }
      if (before) {
        statements.run(DELETE_HISTORY_AT, conversationId, id, position);
      }
      this.insertEvent(statements, event);
    });
    if (previous && previous.history.length > next.history.length) {
      statements.run(DELETE_HISTORY_FROM, conversationId, id, next.history.length);
    }
  }

  private insertList(statements: SqliteStatements, rows: ArtifactRows, list: keyof typeof LIST_TABLES): void {
    const owner = [rows.artifact.conversationId, rows.artifact.id];
    switch (list) {
      case 'refinements':
        rows.refinements.forEach(row => statements.run(INSERT_REFINEMENT, ...owner, row.kind, row.state));
        return;
      case 'sections':
        rows.sections.forEach(row => statements.run(INSERT_SECTION, ...owner, row.section, row.content));
        return;
      case 'dependencies':
        rows.dependencies.forEach(row => statements.run(INSERT_DEPENDENCY, ...owner, row.position, row.dependsOnId));
        return;
      case 'pullRequests':
        rows.pullRequests.forEach(row => statements.run(INSERT_PULL_REQUEST, ...owner, row.position, row.url, row.title, row.state, row.addedAt));
    }
  }

  private insertEvent(statements: SqliteStatements, { event, changes }: ArtifactHistoryRows): void {
    statements.run(
      INSERT_HISTORY,
      event.conversationId,
      event.artifactId,
      event.position,
      event.eventId,
      event.at,
      event.actorKind,
      event.actorRole,
      event.actorRoleName,
      event.actorChannel,
      event.kind,
      event.summary,
      event.text,
    );
    for (const change of changes) {
      statements.run(INSERT_CHANGE, change.conversationId, change.artifactId, change.eventPosition, change.position, change.field, change.fromValue, change.toValue);
    }
  }

  private same(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  private readBoard(statements: SqliteStatements, conversationId: string): Board {
    const counters = Object.fromEntries(statements.all<{ prefix: string; value: number }>(SELECT_COUNTERS, conversationId).map(row => [row.prefix, row.value]));
    return { artifacts: this.readArtifacts(statements, conversationId), counters };
  }

  /** The artifacts of the board in its order, or only the one with `id`. */
  private readArtifacts(statements: SqliteStatements, conversationId: string, id?: string): Map<string, StoredArtifact> {
    const select = <T>(query: keyof typeof SELECT): T[] => (id === undefined
      ? statements.all<T>(`${SELECT[query]} WHERE "conversation_id" = ? ${ORDER[query]}`, conversationId)
      : statements.all<T>(`${SELECT[query]} WHERE "conversation_id" = ? AND "${query === 'artifacts' ? 'id' : 'artifact_id'}" = ? ${ORDER[query]}`, conversationId, id));
    const byArtifact = <T extends { artifactId: string }>(rows: readonly T[]) => this.group(rows, row => row.artifactId);
    const refinements = byArtifact(select<RefinementRow>('refinements'));
    const sections = byArtifact(select<SectionRow>('sections'));
    const dependencies = byArtifact(select<DependencyRow>('dependencies'));
    const pullRequests = byArtifact(select<PullRequestRow>('pullRequests'));
    const history = byArtifact(select<HistoryRow>('history'));
    const changes = this.group(select<ChangeRow>('changes'), row => `${row.artifactId}\n${row.eventPosition}`);
    const artifacts = new Map<string, StoredArtifact>();
    for (const row of select<ArtifactRow>('artifacts')) {
      const parsed = artifactDetailSchema.safeParse({
        id: row.id,
        type: row.type,
        title: row.title,
        status: row.status,
        parentId: row.parentId,
        projectName: row.projectName,
        dependsOn: (dependencies.get(row.id) ?? []).map(dependency => dependency.dependsOnId),
        refinement: this.toRefinement(refinements.get(row.id) ?? []),
        assignee: row.assigneeRole === null
          ? null
          : { role: row.assigneeRole, roleName: row.assigneeRoleName, delegationId: row.assigneeDelegationId, since: row.assigneeSince },
        branch: row.branch,
        pullRequests: (pullRequests.get(row.id) ?? []).map(link => ({
          url: link.url,
          ...(link.title !== null && { title: link.title }),
          state: link.state,
          addedAt: link.addedAt,
        })),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        sections: Object.fromEntries((sections.get(row.id) ?? []).map(section => [section.section, section.content])),
        history: (history.get(row.id) ?? []).map(event => this.toEvent(event, changes.get(`${row.id}\n${event.position}`) ?? [])),
      });
      if (parsed.success) {
        artifacts.set(row.id, { artifact: parsed.data, position: row.position });
      } else {
        this.logger.warn(`artifacts_invalid_row: ${row.id} of ${conversationId}`);
      }
    }
    return artifacts;
  }

  private group<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
    const groups = new Map<string, T[]>();
    for (const row of rows) {
      const group = groups.get(key(row));
      if (group) {
        group.push(row);
      } else {
        groups.set(key(row), [row]);
      }
    }
    return groups;
  }

  /** A kind without a row is owed. */
  private toRefinement(rows: readonly RefinementRow[]): Record<string, string> {
    const states = Object.fromEntries(rows.map(row => [row.kind, row.state]));
    return { business: states.business ?? 'pending', technical: states.technical ?? 'pending' };
  }

  private toEvent(event: HistoryRow, changes: readonly ChangeRow[]): unknown {
    return {
      id: event.eventId,
      at: event.at,
      actor: event.actorKind === 'agent'
        ? { kind: 'agent', role: event.actorRole, roleName: event.actorRoleName }
        : event.actorKind === 'user' ? { kind: 'user', channel: event.actorChannel } : { kind: event.actorKind },
      kind: event.kind,
      summary: event.summary,
      ...(changes.length > 0 && {
        changes: changes.map(change => ({
          field: change.field,
          ...(change.fromValue !== null && { from: change.fromValue }),
          ...(change.toValue !== null && { to: change.toValue }),
        })),
      }),
      ...(event.text !== null && { text: event.text }),
    };
  }
}
