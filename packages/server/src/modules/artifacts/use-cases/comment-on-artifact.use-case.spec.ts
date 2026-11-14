import { describe, expect, it } from 'vitest';

import { createArtifactHarness } from '../testing/artifact-harness.js';
import { buildArtifact } from '../testing/artifact.fixture.js';

import { CommentOnArtifactUseCase } from './comment-on-artifact.use-case.js';


const actor = { kind: 'agent', role: 'CEO', roleName: 'CEO' } as const;

describe('CommentOnArtifactUseCase', () => {
  it('records the comment in the history and publishes the artifact', async () => {
    const harness = createArtifactHarness([buildArtifact({ id: 'T-1' })]);
    const useCase = new CommentOnArtifactUseCase(harness.store, harness.history, harness.events);

    const outcome = await useCase.execute('c1', 'T-1', '  Review approved  ', actor);

    expect(outcome).toMatchObject({ ok: true, artifact: { history: [{ kind: 'commented', actor, summary: 'Commented', text: 'Review approved' }] } });
    expect(harness.published).toHaveLength(1);
  });

  it.each([
    ['T-1', ' ', 'A comment needs text.'],
    ['T-9', 'Hi', 'Unknown artifact "T-9".'],
  ])('refuses %s with %j', async (id, text, error) => {
    const harness = createArtifactHarness([buildArtifact({ id: 'T-1' })]);
    const useCase = new CommentOnArtifactUseCase(harness.store, harness.history, harness.events);

    expect(await useCase.execute('c1', id, text, actor)).toEqual({ ok: false, error });
    expect(harness.published).toEqual([]);
  });
});
