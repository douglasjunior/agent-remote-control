import { SKILL_NAMES } from '../constants/skill-names.constant.js';
import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';


export const MOTION_SKILL: AgentSkillDefinition = {
  name: SKILL_NAMES.motion,
  description: 'Read before adding any animation or transition to an interface: motion with a purpose, one orchestrated moment over scattered effects, durations and easing curves, enter and exit asymmetry, animating without layout shift, prefers-reduced-motion, and a page that is complete at rest.',
  roles: ['UX_DESIGNER'],
  buildContent: () => `# Motion

## Purpose First
Animate only to do one of these jobs: show where something came from or went (a panel sliding from its trigger, an item flying to the cart), show that the interface responded (a press, a toggle, a saved check), connect two states so the change is understood (a list reordering, a card expanding into a detail), or draw attention to one thing that changed. If an animation does none of these, remove it.

- One orchestrated moment beats scattered effects: a page load where the main content arrives in one composed sequence (staggered by 30 to 60 ms per item, five or six items at most) reads as crafted; every element bouncing on its own reads as noise.
- Motion is consistent: the same kind of change animates the same way everywhere (all dialogs, all toasts, all expanding rows).

## Durations
- Micro feedback (hover, press, toggle, focus): 100 to 150 ms.
- UI transitions (menus, popovers, tooltips, tabs, small panels): 150 to 200 ms.
- Layout changes and larger surfaces (drawers, sheets, dialogs, expanding cards, page transitions): 200 to 400 ms; scale with distance and size, mobile slightly shorter than desktop.
- Nothing the user waits on goes over 400 ms. Decorative ambient motion, if any, is slow (several seconds) and subtle.

## Easing
- Entering: ease-out (decelerate), so the element arrives quickly and settles: \`cubic-bezier(0.16, 1, 0.3, 1)\` or \`cubic-bezier(0.2, 0, 0, 1)\`.
- Exiting: ease-in (accelerate), and faster than the entrance (about 70 to 80 percent of its duration): \`cubic-bezier(0.4, 0, 1, 1)\`. Leaving should never hold the user up.
- Moving on screen from one place to another: ease-in-out, \`cubic-bezier(0.65, 0, 0.35, 1)\`.
- Never linear for movement (it looks mechanical); linear only for opacity loops, progress and spinners.
- Springs (Motion, React Spring) for direct manipulation and gestures, with little or no bounce in productivity tools.

## Enter and Exit
- Enter with a small offset plus fade (8 to 16 px of travel, from the direction of the trigger, or a scale from 0.96 to 1); never from far away or from 0 scale.
- Popovers and menus scale from their anchor point (\`transform-origin\` at the trigger).
- Exits are simpler than entrances: usually a fade, sometimes with a slight reverse offset.
- Lists: animate insertions and removals so the gap opens and closes, rather than items jumping.

## Performance and Layout
- Animate \`transform\` and \`opacity\` only; they run on the compositor. Animating \`width\`, \`height\`, \`top\`, \`left\`, \`margin\` or \`box-shadow\` causes layout or paint on every frame and jank.
- Expanding content: animate \`grid-template-rows: 0fr\` to \`1fr\`, or a FLIP technique (measure, invert with transform, play), or the View Transitions API, rather than \`height: auto\`.
- No animation may move content the user is reading or about to click: reserve space for content that loads (skeletons of the right size, \`aspect-ratio\` on media) so nothing shifts (Cumulative Layout Shift under 0.1).
- Use \`will-change\` sparingly, only on elements about to animate.

## Reduced Motion
- \`@media (prefers-reduced-motion: reduce)\`: replace travel, scale, parallax and auto-play with an instant change or a short fade (under 150 ms). Keep the state change itself and its feedback.
- In JavaScript animation libraries, read the same preference (\`matchMedia('(prefers-reduced-motion: reduce)')\`, Motion's \`useReducedMotion\`).

## Complete at Rest
- The page is fully usable and fully visible without any animation running. Never hide content at \`opacity: 0\` until a scroll trigger fires: if the script fails, the observer misses, or the user prints or uses reader mode, the content is gone. Scroll-revealed effects start from a visible state, or apply only once JavaScript has confirmed it will run them.
- Screenshots and tests must capture the final state; no essential information exists only mid-animation.
- No infinite decorative animation near content people read; loops are for loading indicators, and they stop when loading ends.`,
};
