import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type {
  ArtifactActor,
  ArtifactFieldChange,
  ArtifactHistoryEvent,
  ArtifactHistoryKind,
} from '../models/artifact.model.js';


/** Owns the clock and the ids of the history, so the use cases that record changes stay deterministic under test. */
@Injectable()
export class ArtifactHistoryService {
  now(): string {
    return new Date().toISOString();
  }

  event(
    actor: ArtifactActor,
    kind: ArtifactHistoryKind,
    summary: string,
    details: { readonly changes?: readonly ArtifactFieldChange[]; readonly text?: string } = {},
  ): ArtifactHistoryEvent {
    return {
      id: randomUUID(),
      at: this.now(),
      actor,
      kind,
      summary,
      ...(details.changes && details.changes.length > 0 ? { changes: details.changes } : {}),
      ...(details.text ? { text: details.text } : {}),
    };
  }
}
