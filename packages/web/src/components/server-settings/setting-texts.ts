import type { SettingsSectionId } from '../settings-hub/settings-sections.js';


/** How a setting reads in the settings hub; `unit` adds a hint beside its number. */
export type SettingText = {
  readonly label: string;
  readonly description: string;
  readonly unit?: 'days' | 'characters' | 'MB' | 'files';
};

export const GROUP_TITLES: Readonly<Record<string, string>> = {
  general: 'General',
  discord: 'Discord',
  web: 'Web interface',
  remote: 'Remote access',
  agents: 'Agent login',
  shell: 'Shell commands',
  turns: 'Turns and delegations',
  speech: 'Speech-to-text',
};

/** The `general` group of the server holds the language and the session and log options, which sit in two sections. */
export function groupTitle(section: SettingsSectionId, group: string): string {
  return section === 'advanced' && group === 'general' ? 'Sessions and logs' : GROUP_TITLES[group] ?? group;
}

export const SETTING_TEXTS: Readonly<Record<string, SettingText>> = {
  USER_LANGUAGE: {
    label: 'Language',
    description: 'The language agents write to you in. Reset it and the CEO takes it from your next message.',
  },
  DISCORD_ENABLED: {
    label: 'Discord bot',
    description: 'Connects the bot while it has a token. Turn it off to keep the token without connecting.',
  },
  DISCORD_BOT_TOKEN: {
    label: 'Bot token',
    description: 'From the Bot tab of the Discord Developer Portal. It is never shown again once saved.',
  },
  DISCORD_GUILD_ID: {
    label: 'Server ID',
    description: 'Registers the slash commands in this server only. Leave it empty to register them globally.',
  },
  WEB_ALLOWED_ORIGINS: {
    label: 'Allowed origins',
    description: 'Other browser origins that may open the WebSocket, separated by commas. The page\'s own origin always may.',
  },
  WEB_UPLOAD_MAX_MB: {
    label: 'Largest attachment',
    description: 'The biggest file a message from the web may attach, up to 100 MB.',
    unit: 'MB',
  },
  WEB_MAX_ATTACHMENTS: {
    label: 'Attachments per message',
    description: 'How many files a message from the web may attach, up to 50.',
    unit: 'files',
  },
  REMOTE_ENABLED: {
    label: 'Remote access',
    description: 'Reach this server from anywhere through the signaling server below. Turning it off drops the remote browsers.',
  },
  REMOTE_URL: {
    label: 'Signaling server',
    description: 'HTTPS URL of a signaling server you trust: it serves the page that reads your access token.',
  },
  SESSION_IDLE_TIMEOUT_MS: {
    label: 'Idle session timeout',
    description: 'How long a quiet conversation keeps its agents running.',
  },
  QUESTION_TIMEOUT_MS: {
    label: 'Question timeout',
    description: 'How long a question waits for you before its recommended answer is taken. 0 waits for good.',
  },
  LOG_RETENTION_DAYS: { label: 'Log retention', description: 'How long the log files are kept.', unit: 'days' },
  AGENT_AUTH_ENABLED: {
    label: 'Agent login',
    description: 'Log the agent CLIs in from this interface and with /agent-auth on Discord.',
  },
  AGENT_AUTH_LOGIN_TIMEOUT_MS: {
    label: 'Login timeout',
    description: 'How long a login waits to be finished in the browser.',
  },
  AGENT_AUTH_STATUS_TIMEOUT_MS: {
    label: 'Login check timeout',
    description: 'How long a check of the login state may take.',
  },
  SHELL_COMMAND_ENABLED: {
    label: 'Shell commands',
    description: 'Run commands on the host with /shell on Discord. Anyone who reaches the bot can then run any command.',
  },
  SHELL_COMMAND_TIMEOUT_MS: { label: 'Command timeout', description: 'When a shell command is stopped.' },
  SHELL_COMMAND_MAX_OUTPUT_CHARS: {
    label: 'Output limit',
    description: 'How much of a command\'s output is kept, from its end.',
    unit: 'characters',
  },
  TURN_RETRY_BASE_DELAY_MS: {
    label: 'First retry after',
    description: 'The wait before a failed turn is tried again; each retry waits twice as long. 0 turns the retries off.',
  },
  TURN_RETRY_MAX_DELAY_MS: { label: 'Longest wait', description: 'The longest a single wait before a retry gets.' },
  TURN_RETRY_MAX_TOTAL_MS: {
    label: 'Retry for',
    description: 'How long after the first failure the retries go on.',
  },
  ARTIFACT_MAX_DELEGATIONS: {
    label: 'Delegations before freezing',
    description: 'A task that went through this many delegations freezes until you take it out. 0 turns it off.',
  },
  DELEGATION_SPEC_MAX_CHARS: {
    label: 'Specification limit',
    description: 'The longest specification the CEO may write for a task of the board. 0 turns it off.',
    unit: 'characters',
  },
  AGENT_RESULT_MAX_CHARS: {
    label: 'Result limit',
    description: 'The longest result that reaches the CEO whole once its task moved on. 0 turns the cut off.',
    unit: 'characters',
  },
  STT_PROVIDER: {
    label: 'Provider',
    description: 'whisper-cpp transcribes audio on the CPU; none hands the audio to the agent as a file.',
  },
  STT_MODEL: { label: 'Model', description: 'The whisper.cpp model, read as ggml-<name>.bin from the models folder of DATA_DIR.' },
  STT_MODEL_PATH: { label: 'Model file', description: 'A model file of your own; it takes the place of the model name.' },
  STT_LANGUAGE: { label: 'Speech language', description: 'auto detects it, or a two-letter code such as en.' },
  STT_THREADS: { label: 'CPU threads', description: '0 uses every CPU.' },
  STT_TIMEOUT_MS: { label: 'Step timeout', description: 'The longest each transcription step may take.' },
  STT_WHISPER_BIN: { label: 'whisper-cli executable', description: 'Its name on the PATH, or its path.' },
  STT_FFMPEG_BIN: { label: 'ffmpeg executable', description: 'Its name on the PATH, or its path.' },
};

/** A setting this web app does not know yet reads as its key. */
export function settingText(key: string): SettingText {
  return SETTING_TEXTS[key] ?? { label: key, description: '' };
}
