import { Inject, Injectable } from '@nestjs/common';

import { IRuntimeSettingsPort } from '../../settings/ports/runtime-settings.port.js';


@Injectable()
export class DelegationLimitsConfigService {
  constructor(@Inject(IRuntimeSettingsPort) private readonly settings: IRuntimeSettingsPort) {}

  /** The longest specification the CEO may write for a delegation that names an artifact; `0` disables the limit. */
  getMaxSpecChars(): number {
    return this.settings.get('DELEGATION_SPEC_MAX_CHARS');
  }

  /** The longest result with a verdict that reaches the CEO whole; `0` disables the cut. */
  getMaxResultChars(): number {
    return this.settings.get('AGENT_RESULT_MAX_CHARS');
  }
}
