import { Inject, Injectable } from '@nestjs/common';

import { IPreferencesStorePort } from '../ports/preferences-store.port.js';
import { DEFAULT_USER_LANGUAGE } from '../prompts/user-language.prompt.js';
import { normalizeUserLanguage } from '../utils/user-language.util.js';


/** The language agents use to talk to the user. */
@Injectable()
export class UserLanguageService {
  constructor(@Inject(IPreferencesStorePort) private readonly preferencesStore: IPreferencesStorePort) {}

  async get(): Promise<string> {
    return (await this.getStored()) ?? DEFAULT_USER_LANGUAGE;
  }

  async getStored(): Promise<string | undefined> {
    return (await this.preferencesStore.load()).language;
  }

  /** Stores the language and returns it as normalized; `undefined` when the input is not a valid language. */
  async set(input: string): Promise<string | undefined> {
    const language = normalizeUserLanguage(input);
    if (language) {
      await this.preferencesStore.update(() => ({ language }));
    }
    return language;
  }

  async reset(): Promise<void> {
    await this.preferencesStore.update(current => (current.language ? { language: undefined } : undefined));
  }
}
