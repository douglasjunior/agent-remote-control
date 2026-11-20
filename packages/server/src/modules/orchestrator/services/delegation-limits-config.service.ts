import { Injectable } from '@nestjs/common';

import { readNonNegativeInteger } from '../utils/env-number.util.js';


const DEFAULT_MAX_SPEC_CHARS = 600;
const DEFAULT_MAX_RESULT_CHARS = 2000;

@Injectable()
export class DelegationLimitsConfigService {
  /** The longest specification the CEO may write for a delegation that names an artifact; `0` disables the limit. */
  getMaxSpecChars(): number {
    return readNonNegativeInteger('DELEGATION_SPEC_MAX_CHARS', DEFAULT_MAX_SPEC_CHARS);
  }

  /** The longest result with a verdict that reaches the CEO whole; `0` disables the cut. */
  getMaxResultChars(): number {
    return readNonNegativeInteger('AGENT_RESULT_MAX_CHARS', DEFAULT_MAX_RESULT_CHARS);
  }
}
