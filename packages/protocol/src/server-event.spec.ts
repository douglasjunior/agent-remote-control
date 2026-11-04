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
    { type: 'error', message: 'boom', conversationId: 'c' },
    { type: 'error', message: 'boom' },
  ])('accepts $type', (event) => {
    expect(parseServerEvent(event)).toEqual({ ok: true, value: event });
  });

  it.each([
    ['unknown type', { type: 'nope' }],
    ['missing fields', { type: 'conversation.state', conversationId: 'c' }],
    ['invalid state', { type: 'conversation.state', conversationId: 'c', state: 'x' }],
    ['invalid entry', { type: 'conversation.entry', conversationId: 'c', entry: { type: 'x' } }],
    ['null', null],
    ['array', []],
  ])('rejects %s', (_label, data) => {
    const result = parseServerEvent(data);
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty('error', expect.any(String));
  });
});
