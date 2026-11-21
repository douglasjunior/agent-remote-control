import { Logger } from '@nestjs/common';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';

import { LegacyJsonFilesService } from '../../database/services/legacy-json-files.service.js';
import { SqliteTransactionService } from '../../database/services/sqlite-transaction.service.js';
import { createInMemoryDataSource } from '../../database/testing/in-memory-data-source.js';
import { dataDirectoryAt } from '../../paths/testing/fixed-directories.js';
import { createNodeLockedFiles } from '../../storage/testing/node-locked-files.js';
import { StubFileLock } from '../../storage/testing/stub-file-lock.js';

import { JsonSessionsImporterAdapter } from './json-sessions-importer.adapter.js';
import { SqliteSessionStoreAdapter } from './sqlite-session-store.adapter.js';


const LEGACY_ITEM = { userId: 'user-1', workspacePath: '/w', agentRole: 'CEO', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };

describe('JsonSessionsImporterAdapter', () => {
  let dataDir: string;
  let dataSource: DataSource;
  let lock: StubFileLock;
  const seed = (content: unknown) => writeFileSync(join(dataDir, 'sessions.json'), typeof content === 'string' ? content : JSON.stringify(content));
  const importAll = async () => {
    const importer = new JsonSessionsImporterAdapter(new LegacyJsonFilesService(dataDirectoryAt(dataDir), lock, createNodeLockedFiles(lock)));
    const legacy = await importer.read();
    await dataSource.transaction(manager => legacy.write(manager));
    return { importer, legacy };
  };
  const store = () => new SqliteSessionStoreAdapter(new SqliteTransactionService(dataSource));

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'sessions-importer-'));
    dataSource = await createInMemoryDataSource();
    lock = new StubFileLock();
  });

  afterEach(async () => {
    rs.restoreAllMocks();
    await dataSource.destroy();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('should import the sessions of each conversation, under the lock its store wrote it with', async () => {
    seed({
      'conv-1': {
        agentSessions: [
          { role: 'CEO', agentId: 'claude', sessionId: 'ceo', projectName: null, artifactId: null, unanswered: true },
          { role: 'DEVELOPER', agentId: 'claude', sessionId: 'dev-t1', projectName: 'my-app', artifactId: 'T-1', workEndedAt: '2026-01-02T00:00:00.000Z' },
        ],
      },
      'conv-2': { agentSessions: [] },
      'conv-3': {},
    });

    const { importer, legacy } = await importAll();

    expect(importer.name).toBe('sessions');
    expect(legacy).toMatchObject({ files: ['sessions.json'], counts: { conversations: 3, agentSessions: 2 } });
    expect(lock.lockPaths).toEqual([`${join(dataDir, 'sessions.json')}.lock`]);
    await expect(store().findSession('conv-1')).resolves.toEqual({
      conversationId: 'conv-1',
      agentSessions: [
        { role: 'CEO', agentId: 'claude', sessionId: 'ceo', projectName: null, artifactId: null, unanswered: true },
        { role: 'DEVELOPER', agentId: 'claude', sessionId: 'dev-t1', projectName: 'my-app', artifactId: 'T-1', workEndedAt: '2026-01-02T00:00:00.000Z' },
      ],
    });
    await expect(store().findSession('conv-2')).resolves.toEqual({ conversationId: 'conv-2', agentSessions: [] });
    await expect(store().findSession('conv-3')).resolves.toEqual({ conversationId: 'conv-3', agentSessions: [] });
  });

  it('should read the list format, keyed by conversation or by channel and thread, the later item winning', async () => {
    seed([
      { ...LEGACY_ITEM, sessionId: 'a', conversationId: 'conv-1', agentSessions: [] },
      { ...LEGACY_ITEM, sessionId: 'b', conversationId: 'conv-1', agentSessions: [{ role: 'CEO', agentId: 'claude', sessionId: 'acp-2' }] },
      { ...LEGACY_ITEM, sessionId: 'c', channelId: 'ch', threadId: 'th' },
      { ...LEGACY_ITEM, sessionId: 'd', channelId: 'dm' },
      { ...LEGACY_ITEM, sessionId: 'e' },
    ]);

    const { legacy } = await importAll();

    expect(legacy.counts).toEqual({ conversations: 4, agentSessions: 1 });
    await expect(store().findSession('conv-1')).resolves.toEqual({
      conversationId: 'conv-1',
      agentSessions: [{ role: 'CEO', agentId: 'claude', sessionId: 'acp-2', projectName: null, artifactId: null }],
    });
    for (const conversationId of ['ch:th', 'dm', '']) {
      await expect(store().findSession(conversationId)).resolves.toEqual({ conversationId, agentSessions: [] });
    }
  });

  it('should drop agent sessions without an agent and fields of another type', async () => {
    seed({
      'conv-1': {
        agentSessions: [
          { role: 'CEO', sessionId: 'no-agent' },
          { role: 'QA', agentId: 7, sessionId: 'numeric-agent' },
          { role: 'DEVELOPER', agentId: 'claude', sessionId: 'dev', projectName: 'app', workEndedAt: 3, unanswered: false },
        ],
      },
    });

    await importAll();

    await expect(store().findSession('conv-1')).resolves.toEqual({
      conversationId: 'conv-1',
      agentSessions: [{ role: 'DEVELOPER', agentId: 'claude', sessionId: 'dev', projectName: 'app', artifactId: null }],
    });
  });

  it('should keep a conversation the database already holds', async () => {
    await store().updateSession('conv-1', session => session);
    seed({ 'conv-1': { agentSessions: [{ role: 'CEO', agentId: 'claude', sessionId: 'ceo' }] }, 'conv-2': {} });

    await importAll();

    await expect(store().findSession('conv-1')).resolves.toEqual({ conversationId: 'conv-1', agentSessions: [] });
    await expect(store().findSession('conv-2')).resolves.toEqual({ conversationId: 'conv-2', agentSessions: [] });
  });

  it('should import more rows than one statement binds', async () => {
    seed(Object.fromEntries(Array.from({ length: 600 }, (_, index) => [`conv-${index}`, { agentSessions: [{ role: 'CEO', agentId: 'claude', sessionId: `s-${index}` }] }])));

    await importAll();

    expect(await dataSource.query('SELECT COUNT(*) AS "count" FROM "agent_session"')).toEqual([{ count: 600 }]);
  });

  it('should import nothing from a missing or invalid file, leaving an invalid one in place', async () => {
    rs.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    expect((await importAll()).legacy).toMatchObject({ files: [], counts: { conversations: 0, agentSessions: 0 } });
    for (const content of ['{not json', 'null', '{"conv-1": null}']) {
      seed(content);
      expect((await importAll()).legacy).toMatchObject({ files: [], counts: { conversations: 0, agentSessions: 0 } });
    }
    await expect(store().findSession('conv-1')).resolves.toBeNull();
  });
});
