import { z } from 'zod';

import { trustedSignalingBaseUrl } from './remote-link.js';


const positiveInteger = z.number().int('Use a whole number').min(1, 'Use a number above 0').max(Number.MAX_SAFE_INTEGER);
/** `0` turns off the limit or the feature the setting bounds. */
const nonNegativeInteger = z.number().int('Use a whole number').min(0, 'Use 0 or more').max(Number.MAX_SAFE_INTEGER);
const executable = z.string().trim().min(1, 'Name the executable or its path');

const origins = z.string().trim().refine(
  text => text.split(',').map(origin => origin.trim()).filter(Boolean).every((origin) => {
    try {
      return new URL(origin).origin === origin.replace(/\/+$/, '');
    } catch {
      return false;
    }
  }),
  'List origins such as https://arc.example.com, separated by commas',
);

/**
 * The value each setting takes, by the name of the environment variable it overrides. The server checks every change
 * with these schemas, and the web app checks the form with them.
 */
export const SETTING_SCHEMAS = {
  DISCORD_ENABLED: z.boolean(),
  DISCORD_BOT_TOKEN: z.string().trim().max(200, 'A bot token is shorter'),
  DISCORD_GUILD_ID: z.string().trim().regex(/^(\d{17,20})?$/, 'A server ID is a number of 17 to 20 digits'),
  WEB_ALLOWED_ORIGINS: origins,
  REMOTE_ENABLED: z.boolean(),
  REMOTE_URL: z.string().trim().refine(
    text => text === '' || trustedSignalingBaseUrl(text) !== null,
    'Use the HTTPS URL of a signaling server (HTTP only for localhost)',
  ),
  SESSION_IDLE_TIMEOUT_MS: positiveInteger,
  QUESTION_TIMEOUT_MS: nonNegativeInteger,
  LOG_RETENTION_DAYS: positiveInteger,
  AGENT_AUTH_ENABLED: z.boolean(),
  AGENT_AUTH_LOGIN_TIMEOUT_MS: positiveInteger,
  AGENT_AUTH_STATUS_TIMEOUT_MS: positiveInteger,
  SHELL_COMMAND_ENABLED: z.boolean(),
  SHELL_COMMAND_TIMEOUT_MS: positiveInteger,
  SHELL_COMMAND_MAX_OUTPUT_CHARS: positiveInteger,
  TURN_RETRY_BASE_DELAY_MS: nonNegativeInteger,
  TURN_RETRY_MAX_DELAY_MS: nonNegativeInteger,
  TURN_RETRY_MAX_TOTAL_MS: nonNegativeInteger,
  ARTIFACT_MAX_DELEGATIONS: nonNegativeInteger,
  DELEGATION_SPEC_MAX_CHARS: nonNegativeInteger,
  AGENT_RESULT_MAX_CHARS: nonNegativeInteger,
  STT_PROVIDER: z.enum(['whisper-cpp', 'none']),
  STT_MODEL: z.string().trim().regex(/^[\w.-]+$/, 'Use a model name such as small or large-v3'),
  STT_MODEL_PATH: z.string().trim(),
  STT_LANGUAGE: z.string().trim().regex(/^(auto|[a-z]{2})$/, 'Use auto or a two-letter language code such as en'),
  /** `0` uses every CPU. */
  STT_THREADS: nonNegativeInteger,
  STT_TIMEOUT_MS: positiveInteger,
  STT_WHISPER_BIN: executable,
  STT_FFMPEG_BIN: executable,
};

export type SettingKey = keyof typeof SETTING_SCHEMAS;
export type SettingValues = { [Key in SettingKey]: z.infer<(typeof SETTING_SCHEMAS)[Key]> };

/** The language agents write to the user in, kept with the preferences rather than the settings, so it has no variable. */
export const USER_LANGUAGE_KEY = 'USER_LANGUAGE';
export const userLanguageSchema = z.string()
  .transform(text => text.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1, 'Name a language').max(64, 'A language name is shorter').regex(/^[^<>[\]`]*$/, 'Leave out < > [ ] and backticks'));

/** `live` applies at once; `restart` applies when the server starts again. */
export const settingApplySchema = z.enum(['live', 'restart']);
export type SettingApply = z.infer<typeof settingApplySchema>;

/** Where the value in use comes from: saved from the web, an environment variable, or the default. */
export const settingSourceSchema = z.enum(['saved', 'env', 'default']);
export type SettingSource = z.infer<typeof settingSourceSchema>;

/** A key or a group this web app does not know still parses, so a newer server does not break the page. */
const settingBase = {
  key: z.string(),
  group: z.string(),
  apply: settingApplySchema,
  source: settingSourceSchema,
  /** The environment variable of the setting; absent when it has none, like the user language. */
  env: z.string().optional(),
  /** `true` when only the environment variable sets it: the page shows the value and takes no change. */
  envOnly: z.boolean(),
};

/** A setting as the server shows it; a secret says only whether it holds a value, never the value. */
export const settingViewSchema = z.discriminatedUnion('kind', [
  z.object({ ...settingBase, kind: z.literal('boolean'), value: z.boolean(), defaultValue: z.boolean() }),
  z.object({ ...settingBase, kind: z.literal('integer'), value: z.number(), defaultValue: z.number() }),
  z.object({ ...settingBase, kind: z.literal('text'), value: z.string(), defaultValue: z.string() }),
  z.object({
    ...settingBase,
    kind: z.literal('choice'),
    value: z.string(),
    defaultValue: z.string(),
    options: z.array(z.string()),
  }),
  z.object({ ...settingBase, kind: z.literal('secret'), value: z.object({ set: z.boolean() }) }),
]);
export type SettingView = z.infer<typeof settingViewSchema>;
