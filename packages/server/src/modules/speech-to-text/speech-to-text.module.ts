import { Module } from '@nestjs/common';

import { AgentModule } from '../agent/agent.module.js';
import { PathsModule } from '../paths/paths.module.js';
import { IRuntimeSettingsPort } from '../settings/ports/runtime-settings.port.js';
import { SettingsModule } from '../settings/settings.module.js';

import { NoopSpeechToTextAdapter } from './adapters/noop-speech-to-text.adapter.js';
import { WhisperCppAdapter } from './adapters/whisper-cpp.adapter.js';
import { ISpeechToTextPort } from './ports/speech-to-text.port.js';


/**
 * Picks the adapter named by STT_PROVIDER, once, as the server starts; supporting a new provider means adding an entry
 * here and its name to the setting's schema.
 */
export function selectSpeechToTextProvider(providers: Readonly<Record<string, ISpeechToTextPort>>, name: string): ISpeechToTextPort {
  const provider = providers[name];
  if (!provider) {
    throw new Error(`Unknown STT_PROVIDER "${name}". Supported: ${Object.keys(providers).join(', ')}.`);
  }
  return provider;
}

@Module({
  imports: [AgentModule, PathsModule, SettingsModule],
  providers: [
    WhisperCppAdapter,
    NoopSpeechToTextAdapter,
    {
      provide: ISpeechToTextPort,
      useFactory: (whisperCpp: WhisperCppAdapter, none: NoopSpeechToTextAdapter, settings: IRuntimeSettingsPort) =>
        selectSpeechToTextProvider({ 'whisper-cpp': whisperCpp, none }, settings.get('STT_PROVIDER')),
      inject: [WhisperCppAdapter, NoopSpeechToTextAdapter, IRuntimeSettingsPort],
    },
  ],
  exports: [ISpeechToTextPort],
})
export class SpeechToTextModule {}
