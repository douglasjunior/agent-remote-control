import { SKILL_NAMES } from '../constants/skill-names.constant.js';
import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';


export const RUNNING_THE_APP_SKILL: AgentSkillDefinition = {
  name: SKILL_NAMES.runningTheApp,
  description: 'Preparing and starting the application of a project to test it or look at it running - finding the documented commands, environment, services and ports, bringing up local databases with migrations and seeds, changing local data, configuration and code to force a scenario, waiting until it is ready, and undoing everything afterwards. Read before starting any application.',
  roles: ['QA', 'UX_DESIGNER'],
  buildContent: () => `# Running the Application

## Find How the Project Runs
- Read README, AGENTS.md, CONTRIBUTING and the manifest scripts (\`package.json\`, \`Makefile\`, \`docker-compose.yml\`, \`pyproject.toml\`, Gradle or Maven files). Use the documented commands; do not reinvent them.
- Install dependencies with the project's own command and lockfile (\`pnpm install --frozen-lockfile\`, \`npm ci\`, \`poetry install\`...). Installing never edits the manifest or the lockfile; when it would, report it instead.
- Configuration: create or edit the files and variables the application reads (copy \`.env.example\` to the name the project reads, point the application and its clients at your local backend and services, turn on a flag), rebuild what reads a setting at build time, and note each change to undo it at the end. Never put real secrets in them; ask the caller when a test needs credentials the project does not provide for development.
- Backing services (databases, queues, caches): bring them up with the project's compose file or documented scripts, apply its migrations and run its seeds. Never point the application at a shared or production service.

## Shape the State a Test Needs
- Data: insert or edit what a test case needs straight in the local database (SQL client, \`mongosh\`, the project's own console or admin scripts): a user on a given plan, a record dated on a given day, an expired subscription. Read it back before testing.
- Behavior: when data alone cannot reach the case, change the code or configuration locally (a fixed clock, a mocked response, a lowered limit), rebuild and restart. Keep each change as small as the case needs.
- None of these changes is ever committed, staged or pushed.

## Start and Wait
- Run long-lived processes in the background and write their output to a log file in your temporary folder, so you can read errors and stop them later. Record each process id.
- Wait until the application is ready, by polling its health endpoint or URL, or watching the log for the line that says it is listening, with a time limit. A start that fails or never gets ready is a finding: report the command and the end of its log.
- Prefer a port the project does not already use when another instance may be running, through the project's own setting (\`PORT\`, \`--port\`).

## Shut Down
- Stop every process you started (by its recorded id), \`docker compose down\` what you brought up (keeping volumes that existed before), and delete the temporary folder and the files you created.
- Revert your changes to tracked files (\`git restore <paths>\`, only the paths you changed) and to the ignored settings you edited. Data you changed in a local database and ignored settings the project's local setup keeps may stay; list them in your final answer.
- Run \`git status\`: it must show what it showed when you started. Switch back to the branch you found checked out.`,
};
