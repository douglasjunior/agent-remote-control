import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';

import { openQuestion } from './open-question.js';


const at = '2026-01-01T00:00:00.000Z';
const question = (id: string, closed: boolean): ConversationEntry => ({
  id, at, type: 'question', askerRole: 'DEVELOPER', askerRoleName: 'Developer', text: id, options: [], number: 1, total: 1, closed,
});
const notice: ConversationEntry = { id: 'n', at, type: 'notice', level: 'info', text: 'x' };

describe('openQuestion', () => {
  it('should find the open question wherever it sits, even before newer entries', () => {
    expect(openQuestion([question('q1', false), notice, { ...notice, id: 'n2' }])?.id).toBe('q1');
  });

  it('should be the last of the open questions', () => {
    expect(openQuestion([question('q1', false), question('q2', false), notice])?.id).toBe('q2');
  });

  it('should skip closed questions', () => {
    expect(openQuestion([question('q1', false), question('q2', true)])?.id).toBe('q1');
    expect(openQuestion([question('q1', true), notice])).toBeUndefined();
  });

  it('should be undefined without questions', () => {
    expect(openQuestion([])).toBeUndefined();
  });
});
