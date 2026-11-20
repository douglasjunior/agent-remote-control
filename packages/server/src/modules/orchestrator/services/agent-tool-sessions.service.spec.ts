import { afterEach, describe, expect, it, rs } from '@rstest/core';

import { createServedToolSessions, credentialOf, TOOLS_URL } from '../testing/agent-tool-sessions.fixture.js';
import { StubAgentPort } from '../testing/stub-agent.port.js';

import { AgentToolSessionsService } from './agent-tool-sessions.service.js';
import { AgentToolsConfigService } from './agent-tools-config.service.js';


const requester = { role: 'DEVELOPER', roleName: 'Developer', conversationId: 'c1', delegationId: 'd-1' };
const onTools = { ...requester, agentInterface: 'tools' };

function httpPort(): StubAgentPort {
  const port = new StubAgentPort();
  port.supportsHttpMcp = true;
  return port;
}

describe('AgentToolSessionsService', () => {
  afterEach(() => {
    rs.unstubAllEnvs();
  });

  it('should open a tool session behind an unguessable credential and return the server that reaches it', () => {
    const toolSessions = createServedToolSessions();
    const port = httpPort();

    const servers = toolSessions.open(port, { requester });

    expect(servers).toEqual([{ name: 'arc', url: TOOLS_URL, headers: { authorization: expect.stringMatching(/^Bearer [\w-]{43}$/) } }]);
    expect(toolSessions.find(credentialOf(servers))).toEqual({ requester: onTools });
    expect(credentialOf(toolSessions.open(httpPort(), { requester }))).not.toBe(credentialOf(servers));
  });

  it('should replace the tool session of a port that opens another session', () => {
    const toolSessions = createServedToolSessions();
    const port = httpPort();
    const first = credentialOf(toolSessions.open(port, { requester }));

    const second = credentialOf(toolSessions.open(port, { requester }));

    expect(toolSessions.find(first)).toBeUndefined();
    expect(toolSessions.find(second)).toEqual({ requester: onTools });
  });

  it('should refuse the credential once the port is closed', () => {
    const toolSessions = createServedToolSessions();
    const port = httpPort();
    const credential = credentialOf(toolSessions.open(port, { requester }));

    toolSessions.close(port);
    toolSessions.close(port);

    expect(toolSessions.find(credential)).toBeUndefined();
  });

  it('should put a session on the tools interface exactly while its port has a tool session open', () => {
    const toolSessions = createServedToolSessions();
    const port = httpPort();
    expect(toolSessions.interfaceOf(port)).toBe('tags');

    toolSessions.open(port, { requester });
    expect(toolSessions.interfaceOf(port)).toBe('tools');
    expect(toolSessions.interfaceOf(httpPort())).toBe('tags');

    toolSessions.close(port);
    expect(toolSessions.interfaceOf(port)).toBe('tags');
  });

  it('should leave on the tags interface a session that got no tool server', () => {
    const toolSessions = createServedToolSessions();
    const port = new StubAgentPort();

    toolSessions.open(port, { requester });

    expect(toolSessions.interfaceOf(port)).toBe('tags');
  });

  it('should hand the skill activity to the turn the port runs now', () => {
    const toolSessions = createServedToolSessions();
    const port = httpPort();
    const credential = credentialOf(toolSessions.open(port, { requester }));
    const onSkill = rs.fn();

    toolSessions.update(port, { requester, onSkill });
    toolSessions.update(httpPort(), { requester: { ...requester, role: 'QA' } });

    expect(toolSessions.find(credential)).toEqual({ requester: onTools, onSkill });
  });

  it('should attach nothing to an agent that does not take HTTP MCP servers', () => {
    expect(createServedToolSessions().open(new StubAgentPort(), { requester })).toEqual([]);
  });

  it('should attach nothing with AGENT_MCP_ENABLED=false', () => {
    rs.stubEnv('AGENT_MCP_ENABLED', 'false');

    expect(createServedToolSessions().open(httpPort(), { requester })).toEqual([]);
  });

  it('should attach nothing while nothing serves the tools or the endpoint cannot be reached', () => {
    const toolSessions = new AgentToolSessionsService(new AgentToolsConfigService());
    expect(toolSessions.open(httpPort(), { requester })).toEqual([]);

    toolSessions.serveAt({ connection: () => undefined });

    expect(toolSessions.open(httpPort(), { requester })).toEqual([]);
  });
});
