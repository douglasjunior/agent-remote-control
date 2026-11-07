import { parseClientCommand } from './client-command.js';
import { MAX_ATTACHMENTS, MAX_MENTION_QUERY_LENGTH, MAX_MESSAGE_LENGTH, MAX_UPLOAD_BYTES, UPLOAD_CHUNK_BYTES } from './limits.js';


describe('parseClientCommand', () => {
  it.each([
    { type: 'auth', token: 't' },
    { type: 'conversation.list' },
    { type: 'conversation.create', requestId: 'r' },
    { type: 'conversation.history', conversationId: 'c' },
    { type: 'message.send', conversationId: 'c', text: 'hi' },
    { type: 'message.send', conversationId: 'c', text: 'see', attachments: [{ path: '.arc-uploads/c/a.png', name: 'a.png' }] },
    { type: 'message.send', conversationId: 'c', text: '', attachments: [{ path: '.arc-uploads/c/a.png', name: 'a.png' }] },
    { type: 'upload.start', uploadId: 'u', conversationId: 'c', name: 'a.png', size: 10 },
    { type: 'upload.chunk', uploadId: 'u', index: 0, dataBase64: 'AAEC' },
    { type: 'upload.finish', uploadId: 'u' },
    { type: 'upload.abort', uploadId: 'u' },
    { type: 'turn.cancel', conversationId: 'c' },
    { type: 'prompts.history', requestId: 'r' },
    { type: 'files.search', requestId: 'r', query: 'src/ap' },
    { type: 'files.search', requestId: 'r', query: '' },
    { type: 'files.close', requestId: 'r' },
    { type: 'agents.list' },
    { type: 'quota.get' },
    { type: 'quota.get', refresh: true },
    { type: 'auth.status' },
    { type: 'auth.status', refresh: true },
    { type: 'auth.login', agentId: 'claude' },
    { type: 'auth.input', agentId: 'claude', text: 'abc#def' },
    { type: 'auth.cancel', agentId: 'claude' },
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
    ['a login without an agent', { type: 'auth.login' }],
    ['a blank login code', { type: 'auth.input', agentId: 'claude', text: '   ' }],
    ['an oversized login code', { type: 'auth.input', agentId: 'claude', text: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) }],
    ['missing fields', { type: 'auth' }],
    ['blank text', { type: 'message.send', conversationId: 'c', text: '   ' }],
    ['blank text with an empty attachment list', { type: 'message.send', conversationId: 'c', text: ' ', attachments: [] }],
    ['too many attachments', { type: 'message.send', conversationId: 'c', text: 'x', attachments: Array.from({ length: MAX_ATTACHMENTS + 1 }, () => ({ path: 'a', name: 'a' })) }],
    ['attachment without a name', { type: 'message.send', conversationId: 'c', text: 'x', attachments: [{ path: 'a' }] }],
    ['oversized upload', { type: 'upload.start', uploadId: 'u', conversationId: 'c', name: 'a', size: MAX_UPLOAD_BYTES + 1 }],
    ['negative upload size', { type: 'upload.start', uploadId: 'u', conversationId: 'c', name: 'a', size: -1 }],
    ['oversized upload chunk', { type: 'upload.chunk', uploadId: 'u', index: 0, dataBase64: 'A'.repeat(Math.ceil(UPLOAD_CHUNK_BYTES / 3) * 4 + 1) }],
    ['negative chunk index', { type: 'upload.chunk', uploadId: 'u', index: -1, dataBase64: '' }],
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

  it('accepts an answer with attachments only and refuses an empty one', () => {
    const command = (answer: unknown) => ({ type: 'question.answer', conversationId: 'c', answer });

    expect(parseClientCommand(command({ kind: 'text', text: '', attachments: [{ path: 'a', name: 'a' }] })).ok).toBe(true);
    expect(parseClientCommand(command({ kind: 'text', text: '  ' })).ok).toBe(false);
  });
});
