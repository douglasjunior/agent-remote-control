import { SKILL_NAMES } from '../constants/skill-names.constant.js';
import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';


export const UX_WRITING_SKILL: AgentSkillDefinition = {
  name: SKILL_NAMES.uxWriting,
  description: 'Read before writing any text an interface shows: labels, buttons, headings, empty states, errors, confirmations and helper text. Covers naming things the way users recognize them, active voice, controls that say exactly what happens, errors with cause and fix, and plain, short copy without mannered devices.',
  roles: ['UX_DESIGNER'],
  buildContent: () => `# UX Writing

Interface text is part of the design, not filler added later. Write the real words in the prototype, in the user's language.

## Name Things the Way Users Do
- Use the words of the domain and of the user, from the artifact's glossary and user stories, never the words of the database or the code: "Customers", not "Accounts entities"; "Send invoice", not "Dispatch".
- One name per thing, everywhere: if it is a "project" in the navigation, it is not a "workspace" in a dialog and a "board" in an email.
- Be specific: "Billing address" over "Address", "Last 30 days" over "Recent".

## Controls Say What Happens
- Buttons and links start with a verb and name the result: "Publish", "Save changes", "Create invoice", "Delete project". Avoid "OK", "Submit", "Yes", "Continue" when a precise verb exists.
- The confirmation echoes the verb: "Publish" leads to "Published"; "Delete project" in a confirmation leads to "Project deleted". Status labels use past participles or adjectives ("Draft", "Scheduled", "Sent").
- Pairs are parallel and clear about the safe choice: "Delete project" / "Keep project" or "Cancel"; never "Yes" / "No" under a question that can be misread.
- A link says where it goes ("View all invoices"), never "click here".

## Voice
- Active voice, present tense, second person: "We could not save your changes", "You can export up to 10,000 rows". Not "Changes could not be saved by the system".
- Plain and short over clever: most labels are one to three words, most messages one or two sentences. Front-load the important words, since people scan the first two.
- Sentence case for everything (headings, buttons, labels, menu items), with proper nouns capitalized.
- Numbers as numerals ("3 tasks"), dates and times formatted for the locale, units always shown.
- No mannered devices: no exclamation marks on routine events, no puns, no faux-casual filler ("Oops!", "Whoa there!", "Uh-oh"), no rhetorical questions, no em-dash flourishes, no marketing superlatives inside the product. Personality comes from clarity and the occasional warm word at the right moment (finishing onboarding, a cleared inbox).

## Errors
- Say what happened and how to fix it, in that order, without blame or apology filler: "Card declined. Use another card or contact your bank." not "Sorry! Something went wrong :(".
- Specific over generic: "The file is larger than 25 MB. Compress it or split it into parts." Include the limit, the format, the field.
- Field errors are short and sit under the field ("Enter a date after today"); the error summary at the top lists them as links.
- Technical detail (an error code, a request id) goes after the human message, smaller, for support.

## Empty States, Helper Text and Confirmations
- Empty state: what this place is for, how to fill it, and the action ("Your saved searches appear here. Save a search from the results page to reuse it."). Not "No data".
- Helper text sets expectations before the error happens ("Use 8 or more characters with a number"); it does not repeat the label.
- Placeholder text is an example of the format ("name@company.com"), never the label and never instructions that disappear on typing.
- Confirmation dialogs: a title that asks the question with the object ("Delete 'Q3 report'?"), a body with the consequence ("Its 12 comments are deleted too. This cannot be undone."), buttons with verbs.
- Loading text says what is happening when it takes long ("Importing 1,240 contacts…"), not "Please wait".

## Check the Copy
- Read every screen aloud: anything you would not say to a colleague, rewrite.
- Look for the longest translation: German and Finnish run 30 percent longer; leave room, and never put text in images.
- Every term in the interface is either obvious to the audience or explained where it first appears.`,
};
