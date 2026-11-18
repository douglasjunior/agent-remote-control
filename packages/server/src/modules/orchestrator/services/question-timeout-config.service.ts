import { Injectable } from '@nestjs/common';

import { readNonNegativeInteger } from '../utils/env-number.util.js';


const DEFAULT_TIMEOUT_MS = 300_000;

@Injectable()
export class QuestionTimeoutConfigService {
  /** How long a question waits for the user before its recommended answer is assumed; `0` disables the timeout. */
  getTimeoutMs(): number {
    return readNonNegativeInteger('QUESTION_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
  }
}
