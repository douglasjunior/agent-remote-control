import { Injectable, Logger } from '@nestjs/common';

import type { ArtifactChangeEvent } from '../models/artifact.model.js';


@Injectable()
export class ArtifactEventsService {
  private readonly logger = new Logger(ArtifactEventsService.name);
  private readonly listeners = new Set<(event: ArtifactChangeEvent) => void>();

  subscribe(listener: (event: ArtifactChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** A failing listener is logged and never keeps the others from hearing the change. */
  publish(events: readonly ArtifactChangeEvent[]): void {
    for (const event of events) {
      for (const listener of this.listeners) {
        try {
          listener(event);
        } catch (error) {
          this.logger.error(`artifact_listener_failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }
}
