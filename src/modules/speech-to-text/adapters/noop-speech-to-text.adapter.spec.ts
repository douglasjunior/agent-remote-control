import { describe, expect, it } from 'vitest';

import { NoopSpeechToTextAdapter } from './noop-speech-to-text.adapter.js';


describe('NoopSpeechToTextAdapter', () => {
  it('should report itself as disabled and reject transcriptions', async () => {
    const adapter = new NoopSpeechToTextAdapter();

    expect(adapter.isEnabled()).toBe(false);
    await expect(adapter.transcribe()).rejects.toThrow('Speech-to-text is disabled');
  });
});
