import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { NoopSpeechToTextAdapter } from './adapters/noop-speech-to-text.adapter.js';
import { WhisperCppAdapter } from './adapters/whisper-cpp.adapter.js';
import { ISpeechToTextPort } from './ports/speech-to-text.port.js';
import { SpeechToTextModule, selectSpeechToTextProvider } from './speech-to-text.module.js';
import { StubSpeechToText } from './testing/stub-speech-to-text.js';


describe('SpeechToTextModule', () => {
  const original = process.env.STT_PROVIDER;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.STT_PROVIDER;
    } else {
      process.env.STT_PROVIDER = original;
    }
  });

  const resolveProvider = async () => {
    const module = await Test.createTestingModule({ imports: [SpeechToTextModule] }).compile();
    return module.get<unknown>(ISpeechToTextPort);
  };

  it('should use whisper.cpp when STT_PROVIDER is not set', async () => {
    delete process.env.STT_PROVIDER;

    expect(await resolveProvider()).toBeInstanceOf(WhisperCppAdapter);
  });

  it('should use the noop adapter when STT_PROVIDER is none', async () => {
    process.env.STT_PROVIDER = ' None ';

    expect(await resolveProvider()).toBeInstanceOf(NoopSpeechToTextAdapter);
  });

  it('should fail with the supported providers when STT_PROVIDER is unknown', async () => {
    process.env.STT_PROVIDER = 'magic';

    await expect(resolveProvider()).rejects.toThrow('Unknown STT_PROVIDER "magic". Supported: whisper-cpp, none.');
  });

  it('should select a provider by explicit name', () => {
    const stub = new StubSpeechToText();

    expect(selectSpeechToTextProvider({ stub }, 'stub')).toBe(stub);
  });
});
