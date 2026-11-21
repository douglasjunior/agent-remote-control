import { expect, it, rs } from '@rstest/core';

import { buildArtifact } from '../../artifacts/testing/artifact.fixture.js';
import { createArtifactsService } from '../../artifacts/testing/artifacts-service.fixture.js';
import { FakeClientConnection } from '../testing/fake-client-connection.js';
import { FakeConversationStore } from '../testing/fake-conversation-store.js';

import { WebArtifactsService } from './web-artifacts.service.js';
import { WebConnectionRegistryService } from './web-connection-registry.service.js';


function setup() {
  const store = new FakeConversationStore();
  store.seed('web-1');
  const registry = new WebConnectionRegistryService();
  const observer = new FakeClientConnection('observer');
  registry.register(observer);
  const artifacts = createArtifactsService({
    conversationId: 'web-1',
    initial: [
      buildArtifact({ id: 'F-1', type: 'feature', sections: { overview: 'Why' } }),
      buildArtifact({
        id: 'T-1',
        parentId: 'F-1',
        status: 'done',
        pullRequests: [{ url: 'https://x/pull/1', repository: 'repositories/api', state: 'merged', addedAt: '2026-01-01T00:00:00.000Z' }],
        history: [{ id: 'h', at: '2026-01-01T00:00:00.000Z', actor: { kind: 'system' }, kind: 'updated', summary: 'Done', changes: [{ field: 'status', to: 'done' }] }],
      }),
    ],
  });
  const service = new WebArtifactsService(artifacts.service, store, registry);
  return { service, artifacts, store, observer };
}

const user = { kind: 'user', channel: 'web' } as const;

describe('WebArtifactsService', () => {
  it('should list every artifact of the conversation, closed ones included, without their content', async () => {
    const { service } = setup();

    const listed = await service.list('web-1');

    expect(listed.map(artifact => artifact.id)).toEqual(['F-1', 'T-1']);
    expect(listed[0]).not.toHaveProperty('sections');
    expect(listed[0]).not.toHaveProperty('history');
    expect(listed[1]?.pullRequests).toEqual([{ url: 'https://x/pull/1', repository: 'repositories/api', state: 'merged', addedAt: '2026-01-01T00:00:00.000Z' }]);
    expect(listed[0]).toMatchObject({ projectName: null, projectNames: ['shop'] });
    expect(listed[1]).toMatchObject({ projectName: 'shop', projectNames: ['shop'] });
  });

  it('should read the detail of an artifact, or nothing for an unknown one', async () => {
    const { service } = setup();

    expect(await service.detail('web-1', 'T-1')).toMatchObject({ id: 'T-1', sections: {}, history: [{ changes: [{ field: 'status', to: 'done' }] }] });
    expect(await service.detail('web-1', 'F-1')).toMatchObject({ sections: { overview: 'Why' } });
    expect(await service.detail('web-1', 'T-9')).toBeUndefined();
  });

  it('should create an artifact as the user, the switches choosing which refinements are owed', async () => {
    const { service, artifacts } = setup();

    const result = await service.create('web-1', 'r1', {
      type: 'task',
      title: 'Fix typo',
      parentId: 'F-1',
      dependsOn: ['T-1'],
      sections: { overview: 'Typo' },
      refinements: { business: false },
    });
    const refined = await service.create('web-1', 'r2', { type: 'feature', title: 'Checkout', projectNames: ['web', 'shop'], refinements: { business: true, design: true, technical: true } });

    expect(result).toEqual({ type: 'artifact.result', conversationId: 'web-1', requestId: 'r1', ok: true, id: 'T-2' });
    expect(refined).toMatchObject({ ok: true, id: 'F-2' });
    expect(await artifacts.service.get('web-1', 'T-2')).toMatchObject({
      status: 'ready',
      refinement: { business: 'skipped', design: 'skipped', technical: 'skipped' },
      history: [{ actor: user }],
    });
    expect(await artifacts.service.get('web-1', 'F-2')).toMatchObject({ projectNames: ['web', 'shop'], refinement: { business: 'pending', design: 'pending', technical: 'pending' } });
  });

  it('should update fields and replace sections, comment and delete, answering failures with their reason', async () => {
    const { service, artifacts } = setup();

    expect(await service.update('web-1', 'r', 'F-1', { title: 'Checkout', sections: { overview: '', scope: 'All' } })).toMatchObject({ ok: true, id: 'F-1' });
    expect(await service.update('web-1', 'r', 'F-1', { status: 'in_progress' })).toMatchObject({ ok: true });
    expect(await service.comment('web-1', 'r', 'F-1', 'Nice')).toMatchObject({ ok: true, id: 'F-1' });
    expect(await service.remove('web-1', 'r', 'F-1')).toEqual({ type: 'artifact.result', conversationId: 'web-1', requestId: 'r', ok: false, error: 'F-1 still has T-1 under it: move or delete them first.' });
    expect(await service.remove('web-1', 'r', 'T-1')).toMatchObject({ ok: true, id: 'T-1' });
    expect(await service.comment('web-1', 'r', 'T-1', 'Gone?')).toMatchObject({ ok: false });

    expect(await artifacts.service.get('web-1', 'F-1')).toMatchObject({ title: 'Checkout', status: 'in_progress', sections: { scope: 'All' } });
  });

  it('should broadcast every change of a web conversation until it stops, leaving other channels out', async () => {
    const { service, artifacts, observer } = setup();
    service.onModuleInit();

    await artifacts.service.comment('web-1', 'F-1', 'Hi', user);
    await artifacts.service.remove('web-1', 'T-1', user);
    await artifacts.service.create('discord:1', { type: 'task', title: 'Elsewhere', projectName: 'shop' }, user);
    await rs.waitFor(() => expect(observer.sent).toHaveLength(2));
    service.onModuleDestroy();
    await artifacts.service.comment('web-1', 'F-1', 'Again', user);

    expect(observer.sent).toEqual([
      { type: 'artifact.updated', conversationId: 'web-1', artifact: expect.objectContaining({ id: 'F-1' }) },
      { type: 'artifact.deleted', conversationId: 'web-1', id: 'T-1' },
    ]);
  });

  it.each([new Error('store down'), 'store down'])('should log a broadcast that fails (%#)', async (failure) => {
    rs.useFakeTimers();
    const { service, artifacts, store, observer } = setup();
    store.exists = () => Promise.reject(failure);
    service.onModuleInit();

    await artifacts.service.comment('web-1', 'F-1', 'Hi', user);
    await rs.advanceTimersByTimeAsync(0);
    rs.useRealTimers();

    expect(observer.sent).toEqual([]);
  });
});
