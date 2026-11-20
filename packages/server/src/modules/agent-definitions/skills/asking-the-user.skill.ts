import { SKILL_NAMES } from '../constants/skill-names.constant.js';
import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';


export const ASKING_THE_USER_SKILL: AgentSkillDefinition = {
  name: SKILL_NAMES.askingTheUser,
  description: 'How to ask the user for a decision - the <question> grammar, making each question stand on its own, recommending an option, facts you look up instead of asking, interviewing in rounds over the frontier of open decisions, ending an interview with a confirmed summary, attachments in the answers, and answers that time out. Read it when a question needs more than the brief in your instructions: an interview of several rounds, dependent decisions, attachments in the answers, or a timed-out answer.',
  roles: ['CEO', 'PRODUCT_OWNER', 'TECH_LEAD', 'IT_SUPPORT'],
  buildContent: () => `# Asking the User

Ask when the work cannot go on without a decision only the user can make (an ambiguous requirement, a trade-off, a business rule nobody stated); never guess it.

## The Question
- Write each one inside your final response as \`<question rationale="why the answer matters">question text<option recommended>first choice</option><option>second choice</option></question>\`, as plain text without code fences: one \`<option>\` per plausible answer, none for an open question, and never an "Other" option, since the user can always type their own answer.
- The user may follow several agents and conversations at once, so each question must stand on its own. The text outside the tags is its context (the task, what you found, why you are blocked), shown above the first question.
- Always fill \`rationale\`: what the answer changes in the work and, when the options differ, where each one leads.
- Recommend one option: put it first, mark it \`recommended\` and say why. It is assumed when the user does not answer in time, so recommend only what is safe to proceed with.
- Word the recommended option so that accepting it is an informed decision in one click: the option says what happens, and the rationale gives the reason for recommending it.

## Facts Are Not Questions
Before each round, find out everything you can look up: the code, the documentation, the board, how the system behaves today, and the answers already given. A question the project answers spends the user's attention on something you could have read; ask only what needs their judgment, and use what you found to sharpen it ("today X happens; should it stay that way?").

## Rounds and the Frontier
- Before the first round, map the decisions the work needs as a tree: each decision with the ones whose wording or options depend on its answer.
- Each round asks the frontier: every open decision whose prerequisites are settled, all at once. One question per round spends a round on each, and a dependent decision asked early makes the user answer a hypothetical.
- After the answers, update the map: settle what was answered, drop the branches an answer closed, add the decisions it opened, look up what the answers let you find, then ask the new frontier. Keep the map in your reasoning from round to round.
- The user answers the questions of a round one at a time, by option number or with their own text. Order them by how much they unblock the work, and never ask again what was already answered.

## Ending the Interview
- Stop asking only when the frontier is empty and nothing the work depends on was assumed without the user: a gap you noticed and did not ask is a question you still owe.
- When your role instructions call for it, a last short round confirms the summary: the text outside the tags lists every decision taken, and one \`<question>\` asks the user to confirm it, its recommended option confirming and their own text correcting it. A correction reopens only the decisions it touches.

## The Answers
- They arrive as \`<user_answers>\`: one \`<answer question="..." option="N">choice</answer>\` per question, or \`kind="other"\` with the text the user typed, with an \`<attachment path="..."/>\` inside for each file the user attached. Continue the work with them, and ask again if a new decision comes up.
- An answer with \`status="timed_out"\` means the user was absent, as a \`<note>\` explains: the recommended option is assumed (its \`option\` is set) or, for a question without one, nothing is (no \`option\`, empty text) and you decide how to proceed. Treat an assumed answer as provisional: keep the work easy to revert and say in your final response what you assumed.
- A response without \`<question>\` delivers your answer as usual.
`,
};
