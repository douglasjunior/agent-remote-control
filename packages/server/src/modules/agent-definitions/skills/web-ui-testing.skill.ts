import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';


export const WEB_UI_TESTING_SKILL: AgentSkillDefinition = {
  name: 'web-ui-testing',
  description: 'Testing a web interface in a real browser with Playwright - navigating, filling forms, asserting what the user sees, responsive and accessibility checks, and capturing screenshots as evidence. Read before testing any web front end.',
  roles: ['QA'],
  buildContent: () => `# Testing a Web Interface With Playwright

## Pick the Driver
1. Playwright MCP tools, when your client has them (\`browser_navigate\`, \`browser_snapshot\`, \`browser_click\`, \`browser_type\`, \`browser_take_screenshot\`...): drive the browser step by step and read the accessibility snapshot after each action.
2. The project's own Playwright setup (\`playwright.config.*\`, an \`e2e/\` folder): run its suite with the documented script, and add throwaway specs only in your temporary folder through \`--config\` or a path argument.
3. Otherwise a throwaway script in your temporary folder: \`npx -y playwright@latest install chromium\` once, then a spec run with \`npx -y playwright@latest test <temp-folder>\`. Use headless Chromium.

## Write Tests Like a User
- Locate elements by role, label and visible text (\`getByRole('button', { name: 'Save' })\`, \`getByLabel('Email')\`), never by CSS classes that change with styling.
- Rely on web-first assertions that wait (\`await expect(locator).toBeVisible()\`, \`toHaveText\`, \`toHaveURL\`); never fixed sleeps.
- Cover each acceptance criterion from a clean state: navigation, form validation (empty, invalid, boundary), success and error messages, persistence after reload, and what other roles must not see or do.
- Watch the browser console and failed network requests during each test; an uncaught error or a 5xx is a finding even when the screen looks right.
- Check the layout at a phone width (375 px) when the task touches the interface, and keyboard navigation and visible focus for new controls.

## Evidence
- Take a screenshot at each failure and at the final state of each criterion, in your temporary folder, and describe in the report what it shows (the folder is deleted at the end; the description is the evidence that stays).
- Record the URL, the steps and the console or network error text in the report.`,
};
