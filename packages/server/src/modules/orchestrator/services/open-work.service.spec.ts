import { describe, expect, it } from 'vitest';

import type { OpenWork } from '../models/open-work.model.js';
import { InMemoryOpenWorkStoreFake } from '../testing/in-memory-open-work-store.fake.js';

import { OpenWorkService } from './open-work.service.js';


const delegate: OpenWork = { id: 'd', role: 'DEVELOPER', roleName: 'Dev', projectName: 'app', summary: 'Build', taskSpec: 'Go', cwd: '/w/app', round: 2, root: false };
const root: OpenWork = { id: 'c', role: 'CEO', roleName: 'CEO', projectName: null, summary: '', taskSpec: 'Hi', cwd: '/w', round: 1, root: true };
const question = { text: 'Which?', options: [] };
const waiting = { message: '', questions: [question], answers: [] };

/** A service over what an earlier process left on disk. */
async function afterRestart(...records: OpenWork[]) {
  const store = new InMemoryOpenWorkStoreFake();
  store.saved = { 'web-1': records };
  const service = new OpenWorkService(store);
  await service.load();
  return { store, service };
}

describe('OpenWorkService', () => {
  it('treats what it opens as live and what it loads as interrupted', async () => {
    const { service, store } = await afterRestart(delegate);

    await service.open('web-2', root);

    expect(service.interrupted('web-1')).toEqual([delegate]);
    expect(service.interrupted('web-2')).toEqual([]);
    expect(service.conversations()).toEqual(['web-1', 'web-2']);
    expect(store.saved['web-2']).toEqual([root]);
  });

  it('removes a record on close and ignores an unknown one', async () => {
    const { service, store } = await afterRestart(delegate);

    await service.close('web-1', 'other');
    await service.close('nowhere', 'd');
    expect(store.saved['web-1']).toEqual([delegate]);

    await service.close('web-1', 'd');
    expect(store.saved['web-1']).toEqual([]);
  });

  it('updates a known record and ignores an unknown one', async () => {
    const { service, store } = await afterRestart(delegate);

    await service.update('web-1', 'other', { taskSpec: 'x' });
    await service.update('web-1', 'd', { taskSpec: 'New' });

    expect(store.saved['web-1']).toEqual([{ ...delegate, taskSpec: 'New' }]);
  });

  it('closes every record of a conversation', async () => {
    const { service, store } = await afterRestart(delegate, root);
    await service.open('web-1', { ...delegate, id: 'live' });

    await service.closeAll('web-1');
    await service.closeAll('nowhere');

    expect(store.saved).toEqual({});
    expect(service.conversations()).toEqual([]);
  });

  it('keeps every record once shutting down, whatever the dying turns report', async () => {
    const { service, store } = await afterRestart(delegate, root);
    service.onModuleDestroy();

    await service.close('web-1', 'd');
    await service.closeAll('web-1');
    await service.update('web-1', 'd', { taskSpec: 'x' });
    await service.open('web-1', { ...delegate, id: 'new' });
    await service.discardInterruptedRoots('web-1');

    expect(store.saved['web-1']).toEqual([delegate, root]);
  });

  describe('continuable', () => {
    it('lists stopped delegates and hides the root waiting for them', async () => {
      const { service } = await afterRestart(delegate, root);

      expect(service.continuable('web-1')).toEqual([{ id: 'd', role: 'DEVELOPER', roleName: 'Dev', projectName: 'app', summary: 'Build' }]);
    });

    it('lists a root that stopped alone, only the latest', async () => {
      const { service } = await afterRestart(root, { ...root, id: 'c2' });

      expect(service.continuable('web-1').map(work => work.id)).toEqual(['c2']);
    });

    it('leaves out an agent that asked, which answering sets going', async () => {
      const { service } = await afterRestart({ ...delegate, questions: waiting }, { ...delegate, id: 'd2' });

      expect(service.continuable('web-1').map(work => work.id)).toEqual(['d2']);
    });
  });

  describe('claims', () => {
    it('hands stopped work over once', async () => {
      const { service } = await afterRestart(delegate);

      expect(service.claimStopped('web-1', 'd')).toEqual(delegate);
      expect(service.claimStopped('web-1', 'd')).toBeUndefined();
      expect(service.continuable('web-1')).toEqual([]);
    });

    it('hands asked work over once, only to the delivery of its answers', async () => {
      const asked = { ...delegate, questions: waiting };
      const { service } = await afterRestart(asked);

      expect(service.claimStopped('web-1', 'd')).toBeUndefined();
      expect(service.claimAsked('web-1', 'd')).toEqual(asked);
      expect(service.claimAsked('web-1', 'd')).toBeUndefined();
    });

    it('does not hand stopped work to a delivery of answers', async () => {
      const { service } = await afterRestart(delegate);

      expect(service.claimAsked('web-1', 'd')).toBeUndefined();
    });
  });

  it('discards interrupted roots unless they wait for answers', async () => {
    const { service, store } = await afterRestart(root, { ...root, id: 'asking', questions: waiting }, delegate);

    await service.discardInterruptedRoots('web-1');
    await service.discardInterruptedRoots('nowhere');

    expect(store.saved['web-1']!.map(work => work.id)).toEqual(['asking', 'd']);
  });

  it('keeps working after a failed write', async () => {
    const { service, store } = await afterRestart();
    store.failNextSave = true;

    await service.open('web-1', delegate);
    await service.open('web-1', root);

    expect(store.saved['web-1']).toEqual([delegate, root]);
  });
});
