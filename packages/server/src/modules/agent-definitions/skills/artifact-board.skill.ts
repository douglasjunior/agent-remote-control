import { CEO_ARTIFACT_ACCESS } from '../constants/artifact-access.constant.js';
import { SKILL_NAMES } from '../constants/skill-names.constant.js';
import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';

import { buildBoardRequestsBody } from './board-requests.skill.js';


export const ARTIFACT_BOARD_SKILL: AgentSkillDefinition = {
  name: SKILL_NAMES.artifactBoard,
  description: `The board of artifacts in full, for the CEO - every request and attribute, features and their tasks, dependencies between artifacts, adding a request to existing work, and the statuses only the CEO sets. Use when a request needs a feature or dependencies, when an artifact request was refused, or when you are not sure of an attribute.`,
  roles: ['CEO'],
  buildContent: () => `# Artifact Board

Each conversation is a mission with its own board. Features group the tasks of an initiative in one project folder; a task is the unit one agent works on, inside a feature (in the feature's project) or on its own (in a project of its own). An initiative that spans several repositories is one feature per project, with dependencies between the features. The content of each artifact lives on the board, written and read by the agents themselves: it is never copied into a specification.

## Adding a Request to the Board
- The \`[BOARD]\` block of your prompt lists the open artifacts; \`<artifact_list status="all"/>\` lists the finished work too.
- When the request belongs to an open artifact whose status still allows it (\`backlog\`, \`ready\`, or \`changes_requested\` for a correction), add it there: append it to the \`overview\` (\`<section name="overview" mode="append">\`) when nobody holds the artifact, and comment on it when someone does.
- When the work already moved past that point (\`in_review\`, \`approved\`, \`in_testing\`, \`done\`), create a new task that depends on it instead of reopening it.
- Otherwise create the work: a task for a single deliverable, or a feature for an initiative, which the agent that settles the business refinement breaks into tasks.

## Statuses
- The server moves a task from the delegations and their verdicts, as your instructions list, makes a task \`ready\` once neither refinement is pending, and keeps a feature in step with its tasks: \`in_progress\` once any task started, \`done\` once every task is done or cancelled.
- A delegation of a task whose status does not fit the agent is rejected with the reason. To skip a step the user does not want (a review, a test), set the status that step would have left: \`<artifact_update id="T-3" status="approved" note="the user waived the review"/>\`.
- \`blocked\` waits on something outside the team: say what in a comment, and set the previous status back when it is unblocked.
- \`frozen\` is set by the server on a task that went through too many delegations. Only the user takes a task out of it: tell them what is going wrong with it.
- \`done\` and \`cancelled\` close an artifact. Reopen one only by setting an open status.
- A failed result, or one without a verdict, leaves the status as it was.

## Dependencies and Parallel Work
- Dependencies link siblings: a task depends on other tasks of its feature (a standalone task, on other standalone tasks), and a feature on other features. A task waits for the tasks in its \`depends_on\`, and the tasks of a feature wait for the features it depends on. The board lists what each artifact is still \`waiting on\`.
- Tasks free of waits, and that need different agents, move in parallel: refine one while another is developed and a third is reviewed.
- An artifact is with one agent at a time: a delegation of an artifact another agent holds is rejected. \`[TEAM_PROFILES]\` names the artifact each working agent holds.
- The agents that refine work on a feature too (\`artifact="F-1"\`), reading and writing every task under it; the others work on one task.

## Request Grammar
${buildBoardRequestsBody(CEO_ARTIFACT_ACCESS)}
`,
};
