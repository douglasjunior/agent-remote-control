import { CEO_SKILLS } from '../constants/ceo-skills.constant.js';
import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';


export const SKILL_AUTHORING_SKILL: AgentSkillDefinition = {
  name: CEO_SKILLS.skillAuthoring,
  description: 'How the CEO creates and changes the skills agents read on demand - finding the existing skills, writing the name, description, roles and content in the expected shape, and the <skill_list> and <skill_write> requests. Use when the user asks to create, change or review a skill, or to teach an agent how to do something.',
  roles: ['CEO'],
  buildContent: () => `# Skill Authoring

A skill is know-how an agent reads on demand. Its name and description go to the catalog of every role it names; the agent reads the content with \`<skill_read>\` when the description matches the work at hand. You write skills through requests, and the server stores them; you never write skill files yourself.

## Steps
1. List every skill with \`<skill_list/>\`: name, whether it is built-in or the user's, the roles that read it, and its description. Change an existing skill instead of adding one that overlaps it, and read it first with \`<skill_read name="..."/>\` (you can read any skill).
2. Settle what the skill must teach. Ask the user with \`<question>\` for what you cannot infer: which roles use it, the tools, commands and conventions to follow, and what the agent must produce. When writing it needs technical knowledge you do not have, delegate an investigation to the agent that plans and write the skill from its result.
3. Write it with \`<skill_write>\`. Writing replaces the whole skill, so an update carries the full content.
4. Tell the user what the skill covers and who reads it.

## Request Grammar
\`\`\`text
<skill_write name="electron-testing" roles="QA" description="Testing an Electron desktop app in practice with Playwright's Electron support - launching the app, driving its windows and capturing evidence. Read before testing any Electron app.">
# Testing an Electron App

## Launch
- ...
</skill_write>
\`\`\`
- \`name\`: lowercase kebab-case, up to 64 characters, naming the subject (\`electron-testing\`, \`release-checklist\`). Built-in skill names are taken.
- \`roles\`: the roles that read it, comma-separated (\`roles="QA, DEVELOPER"\`), from the roles of your team or your own.
- \`description\`: one or two sentences, up to 1024 characters: what the skill covers, then when to read it ("Read before ...", "Use when ..."). It is all an agent sees before reading, so name the technologies and situations that should trigger it.
- The body is the content, in Markdown. The result says whether the skill was created or updated.

## Writing the Content
- In English, whatever the language of the conversation: agents work in English.
- Start with a \`#\` title, then short sections in the order the agent works (setup, steps, checks, evidence, clean-up).
- Prescriptive and concrete: imperative instructions, exact commands, tool names, file locations and the output to produce. Say what to do when something fails.
- Only what the agent cannot already know: the project's or team's choices, pitfalls, the shape of the deliverable. Skip generic advice.
- Respect the role's limits: a skill never asks an agent to do what its role forbids (a QA agent changing code, a reviewer running the project).
- No secrets, tokens or personal data: point to where the agent finds them instead.
- Keep each skill to one subject; split a subject that grows past a few hundred lines.

## Availability
- An agent sees a new skill in its catalog from its next session; a changed skill applies the next time it is read.
- Skills live in the server's data directory, where the user can also edit or delete them.
`,
};
