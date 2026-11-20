import { useTemporaryDataDir } from '../../../test/temporary-data-dir.js';
import { createTestingModule } from '../../../test/testing-module.js';

import { NoopSpeechToTextAdapter } from './adapters/noop-speech-to-text.adapter.js';
import { WhisperCppAdapter } from './adapters/whisper-cpp.adapter.js';
import { ISpeechToTextPort } from './ports/speech-to-text.port.js';
import { SpeechToTextModule, selectSpeechToTextProvider } from './speech-to-text.module.js';
import { StubSpeechToText } from './testing/stub-speech-to-text.js';


describe('SpeechToTextModule', () => {
  useTemporaryDataDir();

  const resolveProvider = async () => {
    const module = await createTestingModule({ imports: [SpeechToTextModule] }).compile();
    const provider = module.get<unknown>(ISpeechToTextPort);
    await module.close();
    return provider;
  };

  it('should use whisper.cpp when STT_PROVIDER is not set', async () => {
    expect(await resolveProvider()).toBeInstanceOf(WhisperCppAdapter);
  });

  it('should use the noop adapter when STT_PROVIDER is none', async () => {
    rs.stubEnv('STT_PROVIDER', ' None ');

    expect(await resolveProvider()).toBeInstanceOf(NoopSpeechToTextAdapter);
  });

  it('should select a provider by name, and fail with the supported ones for an unknown name', () => {
    const stub = new StubSpeechToText();

    expect(selectSpeechToTextProvider({ stub }, 'stub')).toBe(stub);
    expect(() => selectSpeechToTextProvider({ stub }, 'magic')).toThrow('Unknown STT_PROVIDER "magic". Supported: stub.');
  });
});
