import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';

import { createInMemoryDataSource } from '../testing/in-memory-data-source.js';

import { type SqliteStatements, SqliteTransactionService } from './sqlite-transaction.service.js';


const COUNTER = 'SELECT "value" FROM "counter" WHERE "id" = 1';

function increment(statements: SqliteStatements): number {
  const value = statements.get<{ value: number }>(COUNTER)!.value + 1;
  statements.run('UPDATE "counter" SET "value" = ? WHERE "id" = 1', value);
  return value;
}

describe('SqliteTransactionService', () => {
  let dataSource: DataSource;
  let transactions: SqliteTransactionService;
  const counter = async () => (await dataSource.query(COUNTER))[0].value;

  beforeEach(async () => {
    dataSource = await createInMemoryDataSource();
    await dataSource.query('CREATE TABLE "counter" ("id" integer PRIMARY KEY, "value" integer NOT NULL)');
    await dataSource.query('INSERT INTO "counter" VALUES (1, 0)');
    transactions = new SqliteTransactionService(dataSource);
  });

  afterEach(async () => {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  });

  it('should commit what the work writes and return its result', async () => {
    expect(transactions.run(increment)).toBe(1);

    expect(await counter()).toBe(1);
    expect(transactions.run(statements => statements.all('SELECT "id" FROM "counter"'))).toEqual([{ id: 1 }]);
  });

  it('should give how many rows a statement changed', () => {
    expect(transactions.run(statements => statements.run('UPDATE "counter" SET "value" = 5'))).toBe(1);
    expect(transactions.run(statements => statements.run('DELETE FROM "counter" WHERE "id" = 2'))).toBe(0);
  });

  it('should roll every statement back and rethrow when the work throws', async () => {
    expect(() => transactions.run((statements) => {
      increment(statements);
      throw new Error('disk full');
    })).toThrow('disk full');

    expect(await counter()).toBe(0);
  });

  it('should refuse a work that returns a promise without committing it', async () => {
    expect(() => transactions.run(async statements => increment(statements))).toThrow('cannot return a promise');

    expect(await counter()).toBe(0);
  });

  it('should keep both writes of two updates started together', async () => {
    const update = async () => {
      await Promise.resolve();
      return transactions.run(increment);
    };

    expect((await Promise.all([update(), update()])).sort()).toEqual([1, 2]);
    expect(await counter()).toBe(2);
  });

  it('should run a query issued during the work only after the work commits, losing neither write', async () => {
    let concurrent!: Promise<unknown>;

    transactions.run((statements) => {
      const read = statements.get<{ value: number }>(COUNTER)!.value;
      concurrent = dataSource.query('UPDATE "counter" SET "value" = "value" + 10');
      statements.run('UPDATE "counter" SET "value" = ? WHERE "id" = 1', read + 1);
    });
    await concurrent;

    expect(await counter()).toBe(11);
  });

  describe('across processes', () => {
    let dataDir: string;
    let other: DataSource;

    beforeEach(async () => {
      await dataSource.destroy();
      dataDir = mkdtempSync(join(tmpdir(), 'sqlite-transaction-'));
      const database = join(dataDir, 'arc.sqlite');
      dataSource = await new DataSource({ type: 'better-sqlite3', database, enableWAL: true }).initialize();
      await dataSource.query('CREATE TABLE "counter" ("id" integer PRIMARY KEY, "value" integer NOT NULL)');
      await dataSource.query('INSERT INTO "counter" VALUES (1, 0)');
      transactions = new SqliteTransactionService(dataSource);
      other = await new DataSource({ type: 'better-sqlite3', database, timeout: 0 }).initialize();
    });

    afterEach(async () => {
      await other.destroy();
      await dataSource.destroy();
      rmSync(dataDir, { recursive: true, force: true });
    });

    it('should hold the write lock from the first read, so another connection cannot write in between', async () => {
      transactions.run((statements) => {
        increment(statements);
        expect(() => new SqliteTransactionService(other).run(increment)).toThrow('database is locked');
      });

      expect(transactions.run(increment)).toBe(2);
      expect(new SqliteTransactionService(other).run(increment)).toBe(3);
    });
  });
});
