import type { AgentInterface } from '../../orchestrator/models/agent-interface.model.js';
import { CEO_ARTIFACT_ACCESS } from '../constants/artifact-access.constant.js';
import { SKILL_NAMES } from '../constants/skill-names.constant.js';
import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';

import { buildBoardRequestsBody } from './board-requests.skill.js';


const LISTING_FINISHED_WORK: Readonly<Record<AgentInterface, string>> = {
  tags: '`<artifact_list status="all"/>` lists the finished work too',
  tools: '`artifact_list` with the status `all` lists the finished work too',
};

const APPENDING_TO_THE_OVERVIEW: Readonly<Record<AgentInterface, string>> = {
  tags: 'append it to the `overview` (`<section name="overview" mode="append">`)',
  tools: 'append it to the `overview`',
};

const SKIPPING_A_STEP: Readonly<Record<AgentInterface, string>> = {
  tags: 'set the status that step would have left: `<artifact_update id="T-3" status="approved" note="the user waived the review"/>`.',
  tools: 'set the status that step would have left with `artifact_update`, saying why in its `note`, such as `approved` with "the user waived the review".',
};

const GRAMMAR_HEADING: Readonly<Record<AgentInterface, string>> = {
  tags: 'Request Grammar',
  tools: 'Working on the Board',
};

export const ARTIFACT_BOARD_SKILL: AgentSkillDefinition = {
  name: SKILL_NAMES.artifactBoard,
  description: `The board of artifacts in full, for the CEO - every request and attribute, features and their tasks, dependencies between artifacts, adding a request to existing work, and the statuses only the CEO sets. Use when a request needs a feature or dependencies, when an artifact request was refused, or when you are not sure of an attribute.`,
  roles: ['CEO'],
  buildContent: ({ agentInterface }) => `# Artifact Board

Each conversation is a mission with its own board. Features group the tasks of an initiative and link the projects it spans; a task is the unit one agent works on, in one project: one the feature links, or one of its own when it stands alone. A project folder may hold several nested git repositories, and a task in it may change any of them. An initiative across several projects, such as a separate backend and frontend, is one feature linking them, never one feature per project. The content of each artifact lives on the board, written and read by the agents themselves: it is never copied into a specification.

## Adding a Request to the Board
- The \`[BOARD]\` block of your prompt lists the open artifacts; ${LISTING_FINISHED_WORK[agentInterface]}.
- When the request belongs to an open artifact whose status still allows it (\`backlog\`, \`ready\`, or \`changes_requested\` for a correction), add it there: ${APPENDING_TO_THE_OVERVIEW[agentInterface]} when nobody holds the artifact, and comment on it when someone does.
- When the work already moved past that point (\`in_review\`, \`approved\`, \`in_testing\`, \`tested\`, \`done\`), create a new task that depends on it instead of reopening it.
- Otherwise create the work: a task for a single deliverable, or a feature for an initiative, which the agent that settles the business refinement breaks into tasks.

## Statuses
- The server moves a task from the delegations and their verdicts, as your instructions list, keeps a task \`ready\` exactly while no refinement is pending (a \`ready\` task whose refinement is set back to \`pending\` returns to the \`backlog\`), and keeps a feature in step with its tasks: \`in_progress\` once any task started, \`done\` once every task is done or cancelled.
- A task that passed its test is \`tested\`: it waits for the merge, and \`done\` once merged or left for the user.
- A delegation of a task whose status does not fit the agent is rejected with the reason. To skip a step the user does not want (a review, a test), ${SKIPPING_A_STEP[agentInterface]}
- \`blocked\` waits on something outside the team: say what in a comment, and set the previous status back when it is unblocked. It is also how a refined task is parked, since \`backlog\` and \`ready\` follow its refinements.
- \`frozen\` is set by the server on a task that went through too many delegations. Only the user takes a task out of it: tell them what is going wrong with it.
- \`done\` and \`cancelled\` close an artifact. Reopen one only by setting an open status.
- A failed result, or one without a verdict, leaves the status as it was.

## Dependencies and Parallel Work
- Dependencies link siblings: a task depends on other tasks of its feature (a standalone task, on other standalone tasks), and a feature on other features. A task waits for the tasks in its \`depends_on\`, and the tasks of a feature wait for the features it depends on. The board lists what each artifact is still \`waiting on\`.
- Tasks free of waits, and that need different agents, move in parallel: refine one while another is developed and a third is reviewed.
- An artifact is with one agent at a time: a delegation of an artifact another agent holds is rejected. \`[TEAM_PROFILES]\` names the artifact each working agent holds.
- The agents that refine work on a feature too (\`artifact="F-1"\`), reading and writing every task under it; the others work on one task.

## ${GRAMMAR_HEADING[agentInterface]}
${buildBoardRequestsBody(CEO_ARTIFACT_ACCESS, agentInterface)}
`,
};
