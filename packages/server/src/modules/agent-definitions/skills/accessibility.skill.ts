import { SKILL_NAMES } from '../constants/skill-names.constant.js';
import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';


export const ACCESSIBILITY_SKILL: AgentSkillDefinition = {
  name: SKILL_NAMES.accessibility,
  description: 'Read before designing or building any interactive interface, and again before delivering it: semantic HTML and landmarks, keyboard order and a visible focus ring, ARIA only when native elements cannot do it, labels, contrast, reduced motion, meaning beyond color, live regions, and how to test with a keyboard and a screen reader.',
  roles: ['UX_DESIGNER', 'DEVELOPER'],
  buildContent: () => `# Accessibility

Target WCAG 2.2 AA. Accessibility is designed in, not audited in at the end: most of it comes free from the right element in the right order.

## Semantic HTML First
- Use the element that has the behavior: \`<button>\` for actions, \`<a href>\` for navigation, \`<input>\`, \`<select>\`, \`<textarea>\` with \`<label>\`, \`<table>\` with \`<th scope>\` for tabular data, \`<ul>\`/\`<ol>\` for lists, \`<dialog>\` or a proven dialog primitive for modals. A clickable \`<div>\` needs a role, a tab stop, Enter and Space handling and a name; a \`<button>\` already has all of them.
- Landmarks: one \`<header>\`, \`<nav>\` (with \`aria-label\` when there are several), one \`<main>\`, \`<aside>\`, \`<footer>\`. A "Skip to content" link as the first focusable element on pages with long navigation.
- Headings in order (one \`h1\` per page, no skipped levels), describing the section they open; screen-reader users navigate by them.
- Set \`lang\` on \`<html>\`, a unique \`<title>\` per page or route, and update it on client-side navigation.

## Keyboard
- Everything that works with a mouse works with the keyboard: Tab and Shift+Tab move between controls in the visual reading order; Enter activates links and buttons; Space toggles buttons, checkboxes and switches; arrows move inside composite widgets (tabs, menus, radio groups, listboxes, grids), which take a single tab stop (roving tabindex).
- Escape closes menus, popovers and dialogs and returns focus to the control that opened them. A modal dialog traps focus inside while open and moves it to the first meaningful control (or the dialog title) when it opens.
- Never a positive \`tabindex\`. The DOM order is the focus order, so lay out with CSS without reordering content away from its visual order.
- After an action removes the focused element (delete a row, close a panel), move focus somewhere sensible (the next row, the list heading).

## Focus Visible
- Every focusable element shows a clear focus indicator: at least 2 px, contrast 3:1 against the adjacent colors, not hidden behind other elements. A two-tone ring (a 2 px ring in \`--ring\` with a 2 px offset in the background color) works on any surface.
- Use \`:focus-visible\` so the ring shows for keyboard users and not on every mouse click; never \`outline: none\` without a replacement.

## ARIA Only When Needed
- The first rule of ARIA: do not use it when a native element does the job. ARIA changes what assistive technology announces, not how the element behaves.
- When building a custom widget, follow the WAI-ARIA Authoring Practices pattern for it (tabs, combobox, menu, disclosure, dialog, listbox) completely: roles, states (\`aria-expanded\`, \`aria-selected\`, \`aria-checked\`, \`aria-pressed\`), relationships (\`aria-controls\`, \`aria-describedby\`) and keyboard. Better: use a headless library that already does (Radix, React Aria, Base UI, Headless UI).
- Icon-only buttons get an accessible name (\`aria-label\` or visually hidden text); decorative icons and images get \`aria-hidden="true"\` or \`alt=""\`.

## Labels and Text
- Every input has a programmatic label (\`<label for>\` or wrapping \`<label>\`); helper and error text linked with \`aria-describedby\`; errors also set \`aria-invalid="true"\`. A placeholder is not a label.
- Link and button text makes sense out of context: "Download the March invoice", not "Click here" or a row of "More".
- Images that carry information have \`alt\` text saying what they convey, not what they are ("Revenue grew 12 % in March", not "chart").
- Text resizes to 200 percent without loss, and reflows at 320 CSS px without horizontal scrolling; use \`rem\` for type and do not fix heights on text containers.

## Contrast and Color
- 4.5:1 for normal text, 3:1 for large text (24 px, or 18.7 px bold) and for non-text elements a user must perceive: input borders, icons that carry meaning, focus rings, chart marks, the state of a toggle.
- Meaning beyond color: errors have an icon and text, not only red; required fields have a word or symbol; chart series are distinguishable by label, position or pattern; links in body text are underlined or otherwise distinct beyond hue.
- Check both themes, hover and disabled states, and text on images (add a scrim).

## Motion and Time
- Honor \`prefers-reduced-motion: reduce\`: replace movement (slides, parallax, zooms, auto-advancing carousels) with fades or no animation; never remove the feedback itself.
- Nothing flashes more than three times per second. Auto-playing media and carousels can be paused. Timeouts warn the user and let them extend, unless the time limit is essential.

## Live Regions and Dynamic Content
- Announce changes that happen away from focus: \`role="status"\` (\`aria-live="polite"\`) for confirmations, saved states and result counts; \`role="alert"\` only for urgent errors. The region exists in the DOM before its text changes.
- Loading states announce that content is loading and when it has loaded (\`aria-busy\` on the region, a status message).
- Client-side route changes move focus to the new page's heading or announce the new title.

## Testing
- Keyboard pass: unplug the mouse and complete every task of the screen; check the focus is always visible and the order makes sense.
- Screen reader pass on at least one pairing: VoiceOver with Safari on macOS or iOS, NVDA with Firefox or Chrome on Windows, TalkBack on Android. Navigate by headings and landmarks, fill a form, trigger an error.
- Automated checks catch about a third of issues: run axe (\`@axe-core/playwright\`, the browser extension or Lighthouse) and fix every violation, then do the manual passes.
- Zoom to 200 percent and to 400 percent at 1280 px wide, and check the 320 px reflow.`,
};
