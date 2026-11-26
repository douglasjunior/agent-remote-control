import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';


/** The statements a transaction runs, each executed at once on the database connection. */
export type SqliteStatements = {
  get<T>(sql: string, ...params: unknown[]): T | undefined;
  all<T>(sql: string, ...params: unknown[]): T[];
  /** Runs a statement that returns no rows and gives how many rows it changed. */
  run(sql: string, ...params: unknown[]): number;
};

type Statement = {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number };
};

type Transaction<T> = { immediate(): T };

/** The part of better-sqlite3's `Database` this service uses; TypeORM types its connection as `any`. */
type BetterSqlite3Database = {
  prepare(sql: string): Statement;
  transaction<T>(work: () => T): Transaction<T>;
};

/**
 * Runs a read-change-write on the database as one transaction. `work` is synchronous: better-sqlite3 runs every
 * statement on the spot, so nothing else of this process reaches the shared connection until `work` returns, and the
 * transaction begins `IMMEDIATE`, taking SQLite's write lock before the first read, so another process waits for it
 * and cannot write between that read and the write.
 */
@Injectable()
export class SqliteTransactionService {
  private readonly statements = new Map<string, Statement>();
  private readonly handle: SqliteStatements = {
    get: <T>(sql: string, ...params: unknown[]) => this.prepare(sql).get(...params) as T | undefined,
    all: <T>(sql: string, ...params: unknown[]) => this.prepare(sql).all(...params) as T[],
    run: (sql: string, ...params: unknown[]) => this.prepare(sql).run(...params).changes,
  };

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Commits what `work` wrote and returns its result, or rolls everything back and rethrows when it throws. A `work`
   * that returns a promise is refused before it commits anything.
   */
  run<T>(work: (statements: SqliteStatements) => T): T {
    return this.connection().transaction(() => work(this.handle)).immediate();
  }

  private prepare(sql: string): Statement {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.connection().prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  private connection(): BetterSqlite3Database {
    return (this.dataSource.driver as unknown as { databaseConnection: BetterSqlite3Database }).databaseConnection;
  }
}
