import { Injectable } from '@nestjs/common';


const DEFAULT_TIMEOUT_MS = 300_000;

@Injectable()
export class QuestionTimeoutConfigService {
  /** How long a question waits for the user before its recommended answer is assumed; `0` disables the timeout. */
  getTimeoutMs(): number {
    const raw = process.env.QUESTION_TIMEOUT_MS?.trim();
    if (!raw) {
      return DEFAULT_TIMEOUT_MS;
    }
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : DEFAULT_TIMEOUT_MS;
  }
}
