import { describe, expect, it } from '@rstest/core';

import { AgentRegistryService } from '../../agent-definitions/services/agent-registry.service.js';
import { createArtifactsService } from '../../artifacts/testing/artifacts-service.fixture.js';
import { ConversationLogContextService } from '../../logging/services/conversation-log-context.service.js';
import { StubAgentSkillsPort } from '../testing/stub-agent-skills.port.js';
import { StubAgentPort } from '../testing/stub-agent.port.js';
import { RunAgentRequestsUseCase } from '../use-cases/run-agent-requests.use-case.js';
import { RunAgentToolUseCase } from '../use-cases/run-agent-tool.use-case.js';

import { AgentRequestParserService } from './agent-request-parser.service.js';
import { AgentToolCatalogService } from './agent-tool-catalog.service.js';
import { AgentToolRequestService } from './agent-tool-request.service.js';
import { AgentToolSessionsService } from './agent-tool-sessions.service.js';
import { AgentToolsConfigService } from './agent-tools-config.service.js';
import { AgentToolsService } from './agent-tools.service.js';
import { ArtifactPromptFormatterService } from './artifact-prompt-formatter.service.js';


function setup() {
  const registry = new AgentRegistryService();
  const skills = new StubAgentSkillsPort();
  const toolSessions = new AgentToolSessionsService(new AgentToolsConfigService());
  const requests = new RunAgentRequestsUseCase(createArtifactsService({ conversationId: 'c1' }).service, registry, new ArtifactPromptFormatterService(), skills, new AgentRequestParserService());
  const service = new AgentToolsService(
    toolSessions,
    new AgentToolCatalogService(registry, skills),
    new RunAgentToolUseCase(toolSessions, new AgentToolRequestService(), requests, new ConversationLogContextService()),
  );
  return { service, toolSessions };
}

describe('AgentToolsService', () => {
  it('should open tool sessions only once it is served, and describe and run them by credential', async () => {
    const { service, toolSessions } = setup();
    const port = new StubAgentPort();
    port.supportsHttpMcp = true;
    service.serveAt({ connection: credential => ({ url: 'http://127.0.0.1:1/mcp', headers: { 'x-credential': credential } }) });
    const [server] = toolSessions.open(port, { requester: { role: 'DEVELOPER', roleName: 'Developer', conversationId: 'c1' } });
    const credential = server!.headers['x-credential']!;

    expect(service.isOpen(credential)).toBe(true);
    expect((await service.describe(credential))?.tools.map(tool => tool.name)).toContain('artifact_update');
    await expect(service.call(credential, 'artifact_list', {})).resolves.toEqual({ status: 'done', text: 'No artifact matches.', isError: false });
  });

  it('should refuse a credential that is not open', async () => {
    const { service } = setup();

    expect(service.isOpen('unknown')).toBe(false);
    await expect(service.describe('unknown')).resolves.toBeUndefined();
    await expect(service.call('unknown', 'artifact_list', {})).resolves.toEqual({ status: 'closed' });
  });
});
