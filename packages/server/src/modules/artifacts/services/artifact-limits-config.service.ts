import { Injectable } from '@nestjs/common';


const DEFAULT_MAX_DELEGATIONS = 25;

@Injectable()
export class ArtifactLimitsConfigService {
  /**
   * How many delegations an artifact goes through, since it was created or last unfrozen, before the next one
   * freezes it instead: a task that keeps bouncing between agents needs the user. `0` disables the limit.
   */
  getMaxDelegations(): number {
    const raw = process.env.ARTIFACT_MAX_DELEGATIONS?.trim();
    if (!raw) {
      return DEFAULT_MAX_DELEGATIONS;
    }
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : DEFAULT_MAX_DELEGATIONS;
  }
}
