import { describe, expect, it } from 'vitest';

import type { OpenWork } from '../models/open-work.model.js';
import { OpenWorkService } from '../services/open-work.service.js';
import { UserQuestionQueueService } from '../services/user-question-queue.service.js';
import { InMemoryOpenWorkStoreFake } from '../testing/in-memory-open-work-store.fake.js';

import { RestoreOpenWorkUseCase } from './restore-open-work.use-case.js';


const first = { text: 'First?', options: ['a', 'b'] };
const second = { text: 'Second?', options: [] };
const record: OpenWork = { id: 'd', role: 'PRODUCT_OWNER', roleName: 'PO', projectName: 'app', summary: 'Spec', taskSpec: 'Go', cwd: '/w/app', round: 1, root: false };

async function restore(...records: OpenWork[]) {
  const store = new InMemoryOpenWorkStoreFake();
  store.saved = { 'web-1': records };
  const openWork = new OpenWorkService(store);
  const queue = new UserQuestionQueueService({ getTimeoutMs: () => 0 });
  await new RestoreOpenWorkUseCase(openWork, queue).onModuleInit();
  return { store, openWork, queue };
}

describe('RestoreOpenWorkUseCase', () => {
  it('queues unanswered questions where the user left them and hands over the answers when they are done', async () => {
    const { queue, openWork } = await restore({
      ...record,
      questions: { message: 'Context', questions: [first, second], answers: [{ question: first, answer: 'a', optionNumber: 1 }] },
    });

    expect(queue.current('web-1')).toMatchObject({ question: second, number: 2, total: 2, asker: { role: 'PRODUCT_OWNER', projectName: 'app' } });
    expect(openWork.continuable('web-1')).toEqual([]);

    expect(queue.submit('web-1', { kind: 'text', text: 'mine' })).toMatchObject({
      kind: 'answered',
      restoredWork: { workId: 'd', answers: [{ answer: 'a' }, { answer: 'mine' }] },
    });
  });

  it('keeps the answers given so far on disk while questions remain', async () => {
    const { queue, store } = await restore({ ...record, questions: { message: '', questions: [first, second], answers: [] } });

    queue.submit('web-1', { kind: 'option', optionIndex: 1 });
    await Promise.resolve();

    expect(store.saved['web-1']![0]!.questions!.answers.map(answer => answer.answer)).toEqual(['a']);
  });

  it('leaves work without questions for the user to continue', async () => {
    const { queue, openWork } = await restore(record);

    expect(queue.hasPending('web-1')).toBe(false);
    expect(openWork.continuable('web-1').map(work => work.id)).toEqual(['d']);
  });
});
