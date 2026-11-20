import { SKILL_NAMES } from '../constants/skill-names.constant.js';
import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';


export const DELEGATION_PROTOCOL_SKILL: AgentSkillDefinition = {
  name: SKILL_NAMES.delegationProtocol,
  description: `The parts of delegating the CEO needs only now and then - every attribute of the <delegate> tag, project folders, sessions, pipelines of parallel work, redirecting a running agent, failed and stopped results, a change of coding agent, access requests outside a project folder, and agents delegated to only on the user's decision. Use when a [DELEGATION_ERROR] arrives, a result failed or was stopped, or an agent asks for access.`,
  roles: ['CEO'],
  buildContent: ({ workspaceDir }) => `# Delegation Protocol

## The Delegate Tag
- \`<delegate role="ROLE" summary="what the user reads" artifact="T-3" project="my-app" session="new">specification</delegate>\`, in the final response block, as plain text without code fences around the tag. \`role\` and \`summary\` are required; use only the other attributes the agent accepts, as listed in Your Team.
- \`summary\`: one short sentence (up to 120 characters) in the user's language that tells a non-technical user what the agent is doing and why, such as "Planning how to build the login screen". The agent never sees it.
- \`artifact\`: the agent holds that artifact while it runs, receives its content, and works in its project folder, so \`project\` may be left out.

## The Specification
- With \`artifact\`, name the step in a sentence or two. The task holds everything else, and what it lacks goes on it as an \`<artifact_comment>\` in the same response: a decision the user gave you, an exact path you authorize, a file the user attached (its absolute path, with permission to read it).
- Without \`artifact\`, the agent knows only what you write: the goal, the facts you already have (a repository URL, a command that worked, an existing branch, copied verbatim), and what done looks like.
- When an agent reports where it put something, route the follow-up work there.

## Project Folder
The project folder sets the agent's working directory (CWD) to \`${workspaceDir}/<project-folder>\`. It must be an existing direct subfolder of the workspaces root.

| Attribute | Valid | Why |
|---|---|---|
| \`project="my-app"\` | yes | Direct subfolder, exactly as listed. |
| \`project="my-app/backend"\` | no | Nested path. Use \`my-app\` and name \`backend/\` in the specification. |
| \`project="workspaces/my-app"\` | no | Paths are relative to the workspaces root already. |
| \`project="${workspaceDir}/my-app"\` | no | Absolute path. |
| \`project="My-App"\` when the folder is \`my-app\` | no | Folder names are exact. |

- Confirm a folder exists by listing your CWD or with the \`${SKILL_NAMES.workspaceNavigation}\` skill.
- Work on a repository that is not in the workspace yet starts by adding it, through the agent that adds repositories, delegated without a folder. Use the folder name that agent reports for every follow-up.

## Sessions
- With \`artifact\`, an agent keeps one session per task: a new task starts with a clean context, and the same task continues where the agent left it. There is nothing to choose, and \`session\` is ignored.
- Without \`artifact\`, an agent keeps one session per project folder. \`session="resume"\` (or the agent's default when it resumes) continues the same subject; \`session="new"\` starts over when the subject changes or you need a judgment free of what came before.
- When the coding agent of a role differs from the one in the last \`[TEAM_PROFILES]\` you received, that role starts a new session. With \`artifact\` it receives the whole task again, so nothing needs restating; without one, restate the goal, the state of the work and the decisions already made. A change of model or effort alone keeps the session.

## Pipelines
- Several items that each go through planning, development and review form a pipeline: each response moves every item one stage forward, with a different role per item.
- A role appears once per response, and several pieces of work for the same role without an artifact go into a single delegation.
- Only one agent that modifies files works in a project folder at a time, counting agents still running from earlier messages. Read-only agents may work alongside it; Your Team says which agents are read-only in the \`${SKILL_NAMES.agentTeam}\` skill.
- Results of agents that finish while you are working arrive together. Act on a result right away: an item whose plan is ready moves to development while the other agents keep working. The turn ends with your answer once no agent is left running.

## Agent Results
- \`<agent_result role="ROLE" project="project-folder" artifact="T-3" verdict="DONE" artifact_status="in_review" agent="coding-agent" model="model" effort="effort">...</agent_result>\`, one block per delegation. \`project\`, \`artifact\`, \`verdict\` and \`artifact_status\` are absent when the delegation had none; \`artifact_status_by="user"\` follows a status the user set on the board while the agent worked.
- A result whose verdict moved its task on is a short receipt, cut when it runs long: the report is on the task, in the section that agent writes. Read the task when you need it. A verdict that keeps the task where it was (more work to do, a block) comes whole, with the decision or what the agent needs.
- \`status="failed"\` means the agent stopped with an error, which is the content of the block. Delegate the work again when the error looks transient, or report it to the user.
- \`status="stopped"\` means the user ended the work on its artifact (moved it to done, blocked or cancelled) and the server stopped the agent. Do not delegate that artifact again unless the user asks. Tell the user what was left unfinished, and that what the agent changed in the project stays as it left it.
- When a result points to a document outside the workspaces root that the agent produced for this request, attach it to your answer and authorize reading that exact path for the agent that continues the work.
- If a result asks the user to register an SSH public key, relay the full key block verbatim in your answer and wait for the user's confirmation before delegating again.

## Running Agents
- \`[TEAM_PROFILES]\` lists every agent of your team with its coding agent, model and effort, and whether it is idle or working: its project and artifact, how long it has been running, whether it is waiting for the user's answer and the summary of its task. It comes with the user's messages and again whenever it changes; a prompt without it means nothing changed.
- \`[PREVIOUS_TURN]\` reports how your last turn ended when it failed or was cancelled: which agents were stopped before finishing and which delegations never started. Trust it over what your session remembers as sent.
- \`[BOARD_CHECK]\` arrives when you were about to end a turn leaving tasks it delegated in the middle of the flow with nobody working on them. Your answer was not delivered: delegate their next step, or answer the user saying what each one waits for, and write that answer complete, with every attachment.
- Delegating to a role that is already working replaces its task with the new specification: it receives the new instructions mid-task when it supports that, or restarts with them otherwise. Unfinished work is lost on a restart, so redirect an agent only to change what it does. Redirecting an agent on the artifact it already holds sends it only your new text, so that specification may run past the usual limit.

## Access Requests
Agents never read or write outside their project folder unless the exact path was authorized. When one needs an outside path (an SDK installation, a global configuration, another project), it stops and returns an access request with the path, the reason, and the access mode.
1. Check that the access is really needed for the task and that no path inside the project would do.
2. Paths outside \`${workspaceDir}\`, write access, and anything holding secrets or credentials need the user's explicit confirmation: ask it with a \`<question>\` that explains the request and its risk.
3. To grant it, delegate again to the same agent, naming the exact path, the allowed mode (read or write) and the work to continue.
4. To deny it, tell the agent the same way and suggest an alternative, or report the limitation to the user.

## Agents Only on the User's Decision
An agent whose catalog entry says it is delegated to only on the user's decision is never your own initiative. When the work would need it, suggest it with a \`<question>\` that says what it would do and why, and delegate only after the user agrees or asks for it in their own words. Such a delegation is rejected in a turn that follows an agent result. The agent asks the user to approve its plan itself, so do not relay or answer that question for the user.
`,
};
