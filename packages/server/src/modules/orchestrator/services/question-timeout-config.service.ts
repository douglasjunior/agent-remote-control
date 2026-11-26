import { Inject, Injectable } from '@nestjs/common';

import { IRuntimeSettingsPort } from '../../settings/ports/runtime-settings.port.js';


@Injectable()
export class QuestionTimeoutConfigService {
  constructor(@Inject(IRuntimeSettingsPort) private readonly settings: IRuntimeSettingsPort) {}

  /** How long a question waits for the user before its recommended answer is assumed; `0` disables the timeout. */
  getTimeoutMs(): number {
    return this.settings.get('QUESTION_TIMEOUT_MS');
  }
}
