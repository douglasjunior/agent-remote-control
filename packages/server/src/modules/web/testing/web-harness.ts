import { StubAgentConfigurationPort } from '../../orchestrator/testing/stub-agent-configuration.port.js';
import { StubAgentTurnPort } from '../../orchestrator/testing/stub-agent-turn.port.js';
import { StubUserQuestionPort } from '../../orchestrator/testing/stub-user-question.port.js';
import { WebConnectionRegistryService } from '../services/web-connection-registry.service.js';
import { WebConversationEventsService } from '../services/web-conversation-events.service.js';

import { FakeClientConnection } from './fake-client-connection.js';
import { FakeConversationStore } from './fake-conversation-store.js';
import { StubWorkspacePort } from './stub-workspace.port.js';


/** Real events service and registry over a fake store, stubbed orchestrator ports and one observer connection. */
export function createWebHarness() {
  const store = new FakeConversationStore();
  const registry = new WebConnectionRegistryService();
  const events = new WebConversationEventsService(store, registry);
  const agentTurn = new StubAgentTurnPort();
  const configuration = new StubAgentConfigurationPort();
  const questions = new StubUserQuestionPort();
  const workspace = new StubWorkspacePort();
  const observer = new FakeClientConnection('observer');
  registry.register(observer);
  return { store, registry, events, agentTurn, configuration, questions, workspace, observer };
}
