import { describe, expect, it } from 'vitest';

import { AGENT_AUTH_PROVIDERS } from './agent-auth-providers.constant.js';


function commandProbe(agentId: string) {
  const status = AGENT_AUTH_PROVIDERS.find(provider => provider.agentId === agentId)?.status;
  if (status?.kind !== 'command') {
    throw new Error(`${agentId} has no command probe`);
  }
  return status;
}

describe('AGENT_AUTH_PROVIDERS', () => {
  it('should cover the agents that have a CLI login', () => {
    expect(AGENT_AUTH_PROVIDERS.map(provider => provider.agentId)).toEqual([
      'agy',
      'claude',
      'copilot',
      'codex',
      'cursor',
    ]);
  });

  it.each([
    ['agy', ['acp', '--login']],
    ['claude', ['auth', 'login', '--claudeai']],
    ['copilot', ['login', '--device-code']],
    ['codex', ['login', '--device-auth']],
    ['cursor', ['login']],
  ])('should log %s in with a flow that works away from this machine', (agentId, args) => {
    expect(AGENT_AUTH_PROVIDERS.find(provider => provider.agentId === agentId)?.login.args).toEqual(args);
  });

  it('should run only the Copilot login in a terminal', () => {
    expect(
      AGENT_AUTH_PROVIDERS.filter(provider => provider.login.terminal).map(provider => provider.agentId),
    ).toEqual(['copilot']);
  });

  it.each(['agy', 'copilot'])('should probe %s through its ACP adapter', (agentId) => {
    expect(AGENT_AUTH_PROVIDERS.find(provider => provider.agentId === agentId)?.status).toEqual({ kind: 'acp' });
  });

  describe('claude status', () => {
    const { parse } = commandProbe('claude');

    it('should read a logged-in account', () => {
      expect(parse('{"loggedIn": true, "email": "me@example.com"}', 0)).toEqual({
        status: 'authenticated',
        detail: 'me@example.com',
      });
    });

    it('should read a logged-out account even though the CLI exits with 1', () => {
      expect(parse('{\n  "loggedIn": false,\n  "authMethod": "none"\n}', 1)).toEqual({ status: 'unauthenticated' });
    });

    it.each(['', 'not json', '{broken', '{not json}', '[1]', '{"loggedIn": "yes"}'])('should be unknown for %j', (output) => {
      expect(parse(output, 0)).toEqual({ status: 'unknown' });
    });
  });

  describe('cursor status', () => {
    const { parse } = commandProbe('cursor');

    it('should read an authenticated account', () => {
      expect(parse('{"status":"authenticated","isAuthenticated":true,"email":"me@example.com"}', 0)).toEqual({
        status: 'authenticated',
        detail: 'me@example.com',
      });
    });

    it('should fall back to the account name', () => {
      expect(parse('{"isAuthenticated":true,"account":"me"}', 0)).toEqual({ status: 'authenticated', detail: 'me' });
    });

    it('should read a logged-out account', () => {
      expect(parse('{"status":"unauthenticated","isAuthenticated":false}', 0)).toEqual({ status: 'unauthenticated' });
    });

    it('should be unknown without the flag', () => {
      expect(parse('Not logged in', 0)).toEqual({ status: 'unknown' });
    });
  });

  describe('codex status', () => {
    const { parse } = commandProbe('codex');

    it('should read a logged-out CLI whatever the noise around the message', () => {
      expect(parse('WARNING: no aliases\nNot logged in\n', 1)).toEqual({ status: 'unauthenticated' });
    });

    it('should treat a clean exit as logged in', () => {
      expect(parse('Logged in using ChatGPT', 0)).toEqual({ status: 'authenticated' });
    });

    it('should be unknown for another failure', () => {
      expect(parse('boom', 2)).toEqual({ status: 'unknown' });
    });
  });
});
