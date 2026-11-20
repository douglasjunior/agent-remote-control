import { Inject, Injectable } from '@nestjs/common';

import { IRuntimeSettingsPort } from '../../settings/ports/runtime-settings.port.js';
import type { RetryPolicy } from '../utils/retry-delay.util.js';


@Injectable()
export class TurnRetryConfigService {
  constructor(@Inject(IRuntimeSettingsPort) private readonly settings: IRuntimeSettingsPort) {}

  /** `TURN_RETRY_BASE_DELAY_MS`, `TURN_RETRY_MAX_DELAY_MS` and `TURN_RETRY_MAX_TOTAL_MS`; `0` in any of them disables the retries. */
  getPolicy(): RetryPolicy {
    return {
      baseDelayMs: this.settings.get('TURN_RETRY_BASE_DELAY_MS'),
      maxDelayMs: this.settings.get('TURN_RETRY_MAX_DELAY_MS'),
      maxTotalMs: this.settings.get('TURN_RETRY_MAX_TOTAL_MS'),
    };
  }
}
