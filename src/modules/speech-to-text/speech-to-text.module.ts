import { Module } from '@nestjs/common';

import { AgentModule } from '../agent/agent.module.js';

import { NoopSpeechToTextAdapter } from './adapters/noop-speech-to-text.adapter.js';
import { WhisperCppAdapter } from './adapters/whisper-cpp.adapter.js';
import { ISpeechToTextPort } from './ports/speech-to-text.port.js';


const DEFAULT_PROVIDER = 'whisper-cpp';

/** Picks the adapter named by STT_PROVIDER; supporting a new provider means adding an entry here. */
export function selectSpeechToTextProvider(
  providers: Readonly<Record<string, ISpeechToTextPort>>,
  name = process.env.STT_PROVIDER?.trim().toLowerCase() || DEFAULT_PROVIDER,
): ISpeechToTextPort {
  const provider = providers[name];
  if (!provider) {
    throw new Error(`Unknown STT_PROVIDER "${name}". Supported: ${Object.keys(providers).join(', ')}.`);
  }
  return provider;
}

@Module({
  imports: [AgentModule],
  providers: [
    WhisperCppAdapter,
    NoopSpeechToTextAdapter,
    {
      provide: ISpeechToTextPort,
      useFactory: (whisperCpp: WhisperCppAdapter, none: NoopSpeechToTextAdapter) =>
        selectSpeechToTextProvider({ 'whisper-cpp': whisperCpp, none }),
      inject: [WhisperCppAdapter, NoopSpeechToTextAdapter],
    },
  ],
  exports: [ISpeechToTextPort],
})
export class SpeechToTextModule {}
