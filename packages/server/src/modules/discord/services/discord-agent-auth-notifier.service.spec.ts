import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StubAgentAuthPort } from '../../agent/testing/stub-agent-auth.port.js';
import { DiscordActivityFormatter } from '../formatters/discord-activity.formatter.js';

import { AgentAuthRequestService } from './agent-auth-request.service.js';
import { DiscordAgentAuthNotifierService } from './discord-agent-auth-notifier.service.js';


const claude = { agentId: 'claude', displayName: 'Claude Code' };

async function flush(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
}

describe('DiscordAgentAuthNotifierService', () => {
  let agentAuth: StubAgentAuthPort;
  let requests: AgentAuthRequestService;
  let notifier: DiscordAgentAuthNotifierService;
  let sent: string[];
  const channel = {
    send: async (content: string): Promise<void> => {
      sent.push(content);
    },
  };

  beforeEach(() => {
    agentAuth = new StubAgentAuthPort();
    requests = new AgentAuthRequestService();
    notifier = new DiscordAgentAuthNotifierService(agentAuth, requests, new DiscordActivityFormatter());
    sent = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should start the login and announce it', async () => {
    await notifier.start('conv-1', claude, channel);

    expect(agentAuth.started).toEqual(['claude']);
    expect(sent).toEqual(['⏳ Starting the **Claude Code** login...']);
    expect(requests.runningLogin('conv-1')).toBe('claude');
  });

  it('should post the link and the waiting notice', async () => {
    await notifier.start('conv-1', claude, channel);

    agentAuth.emit('claude', { kind: 'url', url: 'https://claude.com/oauth' });
    await flush();

    expect(sent.at(-1)).toBe([
      '🔗 **Claude Code login** — open this link in your browser and sign in with your subscription account:',
      'https://claude.com/oauth',
      '⏳ Waiting for you to finish in the browser. Use /cancel to stop.',
    ].join('\n'));
  });

  it('should post the one-time code with the link', async () => {
    await notifier.start('conv-1', claude, channel);

    agentAuth.emit('claude', { kind: 'url', url: 'https://auth.openai.com/codex/device', code: 'ABCD-12345' });
    await flush();

    expect(sent.at(-1)).toContain('Enter this one-time code: `ABCD-12345`');
  });

  it('should ask for the pasted code and route the next message to the login', async () => {
    await notifier.start('conv-1', claude, channel);

    agentAuth.emit('claude', { kind: 'prompt', hint: 'Paste code here >' });
    await flush();

    expect(sent.at(-1)).toContain('reply in this thread with the code');
    expect(requests.loginAwaitingCode('conv-1')).toBe('claude');
  });

  it.each([
    [{ kind: 'completed' as const }, '✅ **Claude Code** is logged in.'],
    [{ kind: 'failed' as const, reason: 'Invalid code.' }, '❌ **Claude Code login failed**: Invalid code.'],
    [{ kind: 'cancelled' as const }, '🛑 **Claude Code login cancelled.**'],
  ])('should report the end of the login %j and free the conversation', async (event, message) => {
    await notifier.start('conv-1', claude, channel);
    agentAuth.emit('claude', { kind: 'prompt', hint: 'x' });

    agentAuth.emit('claude', event);
    await flush();

    expect(sent.at(-1)).toBe(message);
    expect(requests.runningLogin('conv-1')).toBeUndefined();
  });

  it('should keep the order of the messages', async () => {
    await notifier.start('conv-1', claude, channel);

    agentAuth.emit('claude', { kind: 'url', url: 'https://claude.com/oauth' });
    agentAuth.emit('claude', { kind: 'prompt', hint: 'x' });
    agentAuth.emit('claude', { kind: 'completed' });
    await flush();

    expect(sent.slice(1).map(message => Array.from(message)[0])).toEqual(['🔗', '🔑', '✅']);
  });

  it('should report a login that cannot start', async () => {
    agentAuth.startError = new Error('The claude CLI was not found in PATH.');

    await notifier.start('conv-1', claude, channel);

    expect(sent.at(-1)).toBe('❌ **Claude Code login failed**: The claude CLI was not found in PATH.');
    expect(requests.runningLogin('conv-1')).toBeUndefined();
  });

  it('should use a generic reason when the start failure is not an error', async () => {
    agentAuth.startError = 'boom' as unknown as Error;

    await notifier.start('conv-1', claude, channel);

    expect(sent.at(-1)).toBe('❌ **Claude Code login failed**: The login could not start.');
  });

  it('should log a failed post and carry on', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const failing = { send: async () => Promise.reject(new Error('Missing Access')) };

    await notifier.start('conv-1', claude, failing);

    expect(warn).toHaveBeenCalledWith('agent_login_message_failed: Missing Access');
  });

  it('should log a post failure that is not an error', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const failing = { send: async () => Promise.reject('nope') };

    await notifier.start('conv-1', claude, failing);

    expect(warn).toHaveBeenCalledWith('agent_login_message_failed: nope');
  });

  it('should log the outcome of a login without the link or the code', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await notifier.start('conv-1', claude, channel);

    agentAuth.emit('claude', { kind: 'url', url: 'https://claude.com/oauth', code: 'ABCD-12345' });
    agentAuth.emit('claude', { kind: 'completed' });
    await flush();

    expect(log).toHaveBeenCalledWith('[Agent Login] completed (conversation=conv-1)');
    expect(JSON.stringify(log.mock.calls)).not.toContain('claude.com');
    expect(JSON.stringify(log.mock.calls)).not.toContain('ABCD');
  });

  describe('cancel', () => {
    it('should cancel the login the conversation runs', async () => {
      await notifier.start('conv-1', claude, channel);

      expect(notifier.cancel('conv-1')).toBe(true);
      expect(agentAuth.cancelled).toEqual(['claude']);
    });

    it('should do nothing without a login', () => {
      expect(notifier.cancel('conv-1')).toBe(false);
      expect(agentAuth.cancelled).toEqual([]);
    });
  });
});
