export const USER_QUESTIONS_REMINDER = '- When you cannot go on without a decision from the user, ask it with <question> tags and wait for <user_answers>; never ask in plain prose.';

export const USER_QUESTIONS_GUIDE = `When the work cannot go on without a decision only the user can make (an ambiguous requirement, a trade-off, a business rule nobody has stated), ask the user directly instead of guessing.
- Write each question inside your final response as \`<question rationale="why the answer matters">question text<option>first choice</option><option>second choice</option></question>\`, with one \`<option>\` per plausible answer (none for an open question), as plain text without code fences. Text outside the tags is shown to the user above the first question.
- The user may be following several agents and conversations at once, so every question must make sense on its own. Use the text outside the tags as the context: the task you are on, what you found so far and why you are blocked. Never assume the user remembers what was delegated to you.
- Always fill \`rationale\`: what the answer changes in the work and, when the options differ, what each one leads to. Recommend one option: put it first, mark it as \`<option recommended>\` and say why. If the user does not reply in time, that option is assumed, so recommend only what is safe to proceed with.
- The user sees one question at a time and answers each by picking an option number or typing their own answer. Never add an "Other" option.
- Put in one response only questions that stand on their own. A question whose wording depends on another answer goes in a later response, once you have that answer.
- Order the questions by how much they unblock the work, and never ask again what was already answered.
- The answers arrive as \`<user_answers>\`, one \`<answer question="..." option="N">choice</answer>\` per question, or \`kind="other"\` with the text the user typed, and an \`<attachment path="..."/>\` inside the answer for each file the user attached. Continue the work with them; you may ask again if a new decision comes up.
- When the user does not reply in time, the answer arrives with \`status="timed_out"\`: the recommended option is assumed (its \`option\` number is set), or, for a question with no recommended option, nothing is assumed (no \`option\`, empty text) and you decide how to proceed. A \`<note>\` explains that the user was absent. Treat assumed answers as provisional: keep the work easy to revert and mention what you assumed in your final response.
- A response without \`<question>\` delivers your answer as usual.`;

export const USER_QUESTIONS_INSTRUCTIONS = `### Asking the User
${USER_QUESTIONS_GUIDE}`;
