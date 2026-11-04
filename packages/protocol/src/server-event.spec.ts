import { parseServerEvent } from './server-event.js';


const at = '2026-01-01T00:00:00.000Z';
const conversation = { id: 'c', title: 'T', createdAt: at, updatedAt: at };
const entry = { id: '1', at, type: 'interim', text: 'x' };

describe('parseServerEvent', () => {
  it.each([
    { type: 'auth.ok' },
    { type: 'auth.failed' },
    { type: 'conversation.list', conversations: [conversation] },
    { type: 'conversation.created', requestId: 'r', conversation },
    { type: 'conversation.updated', conversation },
    { type: 'conversation.history', conversationId: 'c', entries: [entry], state: 'idle' },
    { type: 'conversation.entry', conversationId: 'c', entry },
    { type: 'conversation.state', conversationId: 'c', state: 'running' },
    { type: 'prompts.list', requestId: 'r', prompts: ['latest', 'older'] },
    { type: 'agents.list', agents: [{ id: 'claude', name: 'Claude Code', description: 'CLI' }, { id: 'codex', name: 'Codex' }] },
    { type: 'models.list', agentId: 'claude', models: [{ id: 'opus', name: 'Opus' }] },
    { type: 'efforts.list', agentId: 'claude', modelId: 'opus', efforts: [{ id: 'high', name: 'High' }] },
    { type: 'profiles', conversationId: 'c', configured: false, profiles: [{ role: 'CEO', roleName: 'CEO' }] },
    {
      type: 'profiles',
      conversationId: 'c',
      configured: true,
      profiles: [
        {
          role: 'CEO',
          roleName: 'CEO',
          agent: { id: 'claude', name: 'Claude Code', available: true },
          model: { id: 'opus', name: 'Opus' },
          effort: { id: 'high', name: 'High' },
        },
      ],
    },
    { type: 'error', message: 'boom', conversationId: 'c' },
    { type: 'error', message: 'boom' },
  ])('accepts $type', (event) => {
    expect(parseServerEvent(event)).toEqual({ ok: true, value: event });
  });

  it.each([
    ['unknown type', { type: 'nope' }],
    ['missing fields', { type: 'conversation.state', conversationId: 'c' }],
    ['invalid state', { type: 'conversation.state', conversationId: 'c', state: 'x' }],
    ['prompts.list with a non-string prompt', { type: 'prompts.list', requestId: 'r', prompts: [1] }],
    ['profile without availability', { type: 'profiles', conversationId: 'c', configured: true, profiles: [{ role: 'CEO', roleName: 'CEO', agent: { id: 'a', name: 'A' } }] }],
    ['invalid entry', { type: 'conversation.entry', conversationId: 'c', entry: { type: 'x' } }],
    ['null', null],
    ['array', []],
  ])('rejects %s', (_label, data) => {
    const result = parseServerEvent(data);
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty('error', expect.any(String));
  });
});
