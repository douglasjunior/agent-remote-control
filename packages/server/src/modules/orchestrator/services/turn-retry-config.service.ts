import { Injectable } from '@nestjs/common';

import { readNonNegativeInteger } from '../utils/env-number.util.js';
import type { RetryPolicy } from '../utils/retry-delay.util.js';


const DEFAULT_BASE_DELAY_MS = 15_000;
const DEFAULT_MAX_DELAY_MS = 7_200_000;
const DEFAULT_MAX_TOTAL_MS = 18_000_000;

@Injectable()
export class TurnRetryConfigService {
  /** `TURN_RETRY_BASE_DELAY_MS`, `TURN_RETRY_MAX_DELAY_MS` and `TURN_RETRY_MAX_TOTAL_MS`; `0` in any of them disables the retries. */
  getPolicy(): RetryPolicy {
    return {
      baseDelayMs: readNonNegativeInteger('TURN_RETRY_BASE_DELAY_MS', DEFAULT_BASE_DELAY_MS),
      maxDelayMs: readNonNegativeInteger('TURN_RETRY_MAX_DELAY_MS', DEFAULT_MAX_DELAY_MS),
      maxTotalMs: readNonNegativeInteger('TURN_RETRY_MAX_TOTAL_MS', DEFAULT_MAX_TOTAL_MS),
    };
  }
}
