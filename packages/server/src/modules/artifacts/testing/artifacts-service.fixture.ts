import { StubWorkspacePort } from '../../workspace/testing/stub-workspace.port.js';
import type { Artifact } from '../models/artifact.model.js';
import { ArtifactEventsService } from '../services/artifact-events.service.js';
import { ArtifactHistoryService } from '../services/artifact-history.service.js';
import { ArtifactLimitsConfigService } from '../services/artifact-limits-config.service.js';
import { ArtifactRulesService } from '../services/artifact-rules.service.js';
import { ArtifactsService } from '../services/artifacts.service.js';
import { AssignArtifactUseCase } from '../use-cases/assign-artifact.use-case.js';
import { CommentOnArtifactUseCase } from '../use-cases/comment-on-artifact.use-case.js';
import { CreateArtifactUseCase } from '../use-cases/create-artifact.use-case.js';
import { DeleteArtifactUseCase } from '../use-cases/delete-artifact.use-case.js';
import { ReleaseArtifactUseCase } from '../use-cases/release-artifact.use-case.js';
import { UpdateArtifactUseCase } from '../use-cases/update-artifact.use-case.js';

import { InMemoryArtifactStoreFake } from './in-memory-artifact-store.fake.js';


/** The real artifacts port over an in-memory store, for consumers that test against the board's actual rules. */
export function createArtifactsService(options: { readonly initial?: readonly Artifact[]; readonly conversationId?: string; readonly folders?: readonly string[] } = {}) {
  const store = new InMemoryArtifactStoreFake(options.initial ?? [], options.conversationId);
  const workspace = new StubWorkspacePort(options.folders ?? ['shop', 'web', 'my-app']);
  const rules = new ArtifactRulesService();
  const history = new ArtifactHistoryService();
  const events = new ArtifactEventsService();
  const service = new ArtifactsService(
    store,
    new CreateArtifactUseCase(store, workspace, rules, history, events),
    new UpdateArtifactUseCase(store, workspace, rules, history, events),
    new CommentOnArtifactUseCase(store, history, events),
    new DeleteArtifactUseCase(store, history, events),
    new AssignArtifactUseCase(store, history, events, new ArtifactLimitsConfigService()),
    new ReleaseArtifactUseCase(store, history, events),
    events,
  );
  return { service, store, workspace };
}
