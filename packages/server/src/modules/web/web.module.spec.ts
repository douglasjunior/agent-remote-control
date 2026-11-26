import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTestingModule } from '../../../test/testing-module.js';

import { CombinedClientTransportAdapter } from './adapters/combined-client-transport.adapter.js';
import { SqliteConversationStoreAdapter } from './adapters/sqlite-conversation-store.adapter.js';
import { SqlitePromptHistoryAdapter } from './adapters/sqlite-prompt-history.adapter.js';
import { WebConnectionHandler } from './handlers/web-connection.handler.js';
import { IClientTransportPort } from './ports/client-transport.port.js';
import { IConversationStorePort } from './ports/conversation-store.port.js';
import { IPromptHistoryPort } from './ports/prompt-history.port.js';
import { WebModule } from './web.module.js';


describe('WebModule', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'web-module-'));
    rs.stubEnv('DATA_DIR', dataDir);
  });

  afterEach(() => {
    rs.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('should bind the ports to their adapters and resolve the handler', async () => {
    const module = await createTestingModule({ imports: [WebModule] }).compile();

    expect(module.get(IClientTransportPort)).toBeInstanceOf(CombinedClientTransportAdapter);
    expect(module.get(IConversationStorePort)).toBeInstanceOf(SqliteConversationStoreAdapter);
    expect(module.get(IPromptHistoryPort)).toBeInstanceOf(SqlitePromptHistoryAdapter);
    expect(module.get(WebConnectionHandler)).toBeInstanceOf(WebConnectionHandler);
    await module.close();
  });
});
