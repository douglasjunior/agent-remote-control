import { SKILL_NAMES } from '../constants/skill-names.constant.js';
import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';


export const RESPONSIVE_MOBILE_SKILL: AgentSkillDefinition = {
  name: SKILL_NAMES.responsiveMobile,
  description: 'Read before building or changing a screen that must work on phones and wide screens: mobile-first CSS, breakpoints versus container queries, 44 px touch targets and thumb zones, navigation patterns and when each fits, safe areas, no horizontal page scroll, and collapsing toolbars and filters into sheets.',
  roles: ['UX_DESIGNER', 'DEVELOPER'],
  buildContent: () => `# Responsive and Mobile

## Mobile First
- Write the base styles for the narrowest screen (360 px) and add layout at larger widths with \`min-width\` queries. Designing the phone first forces the hierarchy: whatever does not fit the phone was probably not essential.
- Check at 360, 390, 768, 1024, 1280 and 1440 px, and at 200 percent browser zoom. Rotate a phone once.
- Viewport: \`<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\`; never disable zoom. Use \`100dvh\` (dynamic viewport height) rather than \`100vh\`, which ignores the mobile browser's toolbars.

## Breakpoints or Container Queries
- Breakpoints (\`@media (min-width: …)\`) for the page skeleton: navigation placement, the number of columns, sidebars appearing. Typical set: 640, 768, 1024, 1280 px (Tailwind's \`sm md lg xl\`); use the project's own when it has them.
- Container queries (\`container-type: inline-size\` and \`@container (min-width: …)\`) for components that live in containers of varying width (a card in a sidebar and in the main column, a widget on a dashboard grid): the component adapts to its space, not to the window.
- Fluid type and spacing with \`clamp()\` for display sizes (\`font-size: clamp(2rem, 1.2rem + 3vw, 3.5rem)\`); body text stays fixed.

## Touch
- Targets at least 44 by 44 px (Apple) or 48 by 48 dp (Material), with 8 px between adjacent targets; WCAG 2.2 sets 24 by 24 px as the floor. A small visual icon can keep a large hit area through padding.
- Thumb zones: on a phone held in one hand, the bottom third of the screen is easy, the top corners are hard. Primary and frequent actions go low (a bottom bar, a bottom sheet, a sticky action button); rare and destructive ones may sit at the top.
- No hover-only affordances: anything revealed on hover is visible or reachable by tap on touch devices (\`@media (hover: hover)\` gates hover enhancements). Long-press is a shortcut, never the only way.
- Inputs use the right \`type\`, \`inputmode\` and \`autocomplete\` (email, tel, numeric, one-time-code), so the phone shows the right keyboard and can autofill.

## Navigation Patterns
- **Tabs** (top, inside a screen): 2 to 5 sibling views of the same object; they scroll horizontally on a phone when labels do not fit, with the active tab scrolled into view.
- **Segmented control**: 2 to 4 mutually exclusive options that switch a view or a filter in place (Day, Week, Month).
- **Bottom navigation**: 3 to 5 top-level destinations of an app used often on phones; icons with labels, always visible, never for actions.
- **Drawer** (side navigation behind a menu button): many destinations or rarely used ones; on desktop it becomes a persistent sidebar, collapsible to icons.
- **Sheet** (bottom on phones, side on desktop): a secondary task in context (filters, a detail, a short form) without losing the page behind it. A full-screen dialog only for a task that needs the whole screen.
- Keep the location visible: a title that names the current screen, a back control that returns to where the user came from, and the active item marked in the navigation.

## Safe Areas and Overflow
- Respect notches and home indicators with \`padding: env(safe-area-inset-*)\` on fixed bars and full-bleed layouts (needs \`viewport-fit=cover\`).
- The page never scrolls horizontally. Check \`document.documentElement.scrollWidth <= window.innerWidth\` at 360 px. The usual culprits: fixed widths, long words and URLs (\`overflow-wrap: anywhere\`), images without \`max-width: 100%\`, flex children without \`min-width: 0\`, and \`100vw\` (which includes the scrollbar).
- Only content that is genuinely wide scrolls, inside its own container: tables, code blocks, diagrams and wide charts get \`overflow-x: auto\` with a visible cue (a fade or a cut-off column), and tables keep their first column sticky when it identifies the row.
- Tables on a phone: keep the two or three columns that matter and move the rest to the row's detail, or turn each row into a stacked card when rows are read one at a time.

## Collapsing for Small Screens
- A toolbar with many actions keeps the one or two primary actions visible and moves the rest into an overflow menu.
- Filters collapse into a "Filters" button that opens a sheet, with the count of active filters on the button and the active ones shown as removable chips above the results.
- Search collapses to an icon that expands into a full-width field.
- Side-by-side panes become a stack or a drill-down; a dense table becomes a list; a multi-column form becomes one column.
- Dialogs on a phone become bottom sheets or full-screen views with the primary action reachable by the thumb and above the keyboard.`,
};
