import { SKILL_NAMES } from '../constants/skill-names.constant.js';
import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';


export const PROTOTYPING_SKILL: AgentSkillDefinition = {
  name: SKILL_NAMES.prototyping,
  description: 'Read before building a prototype: choosing fidelity and stack (a single HTML file with a pinned Tailwind build, the project\'s own stack, or React with Vite and shadcn), realistic sample data, making every state reachable, serving and previewing it, screenshots for the self-review, and the branch and handoff format.',
  roles: ['UX_DESIGNER'],
  buildContent: () => `# Prototyping

A prototype answers "what will this be like to use?" faster and more convincingly than any description. It must run, look finished where it matters, and be honest about what is fake.

## Choose Fidelity and Stack
- **Existing project with an interface**: build in its own stack, on the design branch, as new routes or screens next to the real ones, with its components, tokens, icons and layout shell. Fake the backend with fixtures or a mocked data layer at the edge (an in-memory store, MSW handlers, a fixtures module behind the same hooks the app uses). This is the most useful prototype: the developer reads real components in the real codebase.
- **New idea, fast regime**: a single \`prototype/index.html\` that opens straight from disk, with Tailwind from a pinned build (\`<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.1.11"></script>\`, an exact version, never \`@latest\` or a bare major), tokens as CSS custom properties in a \`<style>\` block (\`@theme\` for Tailwind v4), a little vanilla JavaScript or Alpine.js (pinned) for interaction, and the data as a JavaScript array at the top of the file. One page with a screen switcher, or one file per screen linked together.
- **New idea, robust regime**: a React + Vite + TypeScript app in \`prototype/\` with Tailwind and shadcn/ui (\`npm create vite@latest\` with the React TypeScript template, then the shadcn CLI), React Router for screens, fixtures for data. Pin the versions in its \`package.json\` and commit the lockfile.
- Never pull in a framework for a static page, and never fake a complex multi-screen flow in one HTML file when the regime is robust.

## Realistic Data
- Sample data looks like production: real-sounding names in the user's language and culture, plausible amounts and dates (relative to today), varied lengths, the occasional long name, missing avatar, zero balance, overdue item and 250-row list. Ten nearly identical rows hide every layout problem.
- Keep data in one fixtures module (\`prototype/data.ts\` or the project's fixtures folder), typed like the real models when they exist, so the developer can see the shape the design assumes.
- Never real personal data, never secrets, never calls to production services.

## A Working First State
- The prototype opens on the most representative populated state, not on an empty shell or a login wall. Fake authentication as an already signed-in user.
- Every designed state is reachable from the running prototype without editing code: a small floating state switcher (Populated, Empty, Loading, Error, No permission), query parameters (\`?state=empty\`), or one route per state. Document how in the design record.
- Interactions that define the experience work for real (navigation, filters, form validation, opening and closing panels, optimistic updates with a fake delay of 400 to 800 ms). Peripheral ones can be inert, but never look broken.
- Light and dark themes both work when the product has both, with a toggle.

## Serve and Preview
- Single HTML: open the file directly, or serve the folder (\`npx -y serve prototype\`, \`python3 -m http.server\`) when it fetches local files.
- Vite or the project's stack: the project's documented dev command, on a free port (\`--port\`), in the background with its output in a log file in a temporary folder; wait until it answers before looking. Stop it before you finish.
- Note the exact URL and route of every screen for the record.

## Screenshots for the Self-Review
- With Playwright MCP tools: navigate, resize to 390 by 844 and 1440 by 900, switch \`colorScheme\` between light and dark, take a screenshot of each screen and state, and look at each one.
- Without them, a throwaway script in a temporary folder inside the project (\`npx -y playwright@latest install chromium\` once): for each URL, viewport and color scheme, \`page.screenshot({ fullPage: true })\`. Read the images, fix, repeat.
- Also check: no horizontal scroll at 360 px, keyboard tab order on the main flow, no console errors.
- Screenshots are for your review and stay out of the repository unless the project keeps design assets; describe in the record what they showed.

## Branch and Handoff
- Branch \`design/<artifact id>-<slug>\` from the branch the work starts from, or else the default branch; small commits (\`feat(prototype): add checkout review screen\`), following the project's convention.
- The branch is never merged. It is the visual and behavioral reference; production code is written on the implementation branch, reusing what fits.
- The \`ux_design\` section is the handoff: the branch and how to open it (command, URL, route per screen, how to reach each state); the screens and their states; tokens and components used or added; interactions and responsive behavior; what is faked and must be real in production; the decisions and their reasons.
- Leave the project folder as you found it: servers stopped, temporary files removed, the original branch checked out, \`git status\` unchanged.`,
};
