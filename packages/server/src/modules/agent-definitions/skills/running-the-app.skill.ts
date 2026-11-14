import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';


export const RUNNING_THE_APP_SKILL: AgentSkillDefinition = {
  name: 'running-the-app',
  description: 'Starting the application of a project to test it - finding the documented commands, environment, services and ports, waiting until it is ready, and shutting everything down afterwards. Read before starting any application.',
  roles: ['QA'],
  buildContent: () => `# Running the Application

## Find How the Project Runs
- Read README, AGENTS.md, CONTRIBUTING and the manifest scripts (\`package.json\`, \`Makefile\`, \`docker-compose.yml\`, \`pyproject.toml\`, Gradle or Maven files). Use the documented commands; do not reinvent them.
- Install dependencies with the project's own command and lockfile (\`pnpm install --frozen-lockfile\`, \`npm ci\`, \`poetry install\`...). Installing never edits the manifest or the lockfile; when it would, report it instead.
- Configuration: copy an example file (\`.env.example\`) to the name the project reads only when the project documents it, and remember to delete the copy at the end. Never put real secrets in it; ask the caller when a test needs credentials the project does not provide for development.
- Backing services (databases, queues): use the project's compose file or documented scripts. Never point the application at a shared or production service.

## Start and Wait
- Run long-lived processes in the background and write their output to a log file in your temporary folder, so you can read errors and stop them later. Record each process id.
- Wait until the application is ready, by polling its health endpoint or URL, or watching the log for the line that says it is listening, with a time limit. A start that fails or never gets ready is a finding: report the command and the end of its log.
- Prefer a port the project does not already use when another instance may be running, through the project's own setting (\`PORT\`, \`--port\`).

## Shut Down
- Stop every process you started (by its recorded id), \`docker compose down\` what you brought up (keeping volumes that existed before), and delete the temporary folder and any configuration copy you created.
- Run \`git status\` and switch back to the branch you found checked out.`,
};
