import { Injectable } from '@nestjs/common';

import { readNonNegativeInteger } from '../utils/env-number.util.js';


const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 15_000;

export type AgentRetryPolicy = {
  /** How many times a failed prompt is sent again; `0` disables the retry. */
  readonly maxRetries: number;
  /** The wait before the first retry; each one after it waits twice as long as the one before. */
  readonly baseDelayMs: number;
};

@Injectable()
export class AgentRetryConfigService {
  getPolicy(): AgentRetryPolicy {
    return {
      maxRetries: readNonNegativeInteger('AGENT_MAX_RETRIES', DEFAULT_MAX_RETRIES),
      baseDelayMs: readNonNegativeInteger('AGENT_RETRY_DELAY_MS', DEFAULT_BASE_DELAY_MS),
    };
  }
}
