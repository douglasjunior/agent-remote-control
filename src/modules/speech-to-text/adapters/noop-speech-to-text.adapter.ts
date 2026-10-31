import { Injectable } from '@nestjs/common';

import type { ISpeechToTextPort } from '../ports/speech-to-text.port.js';


@Injectable()
export class NoopSpeechToTextAdapter implements ISpeechToTextPort {
  isEnabled(): boolean {
    return false;
  }

  async transcribe(): Promise<string> {
    throw new Error('Speech-to-text is disabled (STT_PROVIDER=none).');
  }
}
