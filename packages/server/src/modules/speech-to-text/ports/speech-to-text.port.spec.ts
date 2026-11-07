import { describe, expect, it } from 'vitest';

import { ISpeechToTextPort } from './speech-to-text.port.js';


describe('speech-to-text.port', () => {
  it('should define ISpeechToTextPort symbol for dependency injection', () => {
    expect(typeof ISpeechToTextPort).toBe('symbol');
    expect(ISpeechToTextPort.description).toBe('ISpeechToTextPort');
  });
});
