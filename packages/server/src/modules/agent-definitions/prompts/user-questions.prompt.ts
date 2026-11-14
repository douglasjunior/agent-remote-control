import { SKILL_NAMES } from '../constants/skill-names.constant.js';


export const USER_QUESTIONS_REMINDER = `- When you cannot go on without a decision from the user, ask it with <question> tags and wait for <user_answers>; never ask in plain prose. The \`${SKILL_NAMES.askingTheUser}\` skill has the guide.`;

export const USER_QUESTIONS_BRIEF = `### Asking the User
Ask the user for the decisions only they can make with \`<question rationale="why the answer matters">question<option recommended>safest choice</option><option>other choice</option></question>\` tags in your final response, and continue with the answers that arrive in \`<user_answers>\`. Read the \`${SKILL_NAMES.askingTheUser}\` skill before your first question in a session: how each question stands on its own, which option to recommend, and what to do with an answer that timed out.`;
