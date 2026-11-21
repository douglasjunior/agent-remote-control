import { Logger } from '@nestjs/common';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';

import { DATABASE_ENTITIES, DATABASE_MIGRATIONS } from '../../database/constants/database-schema.constant.js';
import { SqliteTransactionService } from '../../database/services/sqlite-transaction.service.js';
import { createInMemoryDataSource } from '../../database/testing/in-memory-data-source.js';
import type { OpenWork } from '../models/open-work.model.js';
import type { OpenWorkByConversation } from '../ports/open-work-store.port.js';

import { SqliteOpenWorkStoreAdapter } from './sqlite-open-work-store.adapter.js';


const record: OpenWork = { id: 'd', role: 'DEVELOPER', roleName: 'Dev', projectName: null, summary: 'Build', taskSpec: 'Go', cwd: '/w', round: 1, root: false };

const asked: OpenWork = {
  id: 'q',
  role: 'QA',
  roleName: 'QA Engineer',
  projectName: 'shop',
  artifactId: 'T-1',
  summary: 'Test',
  taskSpec: 'Test T-1',
  updates: ['Test the login too.', 'Skip the signup.'],
  cwd: '/w/shop',
  round: 3,
  root: true,
  questions: {
    message: 'Two questions.',
    questions: [{ text: 'Which?', rationale: 'Scope', options: ['A', 'B'], recommendedIndex: 1 }, { text: 'Why?', options: [] }],
    answers: [
      {
        question: { text: 'Which?', options: ['A', 'B'] },
        answer: 'A',
        optionNumber: 1,
        timedOut: true,
        attachments: [{ name: 'shot.png', path: '/u/shot.png', contentType: 'image/png', size: 10, url: '/files/shot.png' }],
      },
    ],
  },
};

const storeOver = (dataSource: DataSource) => new SqliteOpenWorkStoreAdapter(new SqliteTransactionService(dataSource));
const setConversation = (conversationId: string, records: readonly OpenWork[]) => (work: OpenWorkByConversation): OpenWorkByConversation => ({ ...work, [conversationId]: records });

describe('SqliteOpenWorkStoreAdapter', () => {
  let dataSource: DataSource;
  let store: SqliteOpenWorkStoreAdapter;
  const rowIds = async () => ((await dataSource.query('SELECT "rowid" AS "rowId" FROM "open_work" ORDER BY "rowid"')) as { rowId: number }[]).map(row => row.rowId);

  beforeEach(async () => {
    dataSource = await createInMemoryDataSource();
    store = storeOver(dataSource);
  });

  afterEach(async () => {
    rs.restoreAllMocks();
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  });

  it('should load nothing when nothing was stored', async () => {
    await expect(store.load()).resolves.toEqual({});
  });

  it('should read back every field of the records of each conversation, in order', async () => {
    await store.update(() => ({ 'web-1': [asked, record], 'web-2': [record] }));

    await expect(storeOver(dataSource).load()).resolves.toEqual({ 'web-1': [asked, record], 'web-2': [record] });
  });

  it('should hand a change what is stored and rewrite only the conversations it changed', async () => {
    await store.update(() => ({ 'web-1': [record], 'web-2': [record] }));
    const [, untouched] = await rowIds();
    const seen: OpenWorkByConversation[] = [];

    await store.update((work) => {
      seen.push(work);
      const { 'web-1': _closed, ...others } = work;
      return { ...others, 'web-2': [{ ...record }], 'web-3': [asked] };
    });

    expect(seen).toEqual([{ 'web-1': [record], 'web-2': [record] }]);
    await expect(store.load()).resolves.toEqual({ 'web-2': [record], 'web-3': [asked] });
    expect((await rowIds())[0]).toBe(untouched);
  });

  it('should keep the conversations that interleaved updates change', async () => {
    await Promise.all(['web-1', 'web-2', 'web-3'].map(conversationId => store.update(setConversation(conversationId, [record]))));

    expect(Object.keys(await store.load())).toEqual(['web-1', 'web-2', 'web-3']);
  });

  it('should leave out a row that is not a valid record', async () => {
    const warn = rs.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await store.update(() => ({ 'web-1': [record, { ...asked, id: 'broken' }, { ...asked, id: 'wrong' }, { ...asked, id: 'updates' }] }));
    await dataSource.query('UPDATE "open_work" SET "questions" = \'{\' WHERE "id" = \'broken\'');
    await dataSource.query('UPDATE "open_work" SET "questions" = \'{"message": 1}\' WHERE "id" = \'wrong\'');
    await dataSource.query('UPDATE "open_work" SET "updates" = \'[1]\' WHERE "id" = \'updates\'');

    await expect(store.load()).resolves.toEqual({ 'web-1': [record] });
    expect(warn).toHaveBeenCalledWith('open_work_invalid_row: broken of web-1');
    expect(warn).toHaveBeenCalledWith('open_work_invalid_row: wrong of web-1');
    expect(warn).toHaveBeenCalledWith('open_work_invalid_row: updates of web-1');
  });

  it('should roll back a change the database refuses and keep what was stored', async () => {
    await store.update(() => ({ 'web-1': [record] }));

    await expect(store.update(() => ({ 'web-1': [record, record] }))).rejects.toThrow('UNIQUE');

    await expect(store.load()).resolves.toEqual({ 'web-1': [record] });
  });

  describe('with another process on the same file', () => {
    let dataDir: string;
    let other: DataSource;

    beforeEach(async () => {
      await dataSource.destroy();
      dataDir = mkdtempSync(join(tmpdir(), 'sqlite-open-work-'));
      const options = { type: 'better-sqlite3', database: join(dataDir, 'arc.sqlite'), entities: DATABASE_ENTITIES, migrations: DATABASE_MIGRATIONS } as const;
      dataSource = await new DataSource({ ...options, migrationsRun: true }).initialize();
      other = await new DataSource(options).initialize();
      store = storeOver(dataSource);
    });

    afterEach(async () => {
      await other.destroy();
      await dataSource.destroy();
      rmSync(dataDir, { recursive: true, force: true });
    });

    it('should keep the conversations each process changed, interleaved', async () => {
      const otherStore = storeOver(other);

      await Promise.all(['web-1', 'web-2', 'web-3', 'web-4'].map((conversationId, index) =>
        (index % 2 === 0 ? store : otherStore).update(setConversation(conversationId, [record]))));

      expect(Object.keys(await otherStore.load()).sort()).toEqual(['web-1', 'web-2', 'web-3', 'web-4']);
    });
  });
});
