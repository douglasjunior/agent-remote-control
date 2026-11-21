import { SKILL_NAMES } from '../constants/skill-names.constant.js';
import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';


export const VISUAL_FOUNDATIONS_SKILL: AgentSkillDefinition = {
  name: SKILL_NAMES.visualFoundations,
  description: 'Read before choosing or changing type, color, spacing, radii, elevation, icons or a dark theme for an interface: type scales and line length, a 4/8 spacing scale, color tokens with roles and contrast numbers, dark mode designed rather than inverted, radius and elevation systems, icon sizing and tabular numbers.',
  roles: ['UX_DESIGNER', 'DEVELOPER'],
  buildContent: () => `# Visual Foundations

The foundations are a small set of decisions applied everywhere. Decide them once, as tokens, and never improvise a value on a screen. When the project already has them, use its values; the numbers below are for the gaps.

## Type
- One scale with a fixed ratio: 1.2 (minor third) for dense apps and dashboards, 1.25 (major third) for most products, 1.333 (perfect fourth) for marketing and editorial pages. From a 16 px base at 1.25: 12.8, 16, 20, 25, 31.25, 39 px; round to whole pixels.
- Body text 16 px on the web (never below 14 px for reading text, 12 px only for labels and metadata). Mobile inputs at 16 px or more, so iOS does not zoom on focus.
- Line height falls as size grows: 1.5 to 1.6 for body, 1.3 to 1.4 for subheadings, 1.1 to 1.2 for display sizes above 32 px. Tighten letter spacing on large headings (-0.01em to -0.02em); open it slightly (+0.02em to +0.06em) on small uppercase labels.
- Line length 45 to 75 characters, about 65ch: \`max-width: 65ch\` on prose. A paragraph spanning a 1440 px screen is unreadable.
- Weights: two or three per family (400 body, 500 or 600 for emphasis and labels, 700 for headings at most). Hierarchy comes from size, weight and color together; never from size alone, and never with more than four sizes on one screen.
- One family is enough for most products; a second only for contrast with a reason (a serif for editorial headings, a monospace for code and ids). System font stack or a variable font loaded once; set \`font-display: swap\`.
- Use \`text-wrap: balance\` on headings and \`text-wrap: pretty\` on short paragraphs to avoid orphans.

## Spacing
- A 4 px base with an 8 px rhythm: 4, 8, 12, 16, 24, 32, 48, 64, 96. Every padding, gap and margin comes from it.
- Space expresses grouping (proximity): the gap inside a group is smaller than the gap between groups, by at least one step. A label sits 4 to 8 px from its field; fields sit 16 to 24 px apart; sections 48 to 96 px apart.
- Components scale padding with their size: a 32 px control has 8 to 12 px horizontal padding, a 40 px control 12 to 16 px, a 48 px control 16 to 20 px.

## Color as Tokens With Roles
- Name colors by role, never by hue: \`--bg\` (page), \`--surface\` (cards, panels), \`--surface-raised\` (menus, popovers), \`--fg\` (primary text), \`--muted\` (secondary text), \`--border\`, \`--accent\` and \`--accent-fg\` (text on accent), \`--ring\` (focus), and the semantic \`--good\`, \`--warn\`, \`--critical\`, \`--info\` with a subtle background variant each.
- Build each hue as a ramp of 10 to 12 steps in OKLCH (or HSL when the stack needs it), keeping hue and chroma steady and moving lightness evenly; OKLCH keeps perceived lightness consistent across hues, so a yellow and a blue at the same L read equally heavy.
- Neutrals carry a slight hue bias toward the accent (chroma 0.005 to 0.02 in OKLCH): pure grays look dead next to a colored accent.
- One accent color does the pointing (primary actions, links, selection, focus). Semantic colors only mean their meaning: red is for errors and destructive actions, never decoration.
- Contrast (WCAG 2.2 AA): 4.5:1 for body text, 3:1 for text of 24 px or 18.7 px bold and above, 3:1 for icons, input borders, focus indicators and the parts of a chart a reader must see. Muted text still meets 4.5:1 against the surface it sits on. Check placeholder text too, and never use it as a label.
- Never rely on color alone: pair it with an icon, a label or a pattern.

## Dark Mode, Designed
- Redefine the tokens for dark, never invert. Backgrounds are dark grays, not black (OKLCH L about 0.15 to 0.22), and elevation goes up by getting lighter, since shadows barely show on dark.
- Desaturate and lighten accents for dark surfaces (lower chroma, higher L) so they do not vibrate; recheck every contrast pair in both themes.
- Body text is off-white (L about 0.92 to 0.96), not pure white, to cut halation.
- Set \`color-scheme: light dark\` (or per theme) so form controls and scrollbars follow, and drive the theme from \`prefers-color-scheme\` plus an explicit override.
- A literal color in a component (\`#fff\`, \`text-black\`, \`bg-white\`) breaks one theme; every color goes through a token. Images and illustrations with white backgrounds need a dark variant or a surface behind them.

## Radii
- A scale tied to role, not to whim: 4 px for small controls and tags, 6 to 8 px for buttons and inputs, 10 to 12 px for cards and dialogs, 999 px for pills and avatars. Two or three values in practice.
- Nested radii: the inner radius equals the outer radius minus the padding between them, so curves stay concentric.
- The radius sets the tone: near 0 reads technical and editorial, 6 to 8 neutral, 16 and up friendly and consumer. Pick one tone for the product.

## Elevation
- Three to four levels at most: flat (in the page), raised (cards, if they need it), overlay (menus, popovers), modal (dialogs). Each level has one shadow token.
- Shadows are soft and layered, tinted with the background hue, low opacity (a 1 px tight shadow plus a larger blurred one at 4 to 10 percent). Never a hard black drop shadow.
- Prefer a border or a surface step to a shadow for in-page grouping; save shadows for things that float above the page.

## Icons
- One icon set per product (Lucide, Phosphor, Heroicons, Material Symbols); never mix sets. One stroke width throughout (1.5 or 2 px at 24 px).
- Sizes on the spacing grid: 16 px inline with 14 to 16 px text, 20 px in controls, 24 px standalone. Align icons to the text's cap height, not its box.
- An icon alone needs an accessible name and, for anything not universal, a visible label or a tooltip. Icons clarify; they do not decorate every heading.

## Numbers
- Tabular figures (\`font-variant-numeric: tabular-nums\`) wherever numbers align or change: tables, prices, counters, timers, stats. Right-align numeric columns, with consistent decimals.
- Format numbers, dates, currencies and units for the user's locale with \`Intl\`; abbreviate large values (1.2k, 3.4M) only where the exact value is a hover or a click away.`,
};
