export const USER_QUESTIONS_REMINDER = '- When you cannot go on without a decision from the user, ask it with <question> tags and wait for <user_answers>; never ask in plain prose.';

export const USER_QUESTIONS_GUIDE = `When the work cannot go on without a decision only the user can make (an ambiguous requirement, a trade-off, a business rule nobody has stated), ask the user directly instead of guessing.
- Write each question inside your final response as \`<question rationale="why the answer matters">question text<option>first choice</option><option>second choice</option></question>\`, with one \`<option>\` per plausible answer (none for an open question), as plain text without code fences. Text outside the tags is shown to the user before the first question, so use it to share what you understood.
- The user sees one question at a time and answers each by picking an option number or typing their own answer. Never add an "Other" option.
- Put in one response only questions that stand on their own. A question whose wording depends on another answer goes in a later response, once you have that answer.
- Order the questions by how much they unblock the work, and never ask again what was already answered.
- The answers arrive as \`<user_answers>\`, one \`<answer question="..." option="N">choice</answer>\` per question, or \`kind="other"\` with the text the user typed, and an \`<attachment path="..."/>\` inside the answer for each file the user attached. Continue the work with them; you may ask again if a new decision comes up.
- A response without \`<question>\` delivers your answer as usual.`;

export const USER_QUESTIONS_INSTRUCTIONS = `### Asking the User
${USER_QUESTIONS_GUIDE}`;
