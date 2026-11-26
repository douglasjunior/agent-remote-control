import { Logger } from '@nestjs/common';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';

import { AgentRegistryService } from '../../agent-definitions/services/agent-registry.service.js';
import { LegacyJsonFilesService } from '../../database/services/legacy-json-files.service.js';
import { SqliteTransactionService } from '../../database/services/sqlite-transaction.service.js';
import { createInMemoryDataSource } from '../../database/testing/in-memory-data-source.js';
import { dataDirectoryAt } from '../../paths/testing/fixed-directories.js';
import { createNodeLockedFiles } from '../../storage/testing/node-locked-files.js';
import { StubFileLock } from '../../storage/testing/stub-file-lock.js';
import type { AgentProfileSettings } from '../models/agent-settings.model.js';

import { JsonAgentSettingsImporterAdapter } from './json-agent-settings-importer.adapter.js';
import { SqliteAgentSettingsStoreAdapter } from './sqlite-agent-settings-store.adapter.js';


class ExtendedRegistry extends AgentRegistryService {
  override listRoles(): string[] {
    return [...super.listRoles(), 'DESIGNER'];
  }
}

const registry = new AgentRegistryService();

const CLAUDE: AgentProfileSettings = {
  agentId: 'claude',
  agentName: 'Claude Code',
  modelId: 'm1',
  modelName: 'Model 1',
  effortId: 'high',
  effortName: 'High',
};

const BARE: AgentProfileSettings = { agentId: 'claude', agentName: 'claude', modelId: null, modelName: null, effortId: null, effortName: null };

describe('JsonAgentSettingsImporterAdapter', () => {
  let dataDir: string;
  let dataSource: DataSource;
  const seed = (content: unknown) => writeFileSync(join(dataDir, 'agent-settings.json'), typeof content === 'string' ? content : JSON.stringify(content));
  const importAll = async (agentRegistry = registry) => {
    const lock = new StubFileLock();
    const importer = new JsonAgentSettingsImporterAdapter(new LegacyJsonFilesService(dataDirectoryAt(dataDir), lock, createNodeLockedFiles(lock)), agentRegistry);
    const legacy = await importer.read();
    await dataSource.transaction(manager => legacy.write(manager));
    return { importer, legacy };
  };
  const store = () => new SqliteAgentSettingsStoreAdapter(new SqliteTransactionService(dataSource));

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'agent-settings-importer-'));
    dataSource = await createInMemoryDataSource();
  });

  afterEach(async () => {
    rs.restoreAllMocks();
    await dataSource.destroy();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('should import the profiles of each conversation', async () => {
    seed({
      'conv-1': { profiles: { CEO: CLAUDE, DEVELOPER: { agentId: 'agy' } }, updatedAt: '2026-01-01T00:00:00.000Z' },
      'conv-2': { profiles: { QA: CLAUDE }, updatedAt: '2026-02-01T00:00:00.000Z' },
    });

    const { importer, legacy } = await importAll();

    expect(importer.name).toBe('agent-settings');
    expect(legacy).toMatchObject({ files: ['agent-settings.json'], counts: { conversations: 2 } });
    await expect(store().load('conv-1')).resolves.toEqual({
      profiles: { CEO: CLAUDE, DEVELOPER: { ...BARE, agentId: 'agy', agentName: 'agy' } },
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await expect(store().loadMostRecent()).resolves.toEqual({ profiles: { QA: CLAUDE }, updatedAt: '2026-02-01T00:00:00.000Z' });
  });

  it('should give every role the profile of an entry of the earliest format', async () => {
    seed({ conv: { ...CLAUDE, updatedAt: '2026-01-01T00:00:00.000Z' }, bare: { agentId: 'claude', modelId: 7 } });

    await importAll(new ExtendedRegistry());

    const loaded = await store().load('conv');
    expect(Object.keys(loaded!.profiles).sort()).toEqual([...registry.listRoles(), 'DESIGNER'].sort());
    expect(loaded!.profiles.DESIGNER).toEqual(CLAUDE);
    await expect(store().load('bare')).resolves.toMatchObject({ profiles: { CEO: BARE }, updatedAt: '' });
  });

  it('should drop profiles without an agent and entries left without profiles', async () => {
    seed({
      conv: { profiles: { CEO: { agentId: 'claude' }, DEVELOPER: { modelId: 'm1' }, GIT_OPS: null } },
      empty: { profiles: {} },
      noProfiles: { profiles: 'x' },
      invalid: { profiles: { CEO: { modelId: 'm1' } } },
      missingAgent: { modelId: 'm1' },
      nullEntry: null,
      text: 'claude',
    });

    const { legacy } = await importAll();

    expect(legacy.counts).toEqual({ conversations: 1 });
    await expect(store().load('conv')).resolves.toEqual({ profiles: { CEO: BARE }, updatedAt: '' });
    expect(await dataSource.query('SELECT "conversation_id" FROM "agent_settings"')).toEqual([{ conversation_id: 'conv' }]);
  });

  it('should keep the settings the database already holds', async () => {
    await store().update('conv', () => ({ profiles: { CEO: { ...CLAUDE, agentId: 'codex' } }, updatedAt: 'x' }));
    seed({ conv: { profiles: { CEO: CLAUDE, QA: CLAUDE } } });

    await importAll();

    await expect(store().load('conv')).resolves.toEqual({ profiles: { CEO: { ...CLAUDE, agentId: 'codex' } }, updatedAt: 'x' });
  });

  it('should import more conversations than one statement binds', async () => {
    seed(Object.fromEntries(Array.from({ length: 600 }, (_, index) => [`conv-${index}`, { profiles: { CEO: CLAUDE } }])));

    await importAll();

    expect(await dataSource.query('SELECT COUNT(*) AS "count" FROM "agent_profile"')).toEqual([{ count: 600 }]);
  });

  it('should import nothing from a missing, null or corrupt file', async () => {
    rs.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    expect((await importAll()).legacy).toMatchObject({ files: [], counts: { conversations: 0 } });
    seed('null');
    expect((await importAll()).legacy).toMatchObject({ files: ['agent-settings.json'], counts: { conversations: 0 } });
    seed('{broken');
    expect((await importAll()).legacy).toMatchObject({ files: [], counts: { conversations: 0 } });
    seed('[1]');
    expect((await importAll()).legacy).toMatchObject({ files: [], counts: { conversations: 0 } });
    await expect(store().loadMostRecent()).resolves.toBeNull();
  });
});
