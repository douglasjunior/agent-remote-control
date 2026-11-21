import { SKILL_NAMES } from '../constants/skill-names.constant.js';
import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';


export const VISUAL_POLISH_SKILL: AgentSkillDefinition = {
  name: SKILL_NAMES.visualPolish,
  description: 'Read before delivering any design or interface, and when a screen works but looks amateur or generic: the details that separate professional from amateur work, the anti-generic checklist of template marks to avoid unless the user asks for them, and the final review pass.',
  roles: ['UX_DESIGNER'],
  buildContent: () => `# Visual Polish

Polish is the sum of small consistencies. Users do not notice each one; they notice when they are missing and call the product "cheap" without knowing why.

## The Details
- **Edges line up**: repeated items (rows, cards, list items, form fields) share the same left edge, the same inner padding and the same baseline for their text. Check a screenshot with a vertical guide; a 2 px drift is visible.
- **Paddings are consistent by role**: every card of a kind has the same padding, every page the same outer margin, every section the same gap. Optical adjustments are deliberate (a button with an icon may have 2 px less padding on the icon side), never accidental.
- **One place for boldness**: each screen has a single focal point (the hero number, the primary action, the key image). Everything else is calmer. Two loud things cancel each other.
- **Deliberate type**: one family or a pairing with a clear contrast of roles (a serif or a characterful display face for headings with a neutral sans for text, or a monospace for data). Never two similar sans-serifs. Headings tightly set, body comfortably set, labels small and steady.
- **Radius by role**: the same radius for every control of a kind, concentric radii when nested, and one tone (sharp, neutral or soft) across the product.
- **Restrained shadows**: few levels, soft and tinted, used only for what floats. Most of the page is flat with borders or surface steps.
- **Icons consistent**: one set, one stroke, one size per context, optically aligned with their text, never a mix of filled and outlined without meaning.
- **Color with intent**: neutrals do most of the work; the accent marks what is interactive or important; semantic colors only carry meaning. Count the hues on a screen: more than the accent, the neutrals and one or two semantic colors needs a reason.
- **Numbers and data**: tabular figures, right-aligned columns, consistent decimals and units, thousands separators.
- **Borders that whisper**: a 1 px border in a low-contrast token, not a dark line. Dividers inside a card lighter than the card's border.
- **States that feel alive**: hover, pressed, focus-visible, selected and disabled are designed for every control, with a transition of 100 to 150 ms on color and background.
- **Real images** cropped with intent (\`object-fit: cover\` with a chosen \`object-position\`), with a consistent aspect ratio per context and a placeholder color while loading.

## The Anti-Generic Checklist
These marks make an interface look generated or templated. Avoid each one unless the user asked for it, or the brand already uses it:
- The purple-to-blue (or pink-to-orange) gradient hero, gradient text on headings, and glowing gradient blobs behind content.
- Cream or beige backgrounds with a serif headline and a terracotta accent, applied by default as "warm and premium".
- Near-black backgrounds with a single acid accent (lime, cyan, magenta) and neon glows, applied by default as "techy".
- Emoji as section markers, bullet icons or feature icons.
- Everything centered: centered headings over centered paragraphs over centered cards. Left-align content that is read.
- \`rounded-lg\` (or any one radius) and a shadow on every block, so the page is a pile of identical floating cards.
- A colored accent bar on the left or top of every card.
- Decorative numbering (01, 02, 03) or step counters when the content is not a sequence.
- A 100vh hero that pushes all real content out of the first frame; a hero with a vague slogan and no product in sight.
- Three-column feature grids of icon, title and two lines of text, repeated section after section.
- Glassmorphism, blur and translucency where nothing sits behind the panel.
- Generic stock illustrations of people high-fiving, and lorem ipsum or "John Doe" content.
- Badges reading "New" or "AI-powered" sprinkled for decoration; pill buttons with arrows on every link.
Instead, take the direction from the product's domain, its audience and its own content: the data, the documents, the objects users handle every day.

## The Final Review Pass
Run it on screenshots at 390 px and 1440 px, light and dark, before delivering:
1. The screen's one job is obvious within three seconds; the primary action is the most prominent control.
2. Squint: the hierarchy holds; no second focal point competes.
3. Alignment: few vertical lines; repeated items share edges and baselines.
4. Spacing comes from the scale; groups are tighter inside than between.
5. Type: at most four sizes on the screen, body at 16 px (14 for dense tools), line length under 75 characters.
6. Color: contrast passes in both themes; the accent marks only what matters; no literal colors broke a theme.
7. Every state exists and is reachable: empty, loading, error, success, partial, no permission; long and short content.
8. The phone: no horizontal scroll, 44 px targets, primary actions in reach of the thumb, nothing cut off by safe areas.
9. Keyboard: visible focus on everything, sensible order, Escape closes overlays.
10. Copy: real, specific, consistent names; buttons say what happens; errors say how to fix.
11. Motion: purposeful, quick, complete at rest, reduced under \`prefers-reduced-motion\`.
12. Nothing from the anti-generic checklist remains without a reason.
Fix what fails and look again; then write down in the design record what you checked.`,
};
