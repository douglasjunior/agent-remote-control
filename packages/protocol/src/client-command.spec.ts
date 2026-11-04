import { parseClientCommand } from './client-command.js';
import { MAX_MENTION_QUERY_LENGTH, MAX_MESSAGE_LENGTH } from './limits.js';


describe('parseClientCommand', () => {
  it.each([
    { type: 'auth', token: 't' },
    { type: 'conversation.list' },
    { type: 'conversation.create', requestId: 'r' },
    { type: 'conversation.history', conversationId: 'c' },
    { type: 'message.send', conversationId: 'c', text: 'hi' },
    { type: 'turn.cancel', conversationId: 'c' },
    { type: 'prompts.history', requestId: 'r' },
    { type: 'files.search', requestId: 'r', query: 'src/ap' },
    { type: 'files.search', requestId: 'r', query: '' },
    { type: 'files.close', requestId: 'r' },
    { type: 'agents.list' },
    { type: 'models.list', agentId: 'claude' },
    { type: 'efforts.list', agentId: 'claude', modelId: 'opus' },
    { type: 'profiles.get', conversationId: 'c' },
    { type: 'profiles.set', conversationId: 'c', agentId: 'claude' },
    { type: 'profiles.set', conversationId: 'c', roles: ['CEO', 'DEVELOPER'], agentId: 'claude', modelId: 'opus', effortId: 'high' },
    { type: 'question.answer', conversationId: 'c', answer: { kind: 'option', optionIndex: 2 } },
    { type: 'question.answer', conversationId: 'c', answer: { kind: 'text', text: 'my answer' } },
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
    ['removed menu command', { type: 'config.open', conversationId: 'c', menu: 'agent' }],
    ['removed selection command', { type: 'selection.choose', conversationId: 'c', optionIndexes: [1] }],
    ['empty role list', { type: 'profiles.set', conversationId: 'c', roles: [], agentId: 'claude' }],
    ['profiles.set without an agent', { type: 'profiles.set', conversationId: 'c' }],
    ['prompts.history without a request id', { type: 'prompts.history' }],
    ['files.close without a request id', { type: 'files.close' }],
    ['files.search without a query', { type: 'files.search', requestId: 'r' }],
    ['oversized files.search query', { type: 'files.search', requestId: 'r', query: 'a'.repeat(MAX_MENTION_QUERY_LENGTH + 1) }],
    ['models.list without an agent', { type: 'models.list' }],
    ['fractional option index', { type: 'question.answer', conversationId: 'c', answer: { kind: 'option', optionIndex: 1.5 } }],
    ['blank text answer', { type: 'question.answer', conversationId: 'c', answer: { kind: 'text', text: '  ' } }],
    ['unknown answer kind', { type: 'question.answer', conversationId: 'c', answer: { kind: 'voice' } }],
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
