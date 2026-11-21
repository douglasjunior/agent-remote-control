import { ConfigModule } from '@nestjs/config';

import { resolveFromRepositoryRoot } from './repository-root.util.js';


/**
 * Loads the root `.env` into `process.env`, where a variable already set wins, even when set to an empty text: an
 * empty `DISCORD_BOT_TOKEN=` in the environment keeps the bot off whatever the file says. `dotenv-expand` writes the
 * file's values into the object it expands against and only treats a non-empty variable as set, so it expands against
 * a copy of the environment and `ConfigModule` assigns only the variables still unset.
 */
export function loadEnvironment(envFilePath = resolveFromRepositoryRoot('.env')): ReturnType<typeof ConfigModule.forRoot> {
  return ConfigModule.forRoot({
    envFilePath,
    ignoreEnvFile: process.env.NODE_ENV === 'test',
    expandVariables: { processEnv: { ...process.env } as Record<string, string> },
  });
}
