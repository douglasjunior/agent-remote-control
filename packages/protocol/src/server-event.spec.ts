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
    { type: 'conversation.history', conversationId: 'c', entries: [entry], state: 'running', draft: 'Working on' },
    { type: 'conversation.draft', conversationId: 'c', text: 'Working on it' },
    { type: 'conversation.draft', conversationId: 'c', text: '' },
    { type: 'conversation.state', conversationId: 'c', state: 'running' },
    { type: 'prompts.list', requestId: 'r', prompts: ['latest', 'older'] },
    {
      type: 'files.results',
      requestId: 'r',
      items: [{ path: 'app/src/', kind: 'directory', matches: [0, 4] }, { path: 'app/a.ts', kind: 'file', matches: [] }],
      walking: true,
    },
    { type: 'upload.ready', uploadId: 'u' },
    { type: 'upload.ack', uploadId: 'u', index: 3 },
    { type: 'upload.done', uploadId: 'u', attachment: { path: '.arc-uploads/c/a.png', name: 'a.png' } },
    { type: 'upload.failed', uploadId: 'u', reason: 'Too large' },
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
    ['draft without text', { type: 'conversation.draft', conversationId: 'c' }],
    ['history with a non-string draft', { type: 'conversation.history', conversationId: 'c', entries: [], state: 'idle', draft: 1 }],
    ['prompts.list with a non-string prompt', { type: 'prompts.list', requestId: 'r', prompts: [1] }],
    ['files.results without matches', { type: 'files.results', requestId: 'r', items: [{ path: 'a', kind: 'file' }], walking: false }],
    ['files.results with a negative match index', { type: 'files.results', requestId: 'r', items: [{ path: 'a', kind: 'file', matches: [-1] }], walking: false }],
    ['files.results with an unknown kind', { type: 'files.results', requestId: 'r', items: [{ path: 'a', kind: 'link', matches: [] }], walking: false }],
    ['upload.done without a path', { type: 'upload.done', uploadId: 'u', attachment: { name: 'a' } }],
    ['upload.ack with a negative index', { type: 'upload.ack', uploadId: 'u', index: -1 }],
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
