import { vi } from 'vitest';

import type { QuestionListener } from '../models/question-event.model.js';


export function questionListener(overrides: Partial<QuestionListener> = {}): QuestionListener {
  return { asked: vi.fn(), timedOut: vi.fn(), ...overrides };
}
