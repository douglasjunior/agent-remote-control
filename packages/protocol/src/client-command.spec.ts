import { parseClientCommand } from './client-command.js';
import { MAX_MESSAGE_LENGTH } from './limits.js';


describe('parseClientCommand', () => {
  it.each([
    { type: 'auth', token: 't' },
    { type: 'conversation.list' },
    { type: 'conversation.create', requestId: 'r' },
    { type: 'conversation.history', conversationId: 'c' },
    { type: 'message.send', conversationId: 'c', text: 'hi' },
    { type: 'turn.cancel', conversationId: 'c' },
    { type: 'config.open', conversationId: 'c', menu: 'profiles' },
    { type: 'config.cancel', conversationId: 'c' },
  ])('accepts $type', (command) => {
    expect(parseClientCommand(command)).toEqual({ ok: true, value: command });
  });

  it('trims the message text', () => {
    const result = parseClientCommand({ type: 'message.send', conversationId: 'c', text: '  hi  ' });
    expect(result).toEqual({
      ok: true,
      value: { type: 'message.send', conversationId: 'c', text: 'hi' },
    });
  });

  it.each([
    ['unknown type', { type: 'nope' }],
    ['missing fields', { type: 'auth' }],
    ['blank text', { type: 'message.send', conversationId: 'c', text: '   ' }],
    ['oversized text', { type: 'message.send', conversationId: 'c', text: 'a'.repeat(MAX_MESSAGE_LENGTH + 1) }],
    ['invalid menu', { type: 'config.open', conversationId: 'c', menu: 'x' }],
    ['null', null],
    ['string', 'auth'],
  ])('rejects %s', (_label, data) => {
    const result = parseClientCommand(data);
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty('error', expect.any(String));
  });

  it('accepts text of exactly the maximum length', () => {
    const text = 'a'.repeat(MAX_MESSAGE_LENGTH);
    expect(parseClientCommand({ type: 'message.send', conversationId: 'c', text }).ok).toBe(true);
  });
});
