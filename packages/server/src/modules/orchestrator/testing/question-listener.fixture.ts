import { rs } from '@rstest/core';

import type { QuestionListener } from '../models/question-event.model.js';


export function questionListener(overrides: Partial<QuestionListener> = {}): QuestionListener {
  return { asked: rs.fn(), timedOut: rs.fn(), ...overrides };
}
