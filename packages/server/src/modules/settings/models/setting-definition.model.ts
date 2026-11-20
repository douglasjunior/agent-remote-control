import type { SettingApply, SettingKey, SettingValues } from '@agent-remote-control/protocol/settings';
import type { z } from 'zod';


/** How the value reads from its environment variable and shows in the web form. */
export type SettingKind = 'boolean' | 'integer' | 'text' | 'choice' | 'secret';

/** The sections of the settings page, in the order it shows them. */
export type SettingGroup = 'general' | 'discord' | 'web' | 'remote' | 'agents' | 'shell' | 'turns' | 'speech';

export type SettingDefinition<Key extends SettingKey = SettingKey> = {
  readonly key: Key;
  /** The environment variable the saved value overrides. */
  readonly env: string;
  readonly schema: z.ZodType<SettingValues[Key], unknown>;
  readonly defaultValue: SettingValues[Key];
  readonly kind: SettingKind;
  readonly group: SettingGroup;
  /** `restart` when the server reads the value only as it starts. */
  readonly apply: SettingApply;
  /** The values a `choice` takes. */
  readonly options?: readonly string[];
};
