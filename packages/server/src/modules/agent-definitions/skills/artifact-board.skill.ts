import { CEO_ARTIFACT_ACCESS } from '../constants/artifact-access.constant.js';
import { CEO_SKILLS } from '../constants/ceo-skills.constant.js';
import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';
import { buildArtifactProtocolInstructions } from '../prompts/artifact-protocol.prompt.js';


export const ARTIFACT_BOARD_SKILL: AgentSkillDefinition = {
  name: CEO_SKILLS.artifactBoard,
  description: `How the CEO runs the board of artifacts of a conversation - the request grammar, turning a new request into tasks or adding it to existing ones, the status of each task and who works on it next, dependencies, and delegating with artifact="...". Use whenever a request arrives, an agent result comes back, or you need to know what is left to do.`,
  roles: ['CEO'],
  buildContent: () => `# Artifact Board

Each conversation is a mission with its own board. Features group the tasks of an initiative in one project folder; a task is the unit one agent works on, inside a feature (in the feature's project) or on its own (in a project of its own). An initiative that spans several repositories is one feature per project, with dependencies between the features. The content of each artifact lives on the board, written and read by the agents themselves: you never copy it into a specification.

## A New Request
1. List the board: \`<artifact_list status="all"/>\` when you need the finished work too.
2. When the request belongs to an open artifact whose status still allows it (\`backlog\`, \`ready\`, or \`changes_requested\` for a correction), add it there: append it to the \`overview\` (\`<section name="overview" mode="append">\`) when nobody holds the artifact, and comment on it when someone does. When the work already moved past that point (\`in_review\`, \`approved\`, \`in_testing\`, \`done\`), create a new task that depends on it instead of reopening it.
3. Otherwise create the work: a task for a single deliverable, or a feature for an initiative, which the agent that runs discovery breaks into tasks. Write the request as the \`overview\`, in the user's words plus what you already know, and set the path through the refinements:
   - \`business_refinement="pending"\` when what to build or why is still open, so the agent that runs discovery refines it with the user;
   - \`technical_refinement="pending"\` when how to build it needs planning;
   - both \`skipped\` for a simple, well-defined change: the task starts \`ready\` and goes straight to development.
   A request for something to build always becomes artifacts before anyone builds it. Questions, investigations and Git chores that change no code need none.
4. Then delegate the next step of each artifact (see the table below).

## Statuses and Who Comes Next
| Status | Meaning | Next step |
|---|---|---|
| \`backlog\` | Refinement owed | \`business_refinement="pending"\`: the agent that runs discovery, with \`artifact\`. Then \`technical_refinement="pending"\`: the agent that plans, with \`artifact\`. When neither is pending, set \`ready\`. |
| \`ready\` | Refined, waiting for development | When every task it depends on is \`done\` (or the developer can build on its branch), set \`in_progress\` and delegate it to the agent that implements, with \`artifact\`. |
| \`in_progress\` | Being implemented | When the implementation is committed on the task's branch: with a remote, delegate to the agent that handles remotes, with \`artifact\`, to push the branch and open the pull request it links on the task; without a remote, the branch is reviewed locally. Then set \`in_review\`. |
| \`in_review\` | Work ready for review | Delegate to the agent that reviews, with \`artifact\`, in a new session: it reviews the open pull request, or the task's branch locally when there is none. Its verdict sets \`approved\` or \`changes_requested\`, recorded before the next step even when that step starts in the same response. |
| \`changes_requested\` | Review or tests found problems | Set \`in_progress\` and delegate to the agent that implements, resuming its session, to fix the findings in the task's \`review_findings\` or \`test_report\` section; then the push when there is a pull request, then \`in_review\` again. |
| \`approved\` | Review passed, ready for testing | Set \`in_testing\` and delegate to the agent that tests in practice, with \`artifact\`. A change with nothing to run (documentation, comments) skips testing and goes on as a passed test. |
| \`in_testing\` | Being tested in practice | Its verdict FAILED sets \`changes_requested\`. PASSED: merge it through the agent that handles remotes when the user wants it merged (ask when unsure), then set \`done\`; a branch without a remote, or one the user merges, is \`done\` with the branch left for the user. |
| \`blocked\` | Waiting on something outside the team | Say what in a comment; set the previous status back when it is unblocked. |
| \`done\`, \`cancelled\` | Closed | Nothing. Reopen only by setting an open status. |

- A feature follows its tasks: \`in_progress\` once any task started, \`done\` once every task is done or cancelled.
- Set the status of a task in the same response that delegates its next step (\`<artifact_update id="T-3" status="in_progress"/>\` next to the \`<delegate>\`).
- Every verdict leaves its own status in the history, so a status is never skipped: after an APPROVED review, \`<artifact_update id="T-3" status="approved"/>\` comes before \`<artifact_update id="T-3" status="in_testing"/>\` and the delegation to the agent that tests.
- After every \`<agent_result>\`, update the board before anything else, starting from its \`artifact_status\` (the status when the agent finished): the status the result calls for, the refinement the agent finished (it marks its own refinement \`done\`; check it), and a comment when the result carries something the next agent must know.
- A failed result leaves the status as it was; decide whether to delegate again.

## Dependencies and Parallel Work
- Dependencies link siblings: a task depends on other tasks of its feature (a standalone task, on other standalone tasks), and a feature on other features. A task waits for the tasks in its \`depends_on\`, and the tasks of a feature wait for the features it depends on. The board lists what each artifact is still \`waiting on\`. Tasks free of waits, and that need different agents, move in parallel: refine one while another is developed and a third is reviewed.
- An artifact is with one agent at a time: the orchestrator refuses a delegation of an artifact another agent holds. The \`[TEAM_PROFILES]\` line of a working agent names the artifact it holds.

## Delegating With an Artifact
- \`<delegate role="ROLE" summary="..." artifact="T-3">what to do with it now</delegate>\`. The agent receives the artifact's content and runs in its project folder, so leave \`project\` out (or give the same one).
- The specification says only what this step is: "Refine the business side of T-3 with the user", "Implement T-3", "Fix the review findings on the pull request of T-3", "Push the branch of T-3 and open its pull request", "Review the pull request of T-3". Add what the board does not hold: decisions the user gave you in this conversation, access you authorize.
- The agents that refine work on a feature too (\`artifact="F-1"\`), reading and writing every task under it; the others work on one task.
- \`<agent_result>\` carries \`artifact="T-3"\` and \`artifact_status\` for the work done on it. Your answer to the user never leaves a task in a status its results contradict: a finished implementation is not left \`in_progress\`, nor an approved review \`in_review\`, nor a passed test \`in_testing\`.

${buildArtifactProtocolInstructions(CEO_ARTIFACT_ACCESS).replace('### The Board', '## Request Grammar')}
`,
};
