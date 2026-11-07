import { describe, expect, it } from 'vitest';

import { StubSpeechToText } from './stub-speech-to-text.js';


describe('StubSpeechToText', () => {
  it('should return programmed transcripts, record calls and fail on demand', async () => {
    const stub = new StubSpeechToText();
    stub.transcripts['/a.ogg'] = 'hello';
    stub.failures['/b.ogg'] = 'broken';

    expect(stub.isEnabled()).toBe(true);
    await expect(stub.transcribe('/a.ogg', { language: 'pt' })).resolves.toBe('hello');
    await expect(stub.transcribe('/c.ogg')).resolves.toBe('');
    await expect(stub.transcribe('/b.ogg')).rejects.toThrow('broken');
    expect(stub.calls[0]).toEqual({ audioPath: '/a.ogg', options: { language: 'pt' } });
  });
});
