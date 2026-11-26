import type { ServerEvent } from '@agent-remote-control/protocol/server-event';
import { USER_LANGUAGE_KEY, userLanguageSchema, type SettingView } from '@agent-remote-control/protocol/settings';
import { Inject, Injectable } from '@nestjs/common';

import { TestDiscordConnectionUseCase, type TestDiscordConnectionInput } from '../../discord/use-cases/test-discord-connection.use-case.js';
import { IAgentConfigurationPort } from '../../orchestrator/ports/agent-configuration.port.js';
import { ChangeSettingsUseCase } from '../../settings/use-cases/change-settings.use-case.js';
import { GetSettingsUseCase } from '../../settings/use-cases/get-settings.use-case.js';

import { WebConnectionRegistryService } from './web-connection-registry.service.js';


type SettingsEvent = Extract<ServerEvent, { type: 'settings' }>;
type DiscordTestEvent = Extract<ServerEvent, { type: 'settings.discord.test.result' }>;
type Outcome = { readonly ok: true } | { readonly ok: false; readonly error: string };

/** While no language is stored, the CEO takes it from the user's first message and agents write in English until then. */
const DEFAULT_LANGUAGE = 'English';

/**
 * The settings page: the runtime settings plus the user language, which lives with the preferences and has no
 * environment variable. A change is broadcast to every connection, so every open settings page shows it.
 */
@Injectable()
export class WebSettingsService {
  constructor(
    private readonly getSettings: GetSettingsUseCase,
    private readonly changeSettings: ChangeSettingsUseCase,
    private readonly testDiscordConnection: TestDiscordConnectionUseCase,
    @Inject(IAgentConfigurationPort) private readonly configuration: IAgentConfigurationPort,
    private readonly registry: WebConnectionRegistryService,
  ) {}

  async settings(): Promise<SettingsEvent> {
    return { type: 'settings', settings: [await this.languageView(), ...this.getSettings.execute()] };
  }

  /** Checks the language and every other value before saving any of them. */
  async set(changes: Readonly<Record<string, unknown>>): Promise<Outcome> {
    const { [USER_LANGUAGE_KEY]: language, ...values } = changes;
    if (language !== undefined) {
      const parsed = userLanguageSchema.safeParse(language);
      if (!parsed.success) {
        return { ok: false, error: `${USER_LANGUAGE_KEY}: ${parsed.error.issues[0].message}` };
      }
    }
    const result = await this.changeSettings.execute({ values });
    if (!result.ok) {
      return result;
    }
    if (language !== undefined) {
      await this.configuration.setLanguage(language as string);
    }
    await this.publish();
    return { ok: true };
  }

  async reset(keys: readonly string[]): Promise<Outcome> {
    const others = keys.filter(key => key !== USER_LANGUAGE_KEY);
    const result = await this.changeSettings.execute({ reset: others });
    if (!result.ok) {
      return result;
    }
    if (others.length < keys.length) {
      await this.configuration.resetLanguage();
    }
    await this.publish();
    return { ok: true };
  }

  async testDiscord(input: TestDiscordConnectionInput): Promise<DiscordTestEvent> {
    return { type: 'settings.discord.test.result', ...await this.testDiscordConnection.execute(input) };
  }

  private async publish(): Promise<void> {
    this.registry.broadcast(await this.settings());
  }

  private async languageView(): Promise<SettingView> {
    const stored = await this.configuration.getStoredLanguage();
    return {
      key: USER_LANGUAGE_KEY,
      group: 'general',
      apply: 'live',
      envOnly: false,
      source: stored ? 'saved' : 'default',
      kind: 'text',
      value: stored ?? DEFAULT_LANGUAGE,
      defaultValue: DEFAULT_LANGUAGE,
    };
  }
}
