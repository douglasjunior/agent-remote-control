import { SETTING_SCHEMAS, type SettingKey } from '@agent-remote-control/protocol/settings';

import type { SettingDefinition } from '../models/setting-definition.model.js';


type Details<Key extends SettingKey> = Omit<SettingDefinition<Key>, 'key' | 'env' | 'schema'>;

function define<Key extends SettingKey>(key: Key, details: Details<Key>): SettingDefinition<Key> {
  return { key, env: key, schema: SETTING_SCHEMAS[key] as unknown as SettingDefinition<Key>['schema'], ...details };
}

/**
 * Every setting the settings page shows, in the order it shows them. Each one overrides the environment variable named
 * by `env`, except those marked `envOnly`: they widen what the server exposes or which programs it runs, so only the
 * environment sets them and the page shows their value. Boot-only infrastructure (`PORT`, `DATA_DIR`, `WORKSPACE_DIR`,
 * `WEB_ENABLED`, `WEB_STATIC_DIR`, `WEB_ACCESS_TOKEN`) stays out: it decides how the server starts and where it keeps
 * the very database the settings live in.
 */
export const SETTINGS_CATALOG: { readonly [Key in SettingKey]: SettingDefinition<Key> } = {
  DISCORD_ENABLED: define('DISCORD_ENABLED', { kind: 'boolean', group: 'discord', apply: 'live', defaultValue: true }),
  DISCORD_BOT_TOKEN: define('DISCORD_BOT_TOKEN', { kind: 'secret', group: 'discord', apply: 'live', defaultValue: '' }),
  DISCORD_GUILD_ID: define('DISCORD_GUILD_ID', { kind: 'text', group: 'discord', apply: 'live', defaultValue: '' }),
  WEB_ALLOWED_ORIGINS: define('WEB_ALLOWED_ORIGINS', { envOnly: true, kind: 'text', group: 'web', apply: 'live', defaultValue: '' }),
  WEB_UPLOAD_MAX_MB: define('WEB_UPLOAD_MAX_MB', { kind: 'integer', group: 'web', apply: 'live', defaultValue: 10 }),
  WEB_MAX_ATTACHMENTS: define('WEB_MAX_ATTACHMENTS', { kind: 'integer', group: 'web', apply: 'live', defaultValue: 10 }),
  REMOTE_ENABLED: define('REMOTE_ENABLED', { kind: 'boolean', group: 'remote', apply: 'live', defaultValue: false }),
  REMOTE_URL: define('REMOTE_URL', { envOnly: true, kind: 'text', group: 'remote', apply: 'live', defaultValue: '' }),
  SESSION_IDLE_TIMEOUT_MS: define('SESSION_IDLE_TIMEOUT_MS', { kind: 'integer', group: 'general', apply: 'live', defaultValue: 1_800_000 }),
  QUESTION_TIMEOUT_MS: define('QUESTION_TIMEOUT_MS', { kind: 'integer', group: 'general', apply: 'live', defaultValue: 300_000 }),
  LOG_RETENTION_DAYS: define('LOG_RETENTION_DAYS', { kind: 'integer', group: 'general', apply: 'live', defaultValue: 14 }),
  AGENT_AUTH_ENABLED: define('AGENT_AUTH_ENABLED', { kind: 'boolean', group: 'agents', apply: 'live', defaultValue: true }),
  AGENT_AUTH_LOGIN_TIMEOUT_MS: define('AGENT_AUTH_LOGIN_TIMEOUT_MS', { kind: 'integer', group: 'agents', apply: 'live', defaultValue: 900_000 }),
  AGENT_AUTH_STATUS_TIMEOUT_MS: define('AGENT_AUTH_STATUS_TIMEOUT_MS', { kind: 'integer', group: 'agents', apply: 'live', defaultValue: 10_000 }),
  SHELL_COMMAND_ENABLED: define('SHELL_COMMAND_ENABLED', { envOnly: true, kind: 'boolean', group: 'shell', apply: 'live', defaultValue: false }),
  SHELL_COMMAND_TIMEOUT_MS: define('SHELL_COMMAND_TIMEOUT_MS', { kind: 'integer', group: 'shell', apply: 'live', defaultValue: 60_000 }),
  SHELL_COMMAND_MAX_OUTPUT_CHARS: define('SHELL_COMMAND_MAX_OUTPUT_CHARS', { kind: 'integer', group: 'shell', apply: 'live', defaultValue: 8_000 }),
  TURN_RETRY_BASE_DELAY_MS: define('TURN_RETRY_BASE_DELAY_MS', { kind: 'integer', group: 'turns', apply: 'live', defaultValue: 15_000 }),
  TURN_RETRY_MAX_DELAY_MS: define('TURN_RETRY_MAX_DELAY_MS', { kind: 'integer', group: 'turns', apply: 'live', defaultValue: 7_200_000 }),
  TURN_RETRY_MAX_TOTAL_MS: define('TURN_RETRY_MAX_TOTAL_MS', { kind: 'integer', group: 'turns', apply: 'live', defaultValue: 18_000_000 }),
  ARTIFACT_MAX_DELEGATIONS: define('ARTIFACT_MAX_DELEGATIONS', { kind: 'integer', group: 'turns', apply: 'live', defaultValue: 25 }),
  DELEGATION_SPEC_MAX_CHARS: define('DELEGATION_SPEC_MAX_CHARS', { kind: 'integer', group: 'turns', apply: 'live', defaultValue: 600 }),
  AGENT_RESULT_MAX_CHARS: define('AGENT_RESULT_MAX_CHARS', { kind: 'integer', group: 'turns', apply: 'live', defaultValue: 2_000 }),
  /** The speech-to-text module picks its adapter once, when the server starts. */
  STT_PROVIDER: define('STT_PROVIDER', {
    kind: 'choice',
    group: 'speech',
    apply: 'restart',
    defaultValue: 'whisper-cpp',
    options: SETTING_SCHEMAS.STT_PROVIDER.options,
  }),
  STT_MODEL: define('STT_MODEL', { kind: 'text', group: 'speech', apply: 'live', defaultValue: 'small' }),
  STT_MODEL_PATH: define('STT_MODEL_PATH', { kind: 'text', group: 'speech', apply: 'live', defaultValue: '' }),
  STT_LANGUAGE: define('STT_LANGUAGE', { kind: 'text', group: 'speech', apply: 'live', defaultValue: 'auto' }),
  STT_THREADS: define('STT_THREADS', { kind: 'integer', group: 'speech', apply: 'live', defaultValue: 0 }),
  STT_TIMEOUT_MS: define('STT_TIMEOUT_MS', { kind: 'integer', group: 'speech', apply: 'live', defaultValue: 300_000 }),
  STT_WHISPER_BIN: define('STT_WHISPER_BIN', { envOnly: true, kind: 'text', group: 'speech', apply: 'live', defaultValue: 'whisper-cli' }),
  STT_FFMPEG_BIN: define('STT_FFMPEG_BIN', { envOnly: true, kind: 'text', group: 'speech', apply: 'live', defaultValue: 'ffmpeg' }),
};

export const SETTING_KEYS = Object.keys(SETTINGS_CATALOG) as SettingKey[];
