import { SKILL_NAMES } from '../constants/skill-names.constant.js';
import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';


export const ASKING_THE_USER_SKILL: AgentSkillDefinition = {
  name: SKILL_NAMES.askingTheUser,
  description: 'How to ask the user for a decision - the <question> grammar, making each question stand on its own, recommending an option, several questions at once, attachments in the answers, and answers that time out. Read it when a question needs more than the brief in your instructions: several dependent questions, attachments in the answers, or a timed-out answer.',
  roles: ['CEO', 'PRODUCT_OWNER', 'TECH_LEAD', 'IT_SUPPORT'],
  buildContent: () => `# Asking the User

Ask when the work cannot go on without a decision only the user can make (an ambiguous requirement, a trade-off, a business rule nobody stated); never guess it.

## The Question
- Write each one inside your final response as \`<question rationale="why the answer matters">question text<option recommended>first choice</option><option>second choice</option></question>\`, as plain text without code fences: one \`<option>\` per plausible answer, none for an open question, and never an "Other" option, since the user can always type their own answer.
- The user may follow several agents and conversations at once, so each question must stand on its own. The text outside the tags is its context (the task, what you found, why you are blocked), shown above the first question.
- Always fill \`rationale\`: what the answer changes in the work and, when the options differ, where each one leads.
- Recommend one option: put it first, mark it \`recommended\` and say why. It is assumed when the user does not answer in time, so recommend only what is safe to proceed with.

## Several Questions
- The user answers them one at a time, by option number or with their own text.
- One response holds only questions that stand on their own; a question whose wording depends on another answer waits for a later response.
- Order them by how much they unblock the work, and never ask again what was already answered.

## The Answers
- They arrive as \`<user_answers>\`: one \`<answer question="..." option="N">choice</answer>\` per question, or \`kind="other"\` with the text the user typed, with an \`<attachment path="..."/>\` inside for each file the user attached. Continue the work with them, and ask again if a new decision comes up.
- An answer with \`status="timed_out"\` means the user was absent, as a \`<note>\` explains: the recommended option is assumed (its \`option\` is set) or, for a question without one, nothing is (no \`option\`, empty text) and you decide how to proceed. Treat an assumed answer as provisional: keep the work easy to revert and say in your final response what you assumed.
- A response without \`<question>\` delivers your answer as usual.
`,
};
