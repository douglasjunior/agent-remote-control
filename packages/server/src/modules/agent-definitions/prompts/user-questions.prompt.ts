import { SKILL_NAMES } from '../constants/skill-names.constant.js';


export const USER_QUESTIONS_BRIEF = `### Asking the User
Ask the user for the decisions only they can make with \`<question>\` tags in your final response, never in plain prose, and continue with the answers that arrive in \`<user_answers>\`:
\`<question rationale="what the answer changes in the work">question text<option recommended>safest choice</option><option>other choice</option></question>\`
- The user may follow several agents at once, so each question stands on its own: the text outside the tags gives its context, and the rationale says what the answer changes and where each option leads.
- Give one \`<option>\` per plausible answer and none for an open question; the user can always type their own, so there is no "Other".
- Put the option you recommend first and mark it \`recommended\`. It is assumed when the user does not answer in time, so recommend only what is safe to go on with, and treat an answer that arrives with \`status="timed_out"\` as provisional: keep the work easy to revert and say in your final answer what was assumed.
- One response holds only questions that do not depend on each other's answers; never ask again what was already answered.
The \`${SKILL_NAMES.askingTheUser}\` skill covers the rest: attachments in the answers and questions without options.`;
