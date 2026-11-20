import { describe, expect, it } from '@rstest/core';

import type { Artifact } from '../../artifacts/models/artifact.model.js';
import { ARTIFACT_AT, buildArtifact } from '../../artifacts/testing/artifact.fixture.js';
import { createArtifactsService } from '../../artifacts/testing/artifacts-service.fixture.js';

import { ArtifactPromptFormatterService } from './artifact-prompt-formatter.service.js';
import { CeoBoardService } from './ceo-board.service.js';


function setup(initial: readonly Artifact[]) {
  const { service } = createArtifactsService({ initial, conversationId: 'c1' });
  return new CeoBoardService(service, new ArtifactPromptFormatterService());
}

describe('CeoBoardService', () => {
  describe('buildPrompt', () => {
    it('should write the digest of the whole board in a [BOARD] block', async () => {
      const board = setup([
        buildArtifact({ id: 'T-1', title: 'Login', status: 'in_progress' }),
        buildArtifact({ id: 'T-2', status: 'done' }),
      ]);

      expect(await board.buildPrompt('c1')).toBe('[BOARD]\n- T-1 [task] "Login" · status: in_progress · project: shop\n');
    });

    it('should say the board has nothing open when it is empty', async () => {
      expect(await setup([]).buildPrompt('c1')).toBe('[BOARD]\nNo open artifact.\n');
    });
  });

  describe('findStranded', () => {
    const held = { role: 'DEVELOPER', roleName: 'Developer', delegationId: 'd', since: ARTIFACT_AT };

    it('should find the tasks in the middle of the flow that nobody holds', async () => {
      const board = setup([
        buildArtifact({ id: 'F-1', type: 'feature', status: 'in_progress' }),
        buildArtifact({ id: 'T-1', title: 'Login', parentId: 'F-1', status: 'in_review' }),
        buildArtifact({ id: 'T-2', parentId: 'F-1', status: 'approved', assignee: held }),
        buildArtifact({ id: 'T-3', status: 'ready' }),
        buildArtifact({ id: 'T-4', status: 'blocked' }),
        buildArtifact({ id: 'T-5', status: 'done' }),
        buildArtifact({ id: 'T-6', title: 'Cart', status: 'changes_requested' }),
      ]);

      expect(await board.findStranded('c1', 'All done.')).toEqual([
        { id: 'T-1', title: 'Login', status: 'in_review' },
        { id: 'T-6', title: 'Cart', status: 'changes_requested' },
      ]);
    });

    it('should leave out the tasks the answer names, as whole ids', async () => {
      const board = setup([
        buildArtifact({ id: 'T-1', status: 'in_testing' }),
        buildArtifact({ id: 'T-10', status: 'in_progress' }),
      ]);

      expect(await board.findStranded('c1', 'T-10 waits for your merge.')).toEqual([{ id: 'T-1', title: 'Artifact T-1', status: 'in_testing' }]);
      expect(await board.findStranded('c1', 't-1 and T-10 wait for you.')).toEqual([]);
    });
  });
});
