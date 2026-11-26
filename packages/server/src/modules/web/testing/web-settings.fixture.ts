import { StubDiscordConnectionTester } from '../../discord/testing/stub-discord-connection-tester.js';
import { TestDiscordConnectionUseCase } from '../../discord/use-cases/test-discord-connection.use-case.js';
import type { StubAgentConfigurationPort } from '../../orchestrator/testing/stub-agent-configuration.port.js';
import { RuntimeSettingsService } from '../../settings/services/runtime-settings.service.js';
import { SettingsChangeNotifierService } from '../../settings/services/settings-change-notifier.service.js';
import { FakeSettingsStore } from '../../settings/testing/fake-settings-store.js';
import { ChangeSettingsUseCase } from '../../settings/use-cases/change-settings.use-case.js';
import { GetSettingsUseCase } from '../../settings/use-cases/get-settings.use-case.js';
import type { WebConnectionRegistryService } from '../services/web-connection-registry.service.js';
import { WebSettingsService } from '../services/web-settings.service.js';


/** The settings page over the real settings use cases, a store in memory and a stubbed Discord tester. */
export function createWebSettings(configuration: StubAgentConfigurationPort, registry: WebConnectionRegistryService) {
  const store = new FakeSettingsStore();
  const runtime = new RuntimeSettingsService();
  const tester = new StubDiscordConnectionTester();
  const service = new WebSettingsService(
    new GetSettingsUseCase(runtime),
    new ChangeSettingsUseCase(store, runtime, new SettingsChangeNotifierService()),
    new TestDiscordConnectionUseCase(runtime, tester),
    configuration,
    registry,
  );
  return { service, store, runtime, tester };
}
