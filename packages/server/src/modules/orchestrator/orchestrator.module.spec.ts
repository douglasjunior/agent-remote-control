import { type TestingModule } from '@nestjs/testing';
import { describe, expect, it } from '@rstest/core';

import { useTemporaryDataDir } from '../../../test/temporary-data-dir.js';
import { createTestingModule } from '../../../test/testing-module.js';

import { JsonAgentSettingsStoreAdapter } from './adapters/json-agent-settings-store.adapter.js';
import { JsonSessionStoreAdapter } from './adapters/json-session-store.adapter.js';
import { SqlitePreferencesStoreAdapter } from './adapters/sqlite-preferences-store.adapter.js';
import { OrchestratorModule } from './orchestrator.module.js';
import { IAgentConfigurationPort } from './ports/agent-configuration.port.js';
import { IAgentSettingsStorePort } from './ports/agent-settings-store.port.js';
import { IAgentTurnPort } from './ports/agent-turn.port.js';
import { IPreferencesStorePort } from './ports/preferences-store.port.js';
import { ISessionStorePort } from './ports/session-store.port.js';
import { IUserQuestionPort } from './ports/user-question.port.js';
import { AgentConfigurationService } from './services/agent-configuration.service.js';
import { AgentTurnService } from './services/agent-turn.service.js';
import { UserQuestionService } from './services/user-question.service.js';


describe('OrchestratorModule', () => {
  useTemporaryDataDir();

  it('should compile the module and bind the ports to their implementations', async () => {
    const module: TestingModule = await createTestingModule({
      imports: [OrchestratorModule],
    }).compile();

    expect(module.get(ISessionStorePort)).toBeInstanceOf(JsonSessionStoreAdapter);
    expect(module.get(IAgentSettingsStorePort)).toBeInstanceOf(JsonAgentSettingsStoreAdapter);
    expect(module.get(IPreferencesStorePort)).toBeInstanceOf(SqlitePreferencesStoreAdapter);
    expect(module.get(IAgentTurnPort)).toBeInstanceOf(AgentTurnService);
    expect(module.get(IAgentConfigurationPort)).toBeInstanceOf(AgentConfigurationService);
    expect(module.get(IUserQuestionPort)).toBeInstanceOf(UserQuestionService);
    await module.close();
  });
});
