const HOST_ONLY_ENV_VARS = new Set([
  'DISCORD_BOT_TOKEN',
  'DISCORD_GUILD_ID',
  'WORKSPACE_DIR',
  'DATA_DIR',
  'SESSION_IDLE_TIMEOUT_MS',
  'QUESTION_TIMEOUT_MS',
  'PORT',
  'PWD',
  'OLDPWD',
  'INIT_CWD',
  'PROJECT_CWD',
]);

const HOST_ONLY_ENV_PREFIX = 'npm_';

/**
 * Environment for an agent CLI subprocess without the host application's credentials and
 * directory, with `PWD` pointing at the subprocess `cwd`.
 */
export function buildAgentProcessEnv(cwd: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (HOST_ONLY_ENV_VARS.has(key) || key.startsWith(HOST_ONLY_ENV_PREFIX)) {
      continue;
    }
    env[key] = value;
  }
  env.PWD = cwd;
  return env;
}
