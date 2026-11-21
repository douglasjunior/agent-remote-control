import { SKILL_NAMES } from '../constants/skill-names.constant.js';
import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';


export const INTERACTION_STATES_SKILL: AgentSkillDefinition = {
  name: SKILL_NAMES.interactionStates,
  description: 'Read before designing or building any screen that loads data, takes input or changes something: empty, loading, error, success, partial and permission states, form labels and validation timing, disabled versus read-only, destructive actions with an in-page confirmation, and undo.',
  roles: ['UX_DESIGNER', 'DEVELOPER'],
  buildContent: () => `# Interaction States

Every screen that shows data or takes input has more states than its happy path. Design each one, make it reachable in the prototype, and list it in the design record. A state nobody designed is the one users meet first.

## The State Inventory
For every screen and component that shows data, answer: what does it look like when it is empty (first use, and no results for a filter), loading (first load, and refreshing), failed (the whole screen, and one part of it), partially loaded or partially failed, full of data (long names, many items, large numbers), and not allowed (no permission, plan limit, read-only)? Plus, for anything the user changes: in progress, succeeded, failed, and undoable.

## Empty
- First-use empty: say what will appear here and how to add the first item, with the action right there ("No invoices yet. Invoices you send appear here with their status. [Create invoice]"). A small illustration or icon is optional; the sentence and the action are not.
- No-results empty: say that the filter or search found nothing, show the query, and offer to clear filters or broaden the search. It is a different screen from first use.
- Cleared empty (inbox zero, all tasks done) can celebrate, briefly.
- An empty table keeps its header, so the user sees what would be there.

## Loading
- Under 300 ms: show nothing; a flash of spinner is worse than a short wait. 300 ms to 1 s: a subtle indicator. Over 1 s: a skeleton or progress. Over 10 s: real progress (a percentage, the step it is on) and a way to leave.
- Skeletons for content with a known shape (lists, cards, profiles): same layout, same sizes, so nothing jumps when data arrives. A spinner for actions and for content with no predictable shape.
- Refreshing keeps the old data visible with a quiet indicator; it never blanks the screen.
- Buttons that start work show their own pending state (a spinner inside, the label "Saving…"), keep their width, and ignore repeated clicks.
- Optimistic updates for actions that almost always succeed (a like, a toggle, reordering, a status change): show the result at once and roll back with an error message if the server refuses.

## Error
- Say what went wrong in the user's terms and what they can do: "We could not save your changes because the connection dropped. Your edits are kept; try again." Never a raw error code alone, never "Something went wrong" alone, never blame the user.
- Place the error where it happened: a field error under the field, a section error inside the section (the rest of the page still works), a page-level error only when nothing could load.
- Always offer the way out: retry, edit, contact, go back. Keep what the user typed.
- Distinguish not found, no permission, offline, server error and validation error; each has its own message and remedy.

## Success
- Confirm in proportion: an inline change ("Saved" next to the field, a check that fades) for small edits; a toast for actions whose result is elsewhere; a success screen only for the end of a significant flow (a payment, a submission), saying what happens next.
- Toasts disappear after 4 to 6 seconds, pause on hover and focus, are announced to screen readers, and never carry the only copy of important information or the only way to undo when it matters.

## Partial and Permission States
- Partial data: show what loaded, mark what did not with an inline retry; a dashboard with one failed widget still shows the other five.
- Partial success in bulk actions: "18 of 20 invoices sent. 2 failed: [see which]".
- No permission: say that the user cannot do this and who can, or how to request access; hide controls the user can never use, disable (with an explanation) those they could use in another state.
- Plan or quota limits: show the limit before it is hit (usage meters), and the upgrade or cleanup path when it is.

## Forms
- A visible label above every field, always; placeholders only show an example format. Helper text under the field for constraints ("8 or more characters").
- Validate on blur (when the user leaves the field), not on every keystroke while they type; once a field has shown an error, revalidate it live as they fix it. Validate everything again on submit and move focus to the first invalid field, with an error summary at the top for long forms.
- Mark optional fields "(optional)" when most are required, or required fields when most are optional; never both.
- Disabled means "not available now", and its reason should be discoverable (a tooltip or helper text). Read-only means "you can see and copy it but not change it": render it as text or a read-only field that stays focusable and selectable, not a grayed-out control.
- Avoid disabling the submit button until the form is valid: users cannot tell why. Let them submit and show what is missing.
- Preserve input across errors, navigation and reloads for anything longer than a couple of fields (a draft).

## Destructive Actions
- Confirm in the page, close to the action, and name exactly what will be lost: "Delete the project 'Atlas' and its 34 tasks? This cannot be undone." with the destructive button labeled with the verb ("Delete project"), not "OK".
- For high-stakes deletes (an account, a repository), require typing the name.
- Prefer undo to confirmation for reversible actions: archive or delete at once with an "Undo" in the toast for 5 to 10 seconds, deleting for real after.
- Never use the browser's \`window.confirm\`; it cannot be styled, explained or tested well.

## Undo
- Every reversible change offers undo where it happened, for long enough to notice (at least 5 seconds) and through the keyboard shortcut the platform expects (Ctrl or Cmd+Z in editors).
- Soft-delete by default: a trash or archive that can be restored is worth more than any confirmation dialog.`,
};
