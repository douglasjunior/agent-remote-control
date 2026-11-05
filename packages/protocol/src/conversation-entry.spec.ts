import { conversationEntrySchema } from './conversation-entry.js';


const at = '2026-01-01T00:00:00.000Z';
const agentInfo = { roleName: 'CEO', agentName: 'Claude', modelName: 'm', effortName: 'e' };

describe('conversationEntrySchema', () => {
  it.each([
    { id: '1', at, type: 'user_message', text: 'hi' },
    { id: '1b', at, type: 'user_message', text: '', attachments: [{ path: '.arc-uploads/c/a.png', name: 'a.png' }] },
    { id: 'thought:1', at, type: 'thought', text: 'hmm', removed: true, role: 'CEO' },
    { id: 'tool:1', at, type: 'tool', title: 'Read', status: 'in_progress', result: 'r', details: 'd', role: 'DEVELOPER' },
    { id: 'delegation:dl-1:started', at, type: 'delegation', delegationId: 'dl-1', phase: 'started', round: 1, role: 'DEVELOPER', roleName: 'Dev', summary: 'Adding the login screen' },
    {
      id: 'delegation:dl-1:finished',
      at,
      type: 'delegation',
      delegationId: 'dl-1',
      phase: 'finished',
      round: 1,
      role: 'DEVELOPER',
      roleName: 'Dev',
      summary: 'Adding the login screen',
      projectName: 'p',
      response: 'done',
      agentInfo,
      durationMs: 10,
    },
    {
      id: 'delegation:dl-2:failed',
      at,
      type: 'delegation',
      delegationId: 'dl-2',
      phase: 'failed',
      round: 1,
      role: 'DEVELOPER',
      roleName: 'Dev',
      summary: 'Adding the login screen',
      errorMessage: 'boom',
      durationMs: 10,
    },
    { id: '2', at, type: 'interim', text: 'wip' },
    {
      id: '3',
      at,
      type: 'question',
      askerRole: 'DEVELOPER',
      askerRoleName: 'Dev',
      projectName: 'p',
      text: 'which?',
      rationale: 'why',
      options: ['a', 'b'],
      number: 1,
      total: 2,
      closed: false,
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
    ['a delegation without its delegationId', { id: '1', at, type: 'delegation', phase: 'started', round: 1, role: 'DEVELOPER', roleName: 'Dev', summary: 's' }],
    ['a question without closed', { id: '1', at, type: 'question', askerRole: 'DEVELOPER', askerRoleName: 'Dev', text: 'q', options: [], number: 1, total: 1 }],
    ['non-object', 42],
  ])('rejects %s', (_label, data) => {
    expect(conversationEntrySchema.safeParse(data).success).toBe(false);
  });
});
