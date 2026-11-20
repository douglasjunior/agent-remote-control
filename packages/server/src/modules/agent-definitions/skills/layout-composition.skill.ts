import { SKILL_NAMES } from '../constants/skill-names.constant.js';
import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';


export const LAYOUT_COMPOSITION_SKILL: AgentSkillDefinition = {
  name: SKILL_NAMES.layoutComposition,
  description: 'Read before laying out any screen: hierarchy and the single job of a screen, summary before detail, grids and optical alignment, density, flex and grid gap instead of margins, proven patterns for landing, dashboard, form, list-detail, settings, onboarding and empty slate, and when a card earns its border and shadow.',
  roles: ['UX_DESIGNER'],
  buildContent: () => `# Layout and Composition

## One Job per Screen
- Name the screen's job in one sentence before laying it out ("decide which invoices to chase today"). Whatever serves that job is prominent; whatever does not is secondary, collapsed or on another screen.
- One primary action per view, styled as primary. Secondary actions are quieter (outline, ghost, a menu); destructive ones are set apart.
- Hierarchy is read in this order: size, weight, color contrast, position (top-left in left-to-right languages), whitespace around it. Use two or three of them per level, consistently.
- Summary before detail: the answer first (the total, the status, what needs attention), the breakdown under it, the raw data last or behind a click. Progressive disclosure over showing everything.
- The squint test: blur your eyes at the screenshot. The thing you meant to be seen first must be the first blob you see.

## Grids and Alignment
- A 12-column grid on desktop (gutter 24 px, outer margin 24 to 48 px), 8 on tablet, 4 on phone (gutter and margin 16 px). Content width capped: 1200 to 1440 px for apps, 65ch for prose, 480 to 640 px for single-column forms.
- Few alignment lines: every element's left edge lands on one of a handful of verticals. Count them on a screenshot; more than four or five on one screen reads as messy.
- Align text by its baseline and icons by their optical center, not their box: a play triangle sits slightly right of center, a round glyph slightly overshoots a square one, an icon beside text aligns to the cap height.
- Left-align text in left-to-right interfaces. Center only short, standalone content (an empty state, a hero line, a dialog of one sentence); a centered paragraph or a centered form is harder to scan.

## Density
- Pick a density from the use: data-heavy tools used for hours (trading, admin, analytics, IDEs) want compact rows (32 to 36 px) and 13 to 14 px text; consumer and occasional use want comfortable rows (44 to 56 px) and 16 px text.
- Density is consistent within a product. Offer a density switch only for tables people live in.
- Whitespace is grouping, not emptiness: equal gaps everywhere flatten the hierarchy just like no gaps.

## Layout Mechanics
- Lay out with flex and grid \`gap\`, not margins on children: gap spaces only between items, never doubles up and never leaves a trailing space. Margins are for the rare one-off offset.
- \`grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr))\` for card grids that reflow without breakpoints; \`minmax(0, 1fr)\` for columns holding long text or code, so they shrink instead of overflowing.
- Give truncation a rule: one line with ellipsis and the full value on hover for names in tables, two or three lines with \`line-clamp\` for descriptions, never truncation of numbers or ids that must be read whole.
- Avoid stretched items and orphans: a grid of 3 with 4 items leaves one alone on the last row, so pick a count that divides or let the row reflow. A single button stretched across a 1200 px desktop column looks broken; constrain it.
- Sticky elements (headers, action bars, table headers) only when the user needs them while scrolling, and never more than two at once on a phone.

## Patterns That Work
- **Landing page**: in the first screen, what it is, for whom, and one call to action, with the product itself visible (a screenshot, a live demo, real output), not an abstract illustration. Then proof (customers, numbers, quotes), then how it works in three steps at most, then the call to action again. The hero is not 100vh: a peek of the next section invites scrolling.
- **Dashboard**: the few numbers that answer "is everything fine?" on top, then what needs attention (a list of items to act on), then trends. Every widget answers a question someone asks; a chart nobody acts on is decoration. Filters and the time range sit together in one bar above the content they affect.
- **Form**: one column, labels above fields, fields sized to the expected input (a postcode field is short), related fields grouped under a heading, the primary button at the end aligned with the fields, optional fields marked as optional (rather than required ones with asterisks) when most are required. Long forms split into steps with a visible progress indicator, or into sections with a sticky summary.
- **List-detail**: a list that scans (title, one line of context, status, a date, aligned in columns) and a detail pane on wide screens or a separate screen on a phone. The list keeps its scroll position and the selection when returning from the detail.
- **Settings**: grouped by what users think they are changing, a left navigation of groups on desktop, a list of groups on mobile. Each setting has a label, one line of explanation and its control on the right; changes save immediately with a quiet confirmation, or the page has one explicit save that warns about unsaved changes.
- **Onboarding**: get the user to the first moment of value fast. Ask only what is needed now; defer the rest. Prefer an empty state that teaches in place over a tour of tooltips.
- **Empty slate**: see the \`${SKILL_NAMES.interactionStates}\` skill; it is a designed screen, not a missing one.

## When a Card Earns Its Border
- A card is a container for an item that is one of many and can be acted on as a unit (a project in a grid, a product, a notification). Content that is simply the page does not need a card.
- Group with space first, a divider or a surface tint second, a bordered card third, a shadow only when it floats. A border and a shadow and a tinted background on the same card is three answers to one question.
- Never nest cards in cards; inside a card, group with space and dividers.
- Consistent padding inside every card of a set (16 to 24 px), and the same structure in the same order (media, title, meta, actions), so a grid of cards aligns row by row.`,
};
