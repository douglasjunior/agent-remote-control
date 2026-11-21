import { InMemorySquadStoreFake } from './in-memory-squad-store.fake.js';
import { buildStubProfile } from './stub-agent-settings-store.js';


describe('InMemorySquadStoreFake', () => {
  const draft = { name: 'Backend', isDefault: true, profiles: { CEO: buildStubProfile('stub') } };

  it('should keep names unique in any letter case and one default at most', async () => {
    const store = new InMemorySquadStoreFake();
    const first = await store.save(draft);
    const second = await store.save({ ...draft, name: 'Data' });

    expect(await store.save({ ...draft, name: 'BACKEND' })).toEqual({ ok: false, reason: 'name-taken' });
    expect(await store.save({ ...draft, id: 'ghost' })).toEqual({ ok: false, reason: 'not-found' });
    expect((await store.list()).map(squad => [squad.name, squad.isDefault])).toEqual([['Backend', false], ['Data', true]]);
    await expect(store.findDefault()).resolves.toEqual(second.ok && second.squad);
    expect(first.ok && second.ok && first.squad.id !== second.squad.id).toBe(true);
    await expect(store.get('ghost')).resolves.toBeNull();
  });
});
