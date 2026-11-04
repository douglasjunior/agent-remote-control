import { conversationEntrySchema } from './conversation-entry.js';


const at = '2026-01-01T00:00:00.000Z';
const agentInfo = { roleName: 'CEO', agentName: 'Claude', modelName: 'm', effortName: 'e' };

describe('conversationEntrySchema', () => {
  it.each([
    { id: '1', at, type: 'user_message', text: 'hi' },
    { id: '1b', at, type: 'user_message', text: '', attachments: [{ path: '.arc-uploads/c/a.png', name: 'a.png' }] },
    { id: 'thought:1', at, type: 'thought', text: 'hmm', removed: true },
    { id: 'tool:1', at, type: 'tool', title: 'Read', status: 'in_progress', result: 'r', details: 'd' },
    { id: 'd:1:CEO:started', at, type: 'delegation', phase: 'started', round: 1, role: 'DEVELOPER', roleName: 'Dev' },
    {
      id: 'd:1:CEO:finished',
      at,
      type: 'delegation',
      phase: 'finished',
      round: 1,
      role: 'DEVELOPER',
      roleName: 'Dev',
      projectName: 'p',
      response: 'done',
      agentInfo,
      durationMs: 10,
    },
    { id: '2', at, type: 'interim', text: 'wip' },
    {
      id: '3',
      at,
      type: 'question',
      askerRoleName: 'Dev',
      projectName: 'p',
      text: 'which?',
      rationale: 'why',
      options: ['a', 'b'],
      number: 1,
      total: 2,
      message: 'm',
    },
    { id: '5', at, type: 'notice', level: 'warning', text: 'careful' },
    { id: '6', at, type: 'agent_response', status: 'failed', response: 'r', errorMessage: 'e', agentInfo },
  ])('accepts $type', (entry) => {
    expect(conversationEntrySchema.safeParse(entry).success).toBe(true);
  });

  it.each([
    ['unknown type', { id: '1', at, type: 'nope' }],
    ['the removed selection entry', { id: '1', at, type: 'selection', mode: 'selection', step: 'agent', options: [] }],
    ['missing id', { at, type: 'interim', text: 'x' }],
    ['invalid tool status', { id: '1', at, type: 'tool', title: 't', status: 'done' }],
    ['non-object', 42],
  ])('rejects %s', (_label, data) => {
    expect(conversationEntrySchema.safeParse(data).success).toBe(false);
  });
});
