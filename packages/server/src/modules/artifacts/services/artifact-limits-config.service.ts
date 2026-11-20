import { Inject, Injectable } from '@nestjs/common';

import { IRuntimeSettingsPort } from '../../settings/ports/runtime-settings.port.js';


@Injectable()
export class ArtifactLimitsConfigService {
  constructor(@Inject(IRuntimeSettingsPort) private readonly settings: IRuntimeSettingsPort) {}

  /**
   * How many delegations an artifact goes through, since it was created or last unfrozen, before the next one
   * freezes it instead: a task that keeps bouncing between agents needs the user. `0` disables the limit.
   */
  getMaxDelegations(): number {
    return this.settings.get('ARTIFACT_MAX_DELEGATIONS');
  }
}
