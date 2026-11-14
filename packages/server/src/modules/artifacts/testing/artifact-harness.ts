import { StubWorkspacePort } from '../../workspace/testing/stub-workspace.port.js';
import type { Artifact, ArtifactChangeEvent } from '../models/artifact.model.js';
import { ArtifactEventsService } from '../services/artifact-events.service.js';
import { ArtifactHistoryService } from '../services/artifact-history.service.js';
import { ArtifactRulesService } from '../services/artifact-rules.service.js';

import { InMemoryArtifactStoreFake } from './in-memory-artifact-store.fake.js';


/** A fake store with the real rules, history and events, recording every change event published, over a workspace with the `shop` and `web` projects. */
export function createArtifactHarness(initial: readonly Artifact[] = []) {
  const store = new InMemoryArtifactStoreFake(initial);
  const events = new ArtifactEventsService();
  const published: ArtifactChangeEvent[] = [];
  events.subscribe(event => published.push(event));
  const workspace = new StubWorkspacePort(['shop', 'web']);
  return { store, events, published, workspace, rules: new ArtifactRulesService(), history: new ArtifactHistoryService() };
}
